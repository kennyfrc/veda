import { ContextStore, readSliceText, parseSlice } from '../context';
import { runDeepThink, getDeepThinkStages, type DeepThinkEvent, type DeepThinkResult } from '../pipelines';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { stringify as yamlStringify } from 'yaml';
import { resolve } from 'path';
import { loadGlobalConfig, resolveBackendModel } from '../agent/config';
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
  formatSelection,
  formatJudgeReasoning,
  formatRevision,
  formatStageUsage,
  formatFinalSeparator,
  formatCompletionStatus,
  formatFinalTokens,
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

  console.error(c.cyan('[deep]') + ' Starting deep thinking mode...\n');

  // Resolve backend/model for notifications upfront
  // These values are used for notifications throughout the pipeline
  const base = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: options.backend ?? globalConfig.backend,
    globalConfig,
  });

  // Handle solver backend selection (potentially distributed)
  const solverBackendsResult = await selectSolverBackends({
    k: options.k ?? 4,
    distributeSolvers: options.distributeSolvers,
    solverBackend: options.solverBackend,
    solverBackends: options.solverBackends,
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
  const solverModelForNotification = options.solverModel ?? base.model;

  const judge = resolveBackendModel({
    explicitBackend: options.judgeBackend,
    explicitModel: options.judgeModel,
    fallbackBackend: base.backend,
    fallbackModel: base.model,
    globalConfig,
  });

  // Resolve verifier for display (only if verify is enabled)
  const verifier = (!options.noVerify && (options.verifierModel || options.verifierBackend)) 
    ? resolveBackendModel({
        explicitBackend: options.verifierBackend,
        explicitModel: options.verifierModel,
        fallbackBackend: judge.backend,
        fallbackModel: judge.model,  // Verifier follows judge unless explicitly overridden
        globalConfig,
      })
    : { backend: judge.backend, model: judge.model };

  let finalResult: DeepThinkResult | undefined;
  
  // Create formatter state for progressive disclosure output
  const formatterState = createFormatterState();

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
    // Per-stage overrides
    solverBackends: solverBackendsResult.backends,
    solverModel: options.solverModel,
    judgeBackend: options.judgeBackend,
    judgeModel: options.judgeModel,
    verifierBackend: options.verifierBackend,
    verifierModel: options.verifierModel,
  })) {
    await handleEvent(event, options, prompt, globalConfig.notify, solverBackendForNotification, solverModelForNotification, judge.backend, judge.model, verifier.backend, verifier.model, formatterState);

    // Capture final result for trace
    if (event.type === 'complete' && event.result) {
      finalResult = event.result;
    }
  }

  // Write trace if requested
  if (options.trace && finalResult?.trace) {
    await writeTrace(options.trace, finalResult);
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
  judgeBackend?: string,
  judgeModel?: string,
  verifierBackend?: string,
  verifierModel?: string,
  formatterState?: FormatterState
): Promise<void> {
  const shouldNotify = options.notify ?? globalNotify ?? true;
  const state = formatterState ?? createFormatterState();

  switch (event.type) {
    case 'stage_start': {
      // Emit phase header with dotted separator
      if (event.stage === 'solve') {
        console.error(formatPhaseHeader('solve'));
        state.phase = 'solve';
      } else if (event.stage === 'verify') {
        const suffix = verifierModel ?? verifierBackend;
        console.error(`\n${formatPhaseHeader('verify', suffix)}`);
        state.phase = 'verify';
      }
      break;
    }

    case 'tool_start': {
      // Stream solver tool events immediately with backend/model info
      if (event.member?.type === 'solver' && event.content) {
        console.error(formatSolverToolEvent(
          event.member.index,
          event.member.backend,
          event.member.model,
          event.content,
          event.toolInput
        ));
      }
      // For verifier, show tool execution inline (dimmed)
      if (event.member?.type === 'verifier' && event.content) {
        console.error(c.dim(`  → ${formatToolStartNew(event.content, event.toolInput)}`));
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
        console.error(formatCandidateSeparator(candidateIndex));
        console.error(formatCandidateContent(content));
      } else {
        // Fallback: just show content
        console.error(c.dim(`  ${event.content}`));
      }
      break;
    }

    case 'selected': {
      console.error(formatSelection(event.selectedIndex ?? 0, event.confidence ?? 0));
      if (event.reasoning) {
        console.error(formatJudgeReasoning(event.reasoning));
      }
      break;
    }

    case 'stage_complete': {
      const isJudge = event.stage === 'solve';
      
      if (isJudge && event.usage) {
        console.error(formatStageUsage(event.usage.inputTokens, event.usage.outputTokens));
      }
      
      if (!isJudge && event.stage === 'verify') {
        console.error(formatPhaseSummary('complete'));
      }
      
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) => {
          const msg = isJudge ? 'Judge complete' : 'Verifier complete';
          const backend = isJudge ? judgeBackend : verifierBackend;
          const model = isJudge ? judgeModel : verifierModel;
          notify({ title: 'Veda Deep', message: `${msg}: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend, model });
        });
      }
      break;
    }

    case 'verified': {
      // Extract changes from content (e.g., "Revised: change1, change2")
      const changes = event.content?.replace(/^Revised:\s*/, '') ?? '';
      console.error(formatRevision(changes));
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
      confidence: trace.judge.confidence,
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
