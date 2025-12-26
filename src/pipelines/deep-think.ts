// DeepThink: parallel solvers → judge aggregation → optional verification.

import { loadGlobalConfig, resolveBackendModel } from '../agent/config';
import { AsyncQueue, c } from '../util';
import type { Message, UsageStats } from '../backend';
import {
  runEnsemble,
  runJudge,
  runVerification,
  combineUsage,
  selectModules,
  isUnchanged,
  type EnsembleMember,
  type EnsembleEvent,
  type Reasoning,
  type ReasoningModule,
} from '../core';
import {
  buildDeepSolverSystemPrompt,
  JUDGE_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
} from './prompts';

/**
 * Standardized member ID format: type-index-backend-model-module
 * Examples: solver-0-claude-code-opus-analytical, judge-0-gemini-cli-gemini-pro-NA, verifier-0-codex-gpt-5.2-factual
 */
interface MemberIdParts {
  type: 'solver' | 'judge' | 'verifier';
  backend: string;
  model: string;
  index: number;
  module: string;
}

/**
 * Standardized member metadata attached to events.
 * Notifications and tool events use this instead of parsing IDs.
 */
interface MemberMeta {
  type: 'solver' | 'judge' | 'verifier';
  backend: string;
  model: string;
  index: number;
  module: string;
  id: string;  // Canonical formatted ID
}

function formatMemberId(parts: MemberIdParts): string {
  const { type, index, backend, model, module } = parts;
  return `${type}-${index}-${backend}-${model}-${module}`;
}

export interface DeepThinkOptions {
  backend?: string;
  model?: string;
  k?: number;
  verify?: boolean;
  forceVerify?: boolean;
  context?: string;
  solverReasoning?: Reasoning;
  judgeReasoning?: Reasoning;
  verifyReasoning?: Reasoning;
  categories?: string[];
  modules?: string[];
  cwd?: string;
  solverBackends?: string[];  // Array of backends for parallel solvers (supports randomization)
  solverModel?: string;
  judgeBackend?: string;
  judgeModel?: string;
  verifierBackend?: string;
  verifierModel?: string;
}

export interface SolverOptions {
  /** Number of parallel solvers (1-8) */
  k: number;
  /** Specific modules to use (overrides k) */
  modules?: string[];
  /** Categories to sample from */
  categories?: string[];
  /** Backend(s) for solvers (supports randomization) */
  backends: string[];
  /** Model override for solvers (may be undefined if not set) */
  model?: string;
  /** Resolved model per backend */
  backendModels: Map<string, string>;
  /** Reasoning level */
  reasoning: Reasoning;
  /** Sandbox mode */
  sandbox: 'read-only' | 'workspace-write' | 'full';
  /** Working directory */
  cwd: string;
  /** Context data */
  context?: string;
}

export interface JudgeOptions {
  /** Backend for judge */
  backend: string;
  /** Model override for judge */
  model: string;
  /** System prompt */
  systemPrompt: string;
  /** Reasoning level */
  reasoning: Reasoning;
  /** Sandbox mode */
  sandbox: 'read-only' | 'workspace-write' | 'full';
  /** Working directory */
  cwd: string;
}

export interface VerifierOptions {
  /** Backend for verifier */
  backend: string;
  /** Model override for verifier */
  model: string;
  /** System prompt */
  systemPrompt: string;
  /** Type of verification */
  type: 'factual' | 'code' | 'reasoning';
  /** Reasoning level */
  reasoning: Reasoning;
  /** Sandbox mode */
  sandbox: 'read-only' | 'workspace-write' | 'full';
  /** Working directory */
  cwd: string;
}

export interface DeepThinkResult {
  answer: string;
  confidence: number;
  candidates: string[];
  wasRevised: boolean;
  usage: UsageStats;
  trace?: DeepThinkTrace;
  sessionId?: string;  // Backend's thread ID from last stage (judge or verifier)
  sessionBackend?: string;  // Which backend produced the last stage (for resume)
}

export interface DeepThinkTrace {
  trace_version: 2;  // Bumped from 1 to 2 for new ID format
  prompt: string;
  context?: string;
  options: {
    backend: string;
    model?: string;
    k: number;
    verify: boolean;
    forceVerify?: boolean;
    categories?: string[];
    modules?: string[];
    solver?: { backend: string; model?: string };
    solverBackends?: string[];  // Randomized backends used
    judge?: { backend: string; model?: string };
    verifier?: { backend: string; model?: string };
  };
  solve: {
    candidates: Array<{
      id: string;
      legacyId?: string;  // Old format for backward compatibility: solver-${i}-${category}
      module: { id: string; category: string; name: string };
      response: string;
      usage?: UsageStats;
    }>;
  };
  judge: {
    selectedIndex: number;
    confidence: number;
    reasoning?: string;
  };
  verify?: {
    checks: Array<{ id: string; question: string; targetClaim?: string }>;
    results: Array<{
      checkId: string;
      answer: string;
      verdict: 'supports' | 'contradicts' | 'uncertain';
      confidence: number;
    }>;
    revision?: { changes: string[]; revised: string };
  };
}

export interface DeepThinkEvent {
  type: 'stage_start' | 'stage_complete' | 'candidate' | 'selected' | 'verified' | 'complete' | 'tool_start' | 'error' | 'ensemble_complete' | 'solver_complete';
  stage?: string;
  content?: string;
  source?: string;
  backend?: string;  // Backend used for this specific solver (for notifications)
  model?: string;    // Model used for this specific solver (for notifications)
  member?: MemberMeta;  // Structured member metadata (type, backend, model, index, module, id)
  toolInput?: unknown;
  confidence?: number;
  selectedIndex?: number;  // For 'selected' event: which candidate was selected (0-indexed)
  reasoning?: string;  // For 'selected' event: judge's reasoning for the selection
  usage?: UsageStats;
  result?: DeepThinkResult;
}

export interface RunSolverEnsembleResult {
  candidates: string[];
  modules: ReasoningModule[];
  outputs: Array<{
    id: string;
    module: { id: string; category: string; name: string };
    response: string;
    usage?: UsageStats;
  }>;
  usage: UsageStats;
  errors: string[];
}

export interface RunJudgeSelectionResult {
  selected: string;
  confidence: number;
  selectedIndex: number;
  reasoning?: string;
  usage: UsageStats;
  sessionId?: string;
}

export interface RunVerificationPipelineResult {
  revised: string;
  changes: string[];
  wasRevised: boolean;
  checks: Array<{ id: string; question: string; targetClaim?: string }>;
  results: Array<{
    checkId: string;
    answer: string;
    verdict: 'supports' | 'contradicts' | 'uncertain';
    confidence: number;
  }>;
  usage: UsageStats;
  sessionId?: string;
}

async function expandDeepThinkOptions(options: DeepThinkOptions): Promise<{
  solver: SolverOptions;
  judge: JudgeOptions;
  verifier: VerifierOptions | null;
  verifyEnabled: boolean;  // User enabled verification (may not run if confidence high)
  forceVerify: boolean;  // Force verification regardless of confidence
  traceOptions: {
    backend: string;
    model?: string;
    k: number;
    verify: boolean;
    forceVerify?: boolean;
    categories?: string[];
    modules?: string[];
    solver: { backend: string; model?: string };
    solverBackends: string[];
    judge: { backend: string; model?: string };
    verifier?: { backend: string; model?: string };
  };
}> {
  const globalConfig = await loadGlobalConfig();

  // Step 1: Resolve base backend/model
  const base = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: options.backend ?? globalConfig.backend,
    globalConfig,
  });

  // Step 2: Resolve solver configs
  // If solverModel is specified without solverBackends, infer backend from model
  let solverBackends: string[];
  if (options.solverBackends) {
    solverBackends = options.solverBackends;
  } else if (options.solverModel) {
    // Infer backend from solver model
    const solverResolved = resolveBackendModel({
      explicitModel: options.solverModel,
      fallbackBackend: base.backend,
      globalConfig,
    });
    solverBackends = [solverResolved.backend];
  } else {
    solverBackends = [base.backend];
  }

  // Validate: -m/--model conflicts with multi-backend distribution
  const uniqueSolverBackends = new Set(solverBackends);
  if (options.model && uniqueSolverBackends.size > 1) {
    throw new Error(
      `Cannot use -m/--model with --distribute-solvers across multiple backends. ` +
      `Either remove --distribute-solvers, remove -m, or use --solver-model with backend-specific models.`
    );
  }

  const backendModels = new Map<string, string>();

  for (const backend of uniqueSolverBackends) {
    // If -m is specified, use that model for all solvers.
    // Otherwise, let each backend use its own default model.
    const resolved = resolveBackendModel({
      explicitBackend: backend,
      explicitModel: options.solverModel,
      fallbackBackend: backend,
      fallbackModel: options.model,  // Only inherit if user explicitly passed -m (undefined otherwise)
      globalConfig,
    });
    if (!resolved.model) {
      throw new Error(`Unable to resolve model for solver backend '${backend}'. Specify --solver-model or set MODEL in config.`);
    }
    backendModels.set(backend, resolved.model);
  }

  const solverConfig: SolverOptions = {
    k: options.k ?? 3,
    modules: options.modules,
    categories: options.categories,
    backends: solverBackends,
    model: options.solverModel,
    backendModels,
    reasoning: options.solverReasoning ?? 'medium',
    sandbox: 'read-only',
    cwd: options.cwd ?? process.cwd(),
    context: options.context,
  };

  // Step 3: Resolve judge config
  // When using distributed solvers, default judge to first solver's backend
  // Otherwise, use base backend
  let judgeFallbackBackend: string;
  if (options.judgeModel) {
    // Let model drive backend resolution
    judgeFallbackBackend = base.backend;  // Will be overridden by model alias
  } else if (options.solverBackends && options.solverBackends.length > 1) {
    judgeFallbackBackend = options.solverBackends[0];  // First solver's backend
  } else if (solverBackends && solverBackends.length > 1) {
    judgeFallbackBackend = solverBackends[0];  // First solver's backend
  } else {
    judgeFallbackBackend = base.backend;
  }

  const judge = resolveBackendModel({
    explicitBackend: options.judgeBackend,
    explicitModel: options.judgeModel,
    fallbackBackend: judgeFallbackBackend,
    fallbackModel: base.model,  // Inherit from -m if specified
    globalConfig,
  });

  if (!judge.model) {
    throw new Error(`Unable to resolve model for judge backend '${judge.backend}'. Specify --judge-model or set MODEL in config.`);
  }

  const judgeConfig: JudgeOptions = {
    backend: judge.backend,
    model: judge.model,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    reasoning: options.judgeReasoning ?? 'medium',
    sandbox: 'read-only',
    cwd: options.cwd ?? process.cwd(),
  };

  // Step 4: Resolve verifier config (if enabled)
  let verifierConfig: VerifierOptions | null = null;
  const verifyEnabled = options.verify ?? true;
  const forceVerify = options.forceVerify ?? false;

  if (verifyEnabled) {
    // If --verifier-model is specified, let it auto-resolve the backend
    // Otherwise, use judge's backend (for consistency) or base backend
    let verifierFallbackBackend: string;
    if (options.verifierModel) {
      verifierFallbackBackend = judge.backend;  // Let model drive backend resolution
    } else {
      verifierFallbackBackend = judge.backend;
    }

    const verifier = resolveBackendModel({
      explicitBackend: options.verifierBackend,
      explicitModel: options.verifierModel,
      fallbackBackend: verifierFallbackBackend,
      fallbackModel: judge.model,  // Verifier follows judge unless explicitly overridden
      globalConfig,
    });

    if (verifier.model) {
      verifierConfig = {
        backend: verifier.backend,
        model: verifier.model,
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        type: 'reasoning',
        reasoning: options.verifyReasoning ?? 'high',
        sandbox: 'full',
        cwd: options.cwd ?? process.cwd(),
      };
    }
  }

  // Step 5: Build trace options
  const traceOptions = {
    backend: base.backend,
    model: base.model,
    k: solverConfig.k,
    verify: verifyEnabled,
    forceVerify,
    categories: solverConfig.categories,
    modules: solverConfig.modules,
    solver: {
      backend: solverBackends[0],
      model: backendModels.get(solverBackends[0]),
    },
    solverBackends,
    judge: {
      backend: judgeConfig.backend,
      model: judgeConfig.model,
    },
    verifier: verifierConfig ? {
      backend: verifierConfig.backend,
      model: verifierConfig.model,
    } : undefined,
  };

  return { solver: solverConfig, judge: judgeConfig, verifier: verifierConfig, verifyEnabled, forceVerify, traceOptions };
}

export async function runSolverEnsemble(
  prompt: string,
  options: SolverOptions,
  onEvent?: (event: EnsembleEvent) => void
): Promise<RunSolverEnsembleResult> {
  const modules = selectModules({
    k: options.k,
    categories: options.modules ? undefined : options.categories,
    modules: options.modules,
  });

  const members: EnsembleMember[] = modules.map((module, i) => {
    const backend = options.backends[i % options.backends.length];
    const model = options.backendModels.get(backend) ?? options.model;
    const memberId = formatMemberId({
      type: 'solver',
      backend,
      model: model ?? 'unknown',
      index: i,
      module: module.category,
    });
    return {
      id: memberId,
      request: {
        backend,
        model,
        prompt,
        context: options.context,
        systemPrompt: buildDeepSolverSystemPrompt({ module }),
        reasoning: options.reasoning,
        sandbox: options.sandbox,
        cwd: options.cwd,
      },
    };
  });

  const ensembleResult = await runEnsemble(members, onEvent);

  const outputs = ensembleResult.outputs.map((output, i) => ({
    id: output.id,
    module: {
      id: modules[i].id,
      category: modules[i].category,
      name: modules[i].name,
    },
    response: output.text,
    usage: output.usage,
  }));

  const errors = ensembleResult.outputs.flatMap(o => o.backendErrors ?? []);
  const exceptionErrors = ensembleResult.outputs
    .filter(o => o.error)
    .map(o => o.error!);

  return {
    candidates: ensembleResult.successful,
    modules,
    outputs,
    usage: ensembleResult.totalUsage,
    errors: errors.length > 0 ? errors : exceptionErrors,
  };
}

export async function runJudgeSelection(
  candidates: string[],
  originalTask: string,
  options: JudgeOptions,
  onMessage?: (msg: Message) => void
): Promise<RunJudgeSelectionResult> {
  if (candidates.length === 0) {
    throw new Error('No candidates to judge');
  }

  const result = await runJudge({
    backend: options.backend,
    model: options.model,
    systemPrompt: options.systemPrompt,
    reasoning: options.reasoning,
    sandbox: options.sandbox,
    cwd: options.cwd,
    candidates,
    originalTask,
    onMessage,
  });

  return {
    selected: result.selected,
    confidence: result.decision.confidence,
    selectedIndex: result.decision.selectedIndex,
    reasoning: result.decision.reasoning,
    usage: result.usage,
    sessionId: result.sessionId,
  };
}

export async function runVerificationPipeline(
  draft: string,
  originalTask: string,
  options: VerifierOptions,
  onMessage?: (msg: Message) => void
): Promise<RunVerificationPipelineResult> {
  const result = await runVerification({
    backend: options.backend,
    model: options.model,
    systemPrompt: options.systemPrompt,
    reasoning: options.reasoning,
    sandbox: options.sandbox,
    cwd: options.cwd,
    type: options.type,
    draft,
    originalTask,
    onMessage,
  });

  if (result.revision && !isUnchanged(result.revision, draft)) {
    return {
      revised: result.revision.revised,
      changes: result.revision.changes,
      wasRevised: true,
      checks: result.checks.map(c => ({
        id: c.id,
        question: c.question,
        targetClaim: c.targetClaim,
      })),
      results: result.results.map(r => ({
        checkId: r.checkId,
        answer: r.answer,
        verdict: r.verdict,
        confidence: r.confidence,
      })),
      usage: result.usage,
      sessionId: result.sessionId,
    };
  }

  return {
    revised: draft,
    changes: [],
    wasRevised: false,
    checks: result.checks.map(c => ({
      id: c.id,
      question: c.question,
      targetClaim: c.targetClaim,
    })),
    results: result.results.map(r => ({
      checkId: r.checkId,
      answer: r.answer,
      verdict: r.verdict,
      confidence: r.confidence,
    })),
    usage: result.usage,
    sessionId: result.sessionId,
  };
}

export async function* runDeepThink(
  prompt: string,
  options: DeepThinkOptions = {}
): AsyncGenerator<DeepThinkEvent> {
  const queue = new AsyncQueue<DeepThinkEvent>();
  const usages: (UsageStats | undefined)[] = [];

  const makeToolEvent = (source: string, msg: Message): DeepThinkEvent | null => {
    if (msg.type !== 'tool_start' && msg.type !== 'tool_use') return null;
    return {
      type: 'tool_start',
      source,
      content: msg.toolName,
      toolInput: msg.toolInput,
    };
  };

  // Run the main logic in the background
  (async () => {
    try {
      // Step 1: Expand options into configured structs
      const { solver, judge, verifier, verifyEnabled, forceVerify, traceOptions } = await expandDeepThinkOptions(options);

      // Step 2: Build trace with expanded options
      const trace: DeepThinkTrace = {
        trace_version: 2,  // Bumped from 1 to 2 for new ID format
        prompt,
        context: solver.context,
        options: traceOptions,
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0 },
      };

      // Step 3: Run solver ensemble
      queue.push({ type: 'stage_start', stage: 'solve' });

      const modules = selectModules({
        k: solver.k,
        categories: solver.categories,
        modules: solver.modules,
      });

      const members: EnsembleMember[] = modules.map((module, i) => {
        const backend = solver.backends[i % solver.backends.length];
        const model = solver.backendModels.get(backend) ?? solver.model;
        const memberId = formatMemberId({
          type: 'solver',
          backend,
          model: model ?? 'unknown',
          index: i,
          module: module.category,
        });
        return {
          id: memberId,
          request: {
            backend,
            model,
            prompt,
            context: solver.context,
            systemPrompt: buildDeepSolverSystemPrompt({ module }),
            reasoning: solver.reasoning,
            sandbox: solver.sandbox,
            cwd: solver.cwd,
          },
        };
      });

      // Create mapping from memberId to MemberMeta for events
      const solverMetaMap = new Map<string, MemberMeta>();
      for (let i = 0; i < modules.length; i++) {
        const backend = solver.backends[i % solver.backends.length];
        const model = solver.backendModels.get(backend) ?? solver.model;
        const memberId = formatMemberId({
          type: 'solver',
          backend,
          model: model ?? 'unknown',
          index: i,
          module: modules[i].category,
        });
        solverMetaMap.set(memberId, {
          type: 'solver',
          backend,
          model: model ?? 'unknown',
          index: i,
          module: modules[i].category,
          id: memberId,
        });
      }

      const ensembleResult = await runEnsemble(members, (event: EnsembleEvent) => {
        const memberMeta = solverMetaMap.get(event.memberId);

        const toolEvent = makeToolEvent(event.memberId, event.message);
        if (toolEvent) {
          toolEvent.member = memberMeta;
          queue.push(toolEvent);
        }

        if (event.message.type === 'done') {
          queue.push({
            type: 'solver_complete',
            stage: 'solve',
            source: event.memberId,
            backend: memberMeta?.backend,
            model: memberMeta?.model,
            member: memberMeta,
            usage: event.message.usage,
          });
        }
      });

      usages.push(ensembleResult.totalUsage);
      queue.push({ type: 'ensemble_complete', usage: ensembleResult.totalUsage });

      // Log individual solver failures with context (but don't fail pipeline if others succeeded)
      for (let i = 0; i < ensembleResult.outputs.length; i++) {
        const output = ensembleResult.outputs[i];
        const errors = output.backendErrors ?? [];
        const exceptionError = output.error;
        
        if (errors.length > 0 || exceptionError) {
          const meta = solverMetaMap.get(output.id);
          const errorMsg = errors[0] ?? exceptionError ?? 'Unknown error';
          const context = meta 
            ? `[solver-${meta.index}-${meta.backend}-${meta.model}-${meta.module}]`
            : `[${output.id}]`;
          console.error(`${c.yellow('[warning]')} ${context} Solver failed: ${errorMsg}`);
        }
      }

      // Only fail if ALL solvers failed (no successful candidates)
      if (ensembleResult.successful.length === 0) {
        const allErrors = ensembleResult.outputs.flatMap(o => [
          ...(o.backendErrors ?? []),
          ...(o.error ? [o.error] : []),
        ]);
        queue.push({
          type: 'error',
          stage: 'solve',
          content: allErrors[0] ?? 'All solvers failed to produce output',
        });
        queue.done();
        return;
      }

      // Populate trace with solver outputs
      // Build mapping from successful index to outputs index for correct trace.judge.selectedIndex reference
      const successfulToOutputsMap = new Map<number, number>();
      let successIdx = 0;
      for (let i = 0; i < ensembleResult.outputs.length; i++) {
        const output = ensembleResult.outputs[i];
        const module = modules[i];
        // Include legacy ID for backward compatibility
        const legacyId = `solver-${i}-${module.category}`;
        trace.solve.candidates.push({
          id: output.id,
          legacyId,
          module: {
            id: module.id,
            category: module.category,
            name: module.name,
          },
          response: output.text,
          usage: output.usage,
        });

        // Track successful outputs for index mapping
        if (!output.error && !output.backendErrors?.length && output.text) {
          successfulToOutputsMap.set(successIdx++, i);
        }
      }

      // Step 4: Run judge selection
      const judgeResult = await runJudge({
        backend: judge.backend,
        model: judge.model,
        systemPrompt: judge.systemPrompt,
        reasoning: judge.reasoning,
        sandbox: judge.sandbox,
        cwd: judge.cwd,
        candidates: ensembleResult.successful,
        originalTask: prompt,
        onMessage: (msg: Message) => {
          const judgeId = formatMemberId({
            type: 'judge',
            backend: judge.backend,
            model: judge.model ?? 'unknown',
            index: 0,
            module: 'NA',
          });
          const toolEvent = makeToolEvent(judgeId, msg);
          if (toolEvent) {
            toolEvent.member = {
              type: 'judge',
              backend: judge.backend,
              model: judge.model ?? 'unknown',
              index: 0,
              module: 'NA',
              id: judgeId,
            };
            queue.push(toolEvent);
          }
        },
      });
      usages.push(judgeResult.usage);

      // Map successful index to outputs index for correct trace reference
      trace.judge.selectedIndex = successfulToOutputsMap.get(judgeResult.decision.selectedIndex) ?? 0;
      trace.judge.confidence = judgeResult.decision.confidence;
      trace.judge.reasoning = judgeResult.decision.reasoning;

      // Emit candidate summary events in the same order the judge saw them (shuffled)
      // This ensures candidate numbers in the judge's reasoning match the displayed order
      for (let displayIdx = 0; displayIdx < judgeResult.indexMapping.length; displayIdx++) {
        const originalIdx = judgeResult.indexMapping[displayIdx];
        queue.push({
          type: 'candidate',
          stage: 'solve',
          content: `Candidate ${displayIdx + 1}: ${truncate(ensembleResult.successful[originalIdx], 200)}`,
        });
      }

      // Find the display index (what the judge saw) for the selected candidate
      const selectedDisplayIndex = judgeResult.indexMapping.findIndex(
        origIdx => origIdx === judgeResult.decision.selectedIndex
      );
      
      queue.push({
        type: 'selected',
        stage: 'solve',
        content: judgeResult.selected,
        confidence: judgeResult.decision.confidence,
        selectedIndex: selectedDisplayIndex >= 0 ? selectedDisplayIndex : judgeResult.decision.selectedIndex,
        reasoning: judgeResult.decision.reasoning,
      });

      queue.push({
        type: 'stage_complete',
        stage: 'solve',
        confidence: judgeResult.decision.confidence,
        usage: ensembleResult.totalUsage,
      });

      // Step 5: Optionally run verification
      let finalAnswer = judgeResult.selected;
      let wasRevised = false;
      let lastSessionId = judgeResult.sessionId;
      let lastBackend = judge.backend;

      const shouldVerify = verifyEnabled && verifier !== null && (judgeResult.decision.confidence < 0.7 || forceVerify);

      if (shouldVerify && verifier) {
        queue.push({ type: 'stage_start', stage: 'verify' });

        const verifyResult = await runVerification({
          backend: verifier.backend,
          model: verifier.model,
          systemPrompt: verifier.systemPrompt,
          reasoning: verifier.reasoning,
          sandbox: verifier.sandbox,
          cwd: verifier.cwd,
          type: verifier.type,
          draft: finalAnswer,
          originalTask: prompt,
          onMessage: (msg: Message) => {
            const verifierId = formatMemberId({
              type: 'verifier',
              backend: verifier.backend,
              model: verifier.model ?? 'unknown',
              index: 0,
              module: verifier.type,
            });
            const toolEvent = makeToolEvent(verifierId, msg);
            if (toolEvent) {
              toolEvent.member = {
                type: 'verifier',
                backend: verifier.backend,
                model: verifier.model ?? 'unknown',
                index: 0,
                module: verifier.type,
                id: verifierId,
              };
              queue.push(toolEvent);
            }
          },
        });
        usages.push(verifyResult.usage);

        trace.verify = {
          checks: verifyResult.checks.map(c => ({
            id: c.id,
            question: c.question,
            targetClaim: c.targetClaim,
          })),
          results: verifyResult.results.map(r => ({
            checkId: r.checkId,
            answer: r.answer,
            verdict: r.verdict,
            confidence: r.confidence,
          })),
        };

        if (verifyResult.revision && !isUnchanged(verifyResult.revision, finalAnswer)) {
          finalAnswer = verifyResult.revision.revised;
          wasRevised = true;

          if (verifyResult.sessionId) {
            lastSessionId = verifyResult.sessionId;
            lastBackend = verifier.backend;
          }

          trace.verify.revision = {
            changes: verifyResult.revision.changes,
            revised: verifyResult.revision.revised,
          };

          queue.push({
            type: 'verified',
            stage: 'verify',
            content: `Revised: ${verifyResult.revision.changes.join(', ')}`,
          });
        }

        queue.push({
          type: 'stage_complete',
          stage: 'verify',
        });
      }

      // Step 6: Combine results
      const totalUsage = combineUsage(usages);

      const result: DeepThinkResult = {
        answer: finalAnswer,
        confidence: judgeResult.decision.confidence,
        candidates: ensembleResult.successful,
        wasRevised,
        usage: totalUsage,
        trace,
        sessionId: lastSessionId,
        sessionBackend: lastBackend,
      };

      queue.push({
        type: 'complete',
        result,
      });
      queue.done();
    } catch (e) {
      // Convert non-Error objects to Error with proper message extraction
      if (e instanceof Error) {
        queue.fail(e);
      } else if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
        // Handle structured error objects like { type: 'UNKNOWN_MODEL', message: '...' }
        queue.fail(new Error((e as { message: string }).message));
      } else {
        queue.fail(new Error(String(e)));
      }
    }
  })();

  yield* queue;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export function getDeepThinkStages(trace?: DeepThinkTrace): string[] {
  if (!trace) {
    return [];
  }

  const stages: string[] = ['solve'];
  if (trace.verify) {
    stages.push('verify');
  }

  return stages;
}
