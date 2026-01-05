import { ContextStore, readSliceText, parseSlice } from '../context';
import { runDeepThink, getDeepThinkStages, type DeepThinkEvent, type DeepThinkResult } from '../pipelines';
import { ConversationStore } from '../conversation';
import { CheckpointStore, computeRunIdentityHash } from '../checkpoint';
import type { CliOptions } from '../cli';
import { stringify as yamlStringify } from 'yaml';
import { resolve } from 'path';
import { loadGlobalConfig, resolveBackendModel, resolveReasoning } from '../agent/config';
import {
  c,
  createFormatterState,
  formatPhaseHeader,
  formatPhaseSummary,
  formatSolverToolEvent,
  formatSolverComplete,
  formatToolStart as formatToolStartNew,
  formatCandidateSeparator,
  formatCandidateContent,
  formatRevision,
  formatStageUsage,
  formatFinalSeparator,
  formatCompletionStatus,
  formatFinalTokens,
  FORMAT_CONFIG,
  type FormatterState,
} from '../util';

/**
 * Select solver backends deterministically based on options.
 *
 * Precedence:
 * 1. If options.solverBackend is set, use it for all solvers.
 * 2. If options.distributeSolvers is true:
 *    - Use options.solverBackends if provided, otherwise use available backends.
 *    - Distribute k backends in round-robin order (even distribution).
 * 3. If solverModel is specified, infer backend from model prefix.
 * 4. Otherwise, use baseBackend (inherited from resolved base backend), or fallback to 'codex'.
 */
export async function selectSolverBackends(options: {
  k: number;
  distributeSolvers?: boolean;
  solverBackend?: string;
  solverBackends?: string[];
  solverModel?: string;
  baseBackend?: string;
}): Promise<{ backends: string[]; mode: 'fixed' | 'distributed' }> {
  const { k, distributeSolvers, solverBackend, solverBackends, solverModel, baseBackend } = options;

  // Validate k bounds (defensive, in addition to CLI validation)
  if (k < 1 || k > 8) {
    throw new Error(`k must be between 1 and 8, got ${k}`);
  }

  // Precedence 1: Explicit single backend override
  if (solverBackend) {
    return {
      backends: Array(k).fill(solverBackend),
      mode: 'fixed',
    };
  }

  // Precedence 2: Round-robin distribution
  if (distributeSolvers) {
    const candidates = await resolveCandidates(solverBackends);

    // Round-robin distribution: cycle through candidates k times
    const selected: string[] = [];
    const n = candidates.length;
    for (let i = 0; i < k; i++) {
      selected.push(candidates[i % n]);
    }

    return {
      backends: selected,
      mode: 'distributed',
    };
  }

  // Precedence 3: Infer backend from solverModel if specified
  if (solverModel) {
    const { resolveBackendModel } = await import('../agent/config');
    const resolved = resolveBackendModel({
      explicitModel: solverModel,
      fallbackBackend: baseBackend ?? 'codex',
    });
    return {
      backends: Array(k).fill(resolved.backend),
      mode: 'fixed',
    };
  }

  // Precedence 4: Fixed single backend (default behavior)
  // Use baseBackend if nothing specified, fallback to 'codex'
  const fallbackBackend = baseBackend ?? 'codex';
  return {
    backends: Array(k).fill(fallbackBackend),
    mode: 'fixed',
  };
}

/**
 * Resolve candidate backends for distribution.
 *
 * Uses explicit user list if provided, otherwise gets available backends.
 * Performs validation against registered backends and normalizes names.
 */
async function resolveCandidates(userBackends?: string[]): Promise<string[]> {
  const { listBackends, getAvailableBackends } = await import('../backend');
  const registeredBackends = listBackends();

  let candidates: string[];

  if (userBackends && userBackends.length > 0) {
    // User provided explicit list
    candidates = userBackends
      .map(name => name.trim())
      .filter(name => name.length > 0)
      .map(name => name.toLowerCase());

    // Deduplicate
    candidates = Array.from(new Set(candidates));

    // Sort for determinism
    candidates.sort();

    // Validate: check if flag resolved to empty after filtering
    if (candidates.length === 0) {
      throw new Error('No backends specified in --solver-backends. Provide at least one backend or remove the flag.');
    }

    // Validate: check against registered backends (case-insensitive)
    const registeredLower = registeredBackends.map(b => b.toLowerCase());
    const unknown = candidates.filter(c => !registeredLower.includes(c));
    if (unknown.length > 0) {
      throw new Error(`Unknown backend(s): ${unknown.join(', ')}. Available: ${registeredBackends.join(', ')}`);
    }

    // Optional: warn about unavailable backends (but don't throw)
    const available = await getAvailableBackends();
    const unavailable = candidates.filter(c => !available.includes(c));
    if (unavailable.length > 0) {
      console.error(`${c.yellow('[warning]')} Backend(s) ${unavailable.join(', ')} are registered but not available. Check configuration.`);
    }
  } else {
    // Use available backends from registry
    candidates = await getAvailableBackends();
    candidates.sort();

    if (candidates.length === 0) {
      throw new Error('No backends available for distribution. Install/configure at least one backend or use --solver-backend.');
    }
  }

  return candidates;
}

export async function handleDeep(
  prompt: string,
  options: CliOptions
): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  const deepConfig = globalConfig.deep ?? {};

  // Build context from selection (unless --no-sel)
  let context: string | undefined;
  if (!options.noSel) {
    const contextStore = new ContextStore({ sessionId: options.session });
    const entries = await contextStore.list();

    if (entries.length > 0) {
      context = await buildContext(contextStore);
    }
  }

  // Add ad-hoc files if provided
  if (options.files && options.files.length > 0) {
    const adhocContext = await buildAdhocContext(options.files);
    context = context ? `${context}\n\n${adhocContext}` : adhocContext;
  }

  // === Checkpoint conflict detection ===
  const checkpointStore = new CheckpointStore({ sessionId: options.session });
  const existingCheckpoint = await checkpointStore.load();

  if (existingCheckpoint) {
    if (options.resume) {
      // Validate run identity (unless --force-resume)
      const currentIdentity = computeRunIdentityHash({
        prompt,
        context,
        options: {
          k: options.k,
          verify: !options.noVerify,
          categories: options.categories,
          modules: options.modules,
        },
      });

      if (existingCheckpoint.runIdentityHash !== currentIdentity && !options.forceResume) {
        console.error(`${c.red('[error]')} Checkpoint run identity mismatch.`);
        console.error(`  Checkpoint was created with different prompt/context/options.`);
        console.error(`  Use ${c.cyan('--force-resume')} to resume anyway, or ${c.cyan('--force')} to start fresh.`);
        process.exit(1);
      }

      // Resume from checkpoint - will be passed to runDeepThink below
      console.error(c.cyan('[deep]') + ` Resuming from checkpoint (completed: ${existingCheckpoint.completedStage}, failed: ${existingCheckpoint.failedStage ?? 'none'})...\n`);
      // Don't clear - we'll use the checkpoint data
    } else if (options.force) {
      // Clear and start fresh
      console.error(c.cyan('[deep]') + ' Overwriting existing checkpoint (--force)...\n');
      await checkpointStore.clear();
    } else {
      // Error with helpful message
      const summary = await checkpointStore.getSummary();
      console.error(`${c.red('[error]')} Checkpoint exists from previous run.`);
      console.error(`  Stage: ${summary?.completedStage} → ${summary?.failedStage ?? 'complete'}`);
      console.error(`  Candidates: ${summary?.candidateCount}`);
      console.error(`  Timestamp: ${summary?.timestamp}`);
      console.error('');
      console.error(`  Use ${c.cyan('--resume')} to continue from checkpoint`);
      console.error(`  Use ${c.cyan('--force')} to start fresh (overwrites checkpoint)`);
      process.exit(1);
    }
  }

  console.error(c.cyan('[deep]') + ' Starting deep thinking mode...\n');

  // Resolve backend/model for notifications upfront
  // These values are used for notifications throughout the pipeline
  const base = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: options.backend ?? globalConfig.backend,
    globalConfig,
  });

  // Detect base CLI override: when -b or -m is passed, it should override all stages
  // This suppresses per-stage config defaults (DEEP_*) unless per-stage CLI flags are used
  const cliHasBaseBackend = options.backend !== undefined;
  const cliHasBaseModel = options.model !== undefined;
  const cliHasBaseOverride = cliHasBaseBackend || cliHasBaseModel;

  // Detect base reasoning override: when -r is passed, it should override all stages
  // This suppresses per-stage config defaults (DEEP_*_REASONING) unless per-stage CLI flags are used
  const cliHasBaseReasoning = options.reasoning !== undefined;

  // Merge CLI options with config defaults (CLI takes precedence)
  // For solver backends: CLI --solver-backends > CLI --distribute-solvers > config DEEP_SOLVER_BACKENDS
  // options.distributeSolvers is undefined if not set by CLI, true if --distribute-solvers passed
  // When base CLI override is present, suppress config-driven distribution
  const effectiveDistributeSolvers = options.distributeSolvers ?? (cliHasBaseOverride ? false : (deepConfig.distributeSolvers ?? false));
  const effectiveSolverBackends = options.solverBackends ?? (cliHasBaseOverride ? undefined : deepConfig.solverBackends);

  // Handle solver backend selection (potentially distributed)
  const solverBackendsResult = await selectSolverBackends({
    k: options.k ?? 4,
    distributeSolvers: effectiveDistributeSolvers,
    solverBackend: options.solverBackend,
    solverBackends: effectiveSolverBackends,
    solverModel: options.solverModel,
    baseBackend: base.backend,
  });

  // Log distribution mode (only when multiple backends)
  if (solverBackendsResult.mode === 'distributed') {
    const uniqueBackends = new Set(solverBackendsResult.backends);
    if (uniqueBackends.size > 1) {
      console.error(c.cyan('[deep]') + ` Distributed solver backends (round-robin): ${solverBackendsResult.backends.join(', ')}`);
    }
  }

  // Resolve single backend for notifications (use first if randomized)
  const solverBackendForNotification = solverBackendsResult.backends[0] ?? base.backend;
  // For distributed mode, resolve the model for the first backend instead of using base.model
  const solverModelForNotification = options.solverModel ?? (
    solverBackendsResult.mode === 'distributed' 
      ? resolveBackendModel({
          explicitBackend: solverBackendForNotification,
          globalConfig,
        }).model
      : base.model
  );

  // Merge CLI with config for judge (CLI stage flag > base CLI > config > defaults)
  // When cliHasBaseOverride, base CLI flags take precedence over config defaults
  // Edge case: if --judge-backend is set but not --judge-model, don't force base model (let backend resolve its default)
  const effectiveJudgeBackend = options.judgeBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.judgeBackend);
  const effectiveJudgeModel = options.judgeModel ?? (options.judgeBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.judgeModel)));

  // Resolve judge backend/model
  const judge = resolveBackendModel({
    explicitBackend: effectiveJudgeBackend,
    explicitModel: effectiveJudgeModel,
    fallbackBackend: base.backend,
    fallbackModel: effectiveJudgeBackend ? undefined : base.model,
    globalConfig,
  });

  // Merge CLI with config for verifier (CLI stage flag > base CLI > config > defaults)
  const effectiveVerifierBackend = options.verifierBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.verifierBackend);
  const effectiveVerifierModel = options.verifierModel ?? (options.verifierBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.verifierModel)));

  // Resolve verifier for display (only if verify is enabled)
  const verifier = (!options.noVerify && (effectiveVerifierModel || effectiveVerifierBackend || cliHasBaseOverride)) 
    ? resolveBackendModel({
        explicitBackend: effectiveVerifierBackend,
        explicitModel: effectiveVerifierModel,
        fallbackBackend: base.backend,
        fallbackModel: effectiveVerifierBackend ? undefined : base.model,
        globalConfig,
      })
    : { backend: judge.backend, model: judge.model };

  // Merge CLI with config for revision (CLI stage flag > base CLI > config > defaults)
  const effectiveRevisionBackend = options.revisionBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.revisionBackend);
  const effectiveRevisionModel = options.revisionModel ?? (options.revisionBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.revisionModel)));

  // Resolve revision for display (falls back to base when base override present)
  const revision = (!options.noVerify && (effectiveRevisionModel || effectiveRevisionBackend || cliHasBaseOverride))
    ? resolveBackendModel({
        explicitBackend: effectiveRevisionBackend,
        explicitModel: effectiveRevisionModel,
        fallbackBackend: base.backend,
        fallbackModel: effectiveRevisionBackend ? undefined : base.model,
        globalConfig,
      })
    : verifier;

  // Resolve effective reasoning for each stage (CLI stage flag > base -r > config > default)
  // When cliHasBaseReasoning, base -r takes precedence over config defaults
  const effectiveSolverReasoning = options.solverReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.solverReasoning)
    ?? resolveReasoning({ backend: solverBackendForNotification, globalConfig });

  const effectiveJudgeReasoning = options.judgeReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.judgeReasoning)
    ?? 'medium';

  const effectiveVerifierReasoning = options.verifierReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.verifierReasoning)
    ?? 'high';

  const effectiveRevisionReasoning = options.revisionReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.revisionReasoning)
    ?? effectiveVerifierReasoning;

  let finalResult: DeepThinkResult | undefined;
  
  // Create formatter state for progressive disclosure output
  const formatterState = createFormatterState();

  // Compute run identity hash for checkpointing
  const runIdentityHash = computeRunIdentityHash({
    prompt,
    context,
    options: {
      k: options.k,
      verify: !options.noVerify,
      categories: options.categories,
      modules: options.modules,
    },
  });

  // Run the pipeline
  for await (const event of runDeepThink(prompt, {
    backend: base.backend,  // Pass resolved backend to avoid duplicate resolution
    model: options.model,  // Pass explicit CLI model (undefined if not set) - pipeline resolves defaults
    k: options.k,
    verify: !options.noVerify,
    forceVerify: options.forceVerify,
    context,
    categories: options.categories,
    modules: options.modules,
    cwd: process.cwd(),
    // Per-stage overrides (CLI > config > defaults)
    solverBackends: solverBackendsResult.backends,
    solverModel: options.solverModel,
    solverReasoning: effectiveSolverReasoning,
    judgeReasoning: effectiveJudgeReasoning,
    verifyReasoning: effectiveVerifierReasoning,
    revisionReasoning: effectiveRevisionReasoning,
    judgeBackend: effectiveJudgeBackend,
    judgeModel: effectiveJudgeModel,
    verifierBackend: effectiveVerifierBackend,
    verifierModel: effectiveVerifierModel,
    revisionBackend: effectiveRevisionBackend,
    revisionModel: effectiveRevisionModel,
    // Checkpoint support
    runIdentityHash,
    onCheckpoint: async (checkpointData) => {
      // Build full checkpoint with version and identity
      const checkpoint = {
        checkpoint_version: 1 as const,
        runIdentityHash,
        ...checkpointData,
        timestamp: new Date().toISOString(),
      };
      await checkpointStore.save(checkpoint);
    },
    // Resume from checkpoint if --resume flag is set
    resumeCheckpoint: options.resume && existingCheckpoint ? {
      trace: existingCheckpoint.trace,
      status: existingCheckpoint.status,
      completedStage: existingCheckpoint.completedStage,
      failedStage: existingCheckpoint.failedStage,
      error: existingCheckpoint.error,
      successfulCandidateIds: existingCheckpoint.successfulCandidateIds,
      judgeSeed: existingCheckpoint.judgeSeed,
      judgeIndexMapping: existingCheckpoint.judgeIndexMapping,
      judgeSelectedIndex: existingCheckpoint.judgeSelectedIndex,
      judgeSelectedDisplayIndex: existingCheckpoint.judgeSelectedDisplayIndex,
      selectedCandidateId: existingCheckpoint.selectedCandidateId,
      verifyChecks: existingCheckpoint.verifyChecks,
      partialVerifyResults: existingCheckpoint.partialVerifyResults,
      usageAtCheckpoint: existingCheckpoint.usageAtCheckpoint,
    } : undefined,
  })) {
    await handleEvent(event, options, prompt, globalConfig.notify, solverBackendForNotification, solverModelForNotification, effectiveSolverReasoning, judge.backend, judge.model, verifier.backend, verifier.model, revision.backend, revision.model, formatterState);

    // Capture final result for trace
    if (event.type === 'complete' && event.result) {
      finalResult = event.result;
    }
  }

  // Write trace if requested
  if (options.trace && finalResult?.trace) {
    await writeTrace(options.trace, finalResult);
  }

  // Clear checkpoint on success
  if (finalResult) {
    await checkpointStore.clear();
  }

  // Persist session for resumability
  if (finalResult?.sessionId && finalResult?.sessionBackend) {
    const conversationStore = new ConversationStore({ sessionId: options.session });
    await conversationStore.save({
      backend: finalResult.sessionBackend,
      threadId: finalResult.sessionId,
    });
  } else if (!finalResult?.sessionId) {
    // Log warning if backend doesn't support sessions
    const stageName = finalResult?.wasRevised ? 'verifier' : 'judge';
    const backendName = finalResult?.sessionBackend ?? options.backend ?? 'unknown';
    console.error(`${c.yellow('[warn]')} Backend '${backendName}' (${stageName}) does not support resumability (no sessionId returned)`);  }
}

async function handleEvent(
  event: DeepThinkEvent,
  options: CliOptions,
  prompt: string,
  globalNotify?: boolean,
  solverBackend?: string,
  solverModel?: string,
  solverReasoning?: string,
  judgeBackend?: string,
  judgeModel?: string,
  verifierBackend?: string,
  verifierModel?: string,
  revisionBackend?: string,
  revisionModel?: string,
  formatterState?: FormatterState
): Promise<void> {
  const shouldNotify = options.notify ?? globalNotify ?? true;
  const state = formatterState ?? createFormatterState();

  switch (event.type) {
    case 'stage_start': {
      // Emit phase header with dotted separator
      if (event.stage === 'solve') {
        const suffix = solverReasoning ? `reasoning: ${solverReasoning}` : undefined;
        console.error(formatPhaseHeader('solve', suffix));
        state.phase = 'solve';
      } else if (event.stage === 'verify') {
        const suffix = verifierModel ?? verifierBackend;
        console.error(`\n${formatPhaseHeader('verify', suffix)}`);
        state.phase = 'verify';
      } else if (event.stage === 'revise') {
        const suffix = revisionModel ?? revisionBackend ?? verifierModel ?? verifierBackend;
        console.error(`\n${formatPhaseHeader('revise', suffix)}`);
        state.phase = 'revise';
      }
      break;
    }

    case 'tool_start': {
      // Stream solver tool events immediately with backend/model info
      if (event.member?.type === 'solver' && event.content) {
        const module = event.member.module ?? 'unknown';
        console.error(formatSolverToolEvent(
          event.member.index,
          event.member.backend,
          event.member.model,
          module,
          event.content,
          event.toolInput
        ));
      }
      // For verifier, show tool execution with check number
      if (event.member?.type === 'verifier' && event.content) {
        const qNum = event.checkIndex !== undefined ? `Q${event.checkIndex + 1}` : '';
        const prefix = qNum ? `[verifier:${qNum}] → ` : '→ ';
        console.error(c.dim(`  ${prefix}${formatToolStartNew(event.content, event.toolInput)}`));
      }
      break;
    }

    case 'solver_complete': {
      // Emit solver completion summary with backend/model info
      const module = event.member?.module ?? 'unknown';
      const outputTokens = event.usage?.outputTokens;
      const solverIndex = event.member?.index ?? 0;
      const backend = event.member?.backend ?? event.backend ?? solverBackend ?? 'unknown';
      const model = event.member?.model ?? event.model ?? solverModel ?? 'unknown';
      
      console.error(formatSolverComplete(solverIndex, backend, model, module, outputTokens));

      // Notification
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Solver '${module}' complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend, model }));
      }
      break;
    }

    case 'ensemble_complete': {
      // Show ensemble summary and transition to judge phase
      console.error(formatPhaseSummary('ensemble complete'));
      
      // Emit judge phase header (candidates come next)
      const suffix = judgeModel ?? judgeBackend;
      console.error(`\n${formatPhaseHeader('judge', suffix)}`);
      state.phase = 'judge';
      
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Solvers complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend: solverBackend, model: solverModel }));
      }
      break;
    }

    case 'candidate': {
      // Parse candidate number from content (e.g., "Candidate 1: ...")
      const match = event.content?.match(/^Candidate (\d+): (.*)$/s);
      if (match) {
        const candidateIndex = parseInt(match[1], 10) - 1;
        const content = match[2];
        // Show candidate separator with solver info if available
        const m = event.member;
        const solverInfo = m ? `[solver-${m.index + 1}:${m.backend}:${m.model}:${m.module}]` : '';
        console.error(formatCandidateSeparator(candidateIndex, solverInfo));
        console.error(formatCandidateContent(content));
      } else {
        // Fallback: just show content (e.g., shuffle note)
        console.error(c.dim(`  ${event.content}`));
      }
      break;
    }

    case 'selected': {
      // Add visual separation between candidates and judge decision
      // Use the same separator style as candidates for consistency
      const { symbols } = FORMAT_CONFIG;
      const label = 'decision';
      const dashes = symbols.separator.repeat(Math.max(0, FORMAT_CONFIG.lineWidth - label.length - 4));
      console.error('');
      console.error(c.dim(`  ${label} ${dashes}`));
      console.error('');
      
      if (event.consensusAnalysis) {
        console.error(c.cyan('  consensus:'));
        const lines = event.consensusAnalysis.split('\n');
        for (const line of lines) {
          console.error(c.dim(`    ${line}`));
        }
      }

      // Newline before selected
      console.error('');
      console.error(c.cyan('  selected:'));
      
      // Candidate number
      console.error(c.green(`    Candidate #${(event.selectedIndex ?? 0) + 1}`));
      
      // Member ID line (solver-N:backend:model:category/module_id)
      if (event.selectedMember) {
        const m = event.selectedMember;
        const moduleSpec = event.selectedModule 
          ? `${event.selectedModule.category}/${event.selectedModule.id}`
          : 'unknown';
        console.error(c.dim(`    [solver-${m.index + 1}:${m.backend}:${m.model}:${moduleSpec}]`));
      }
      
      // Module details line
      if (event.selectedModule) {
        const mod = event.selectedModule;
        console.error(c.dim(`    Module: ${mod.name}`));
        // Prompt may be missing when resuming from checkpoint (not stored in trace)
        if (mod.prompt) {
          console.error(c.dim(`    Prompt: "${mod.prompt}"`));
        }
      }
      
      // Confidence
      const pct = ((event.confidence ?? 0) * 100).toFixed(0);
      console.error(c.dim(`    (${pct}% confidence)`));

      // Newline before rationale
      if (event.reasoning) {
        console.error('');
        console.error(c.cyan('  rationale:'));
        const lines = event.reasoning.split('\n');
        for (const line of lines) {
          console.error(c.dim(`    ${line}`));
        }
      }
      break;
    }

    case 'stage_complete': {
      const isJudge = event.stage === 'solve';
      
      if (isJudge && event.usage) {
        console.error(formatStageUsage(event.usage.inputTokens, event.usage.outputTokens));
      }
      
      if (!isJudge && event.stage === 'verify') {
        // Show verify summary with contradiction count
        const summary = event.content ? `complete (${event.content})` : 'complete';
        console.error(formatPhaseSummary(summary));
      }
      
      if (!isJudge && event.stage === 'revise') {
        console.error(formatPhaseSummary('complete'));
      }
      
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) => {
          const msg = isJudge ? 'Judge complete' : event.stage === 'revise' ? 'Revision complete' : 'Verifier complete';
          const backend = isJudge ? judgeBackend : verifierBackend;
          const model = isJudge ? judgeModel : verifierModel;
          notify({ title: 'Veda Deep', message: `${msg}: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend, model });
        });
      }
      break;
    }

    case 'verified': {
      // Legacy event - now using revision_complete
      const changes = event.content?.replace(/^Revised:\s*/, '') ?? '';
      console.error(formatRevision(changes));
      break;
    }

    case 'revision_complete': {
      // Show revision changes with separator
      const { symbols } = FORMAT_CONFIG;
      const label = 'revision';
      const dashes = symbols.separator.repeat(Math.max(0, FORMAT_CONFIG.lineWidth - label.length - 4));
      console.error('');
      console.error(c.dim(`  ${label} ${dashes}`));
      
      if (event.content) {
        const changes = event.content.split('\n');
        for (const change of changes) {
          if (change.trim()) {
            console.error(c.dim(`  - ${change.trim()}`));
          }
        }
      }
      break;
    }

    case 'verify_questions': {
      // Display generated verification questions
      if (event.checks && event.checks.length > 0) {
        console.error('');
        console.error(c.cyan('  Verification Questions:'));
        for (let i = 0; i < event.checks.length; i++) {
          const check = event.checks[i];
          const difficultyTag = check.difficulty ? c.dim(` [${check.difficulty}]`) : '';
          console.error(c.dim(`  Q${i + 1}. ${check.question}${difficultyTag}`));
        }
        console.error('');
      }
      break;
    }

    case 'verify_check_complete': {
      // Show check completion with verdict
      const qNum = (event.checkIndex ?? 0) + 1;
      const verdict = event.verdict ?? 'uncertain';
      const conf = event.confidence !== undefined ? `${(event.confidence * 100).toFixed(0)}%` : '';
      const verdictColor = verdict === 'supports' ? c.green : verdict === 'contradicts' ? c.red : c.yellow;
      console.error(c.dim(`  [verifier:Q${qNum}] → `) + verdictColor(verdict) + c.dim(conf ? ` (${conf})` : ''));
      break;
    }

    case 'error':
      console.error(`${c.red('Error:')} ${event.content}`);
      process.exit(1);
      break;

    case 'complete': {
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend: solverBackend, model: solverModel }));
      }
      
      if (event.result) {
        const stages = getDeepThinkStages(event.result.trace);
        
        // Final separator and summary
        console.error(`\n${formatFinalSeparator()}`);
        console.error(formatCompletionStatus(stages, event.result.confidence, event.result.wasRevised));
        console.error(formatFinalTokens(event.result.usage.inputTokens, event.result.usage.outputTokens));
        console.error('');

        // Output final answer
        if (options.output) {
          Bun.write(options.output, event.result.answer);
          console.error(`Response saved to ${options.output}`);
        } else if (options.json) {
          console.log(JSON.stringify(event.result, null, 2));
        } else {
          // Flush stderr before writing stdout to maintain output order
          await new Promise<void>((resolve) => {
            process.stderr.write('', () => resolve());
          });
          console.log(event.result.answer);
        }
      }
      break;
    }
  }
}

async function buildContext(store: ContextStore): Promise<string> {
  const cwd = process.cwd();
  const entries = await store.list();
  
  const results = await Promise.all(
    entries.map(entry => readSliceText({
      cwd,
      slice: entry.slice,
    }))
  );

  const parts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const res = results[i];
    
    if (res.ok) {
      parts.push(`## ${entry.original}\n\`\`\`\n${res.value.content}\n\`\`\``);
    }
  }
  
  return parts.join('\n\n');
}

async function buildAdhocContext(files: string[]): Promise<string> {
  const cwd = process.cwd();
  
  const results = await Promise.all(
    files.map(path => {
      const slice = parseSlice(path);
      const absolutePath = resolve(cwd, slice.path);
      return readSliceText({
        cwd,
        slice: { ...slice, path: absolutePath },
      });
    })
  );

  const parts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    const res = results[i];
    
    if (res.ok) {
      parts.push(`## ${path}\n\`\`\`\n${res.value.content}\n\`\`\``);
    }
  }
  
  return parts.join('\n\n');
}

/**
 * Write trace to YAML file.
 */
async function writeTrace(path: string, result: DeepThinkResult): Promise<void> {
  if (!result.trace) return;

  const trace = result.trace;
  const stages = getDeepThinkStages(trace);

  // Build YAML-friendly trace document
  const doc = {
    trace_version: 2,
    run: {
      timestamp: new Date().toISOString(),
      confidence: result.confidence,
      was_revised: result.wasRevised,
      stages: stages,
    },
    prompt: trace.prompt,
    ...(trace.context && { context: trace.context }),
    options: trace.options,
    solve: {
      candidates: trace.solve.candidates.map(c => {
        const candidate: Record<string, unknown> = {
          id: c.id,
          module: c.module,
          response: c.response,
        };
        if (c.usage) candidate.usage = c.usage;
        if (c.legacyId) candidate.legacy_id = c.legacyId;  // Use snake_case for YAML
        return candidate;
      }),
    },
    judge: {
      selected_index: trace.judge.selectedIndex,
      selected_display_index: trace.judge.selectedDisplayIndex,
      confidence: trace.judge.confidence,
      ...(trace.judge.consensusAnalysis && { consensus_analysis: trace.judge.consensusAnalysis }),
      ...(trace.judge.reasoning && { reasoning: trace.judge.reasoning }),
    },
    ...(trace.verify && {
      verify: {
        checks: trace.verify.checks,
        results: trace.verify.results,
        ...(trace.verify.revision && { revision: trace.verify.revision }),
      },
    }),
    final: {
      answer: result.answer,
    },
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
  };

  try {
    const yaml = yamlStringify(doc, {
      lineWidth: 120,
      defaultKeyType: 'PLAIN',
      blockQuote: 'literal',
      // Use block style for long strings, flow for short
      collectionStyle: 'block',
    });
    await Bun.write(path, yaml);
    console.error(`${c.dim('[trace]')} Saved to ${path}`);
  } catch (error) {
    console.error(`${c.yellow('[trace]')} Warning: failed to write trace to ${path}: ${error instanceof Error ? error.message : error}`);
  }
}
