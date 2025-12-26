// DeepThink: parallel solvers → judge aggregation → optional verification.

import { loadGlobalConfig, resolveBackendModel } from '../agent/config';
import { AsyncQueue } from '../util';
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

export interface DeepThinkOptions {
  backend?: string;
  model?: string;
  k?: number;
  verify?: boolean;
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
  prompt: string;
  context?: string;
  options: {
    backend: string;
    model?: string;
    k: number;
    verify: boolean;
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
  toolInput?: unknown;
  confidence?: number;
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
  traceOptions: {
    backend: string;
    model?: string;
    k: number;
    verify: boolean;
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
  const solverBackends = options.solverBackends ?? [base.backend];
  const backendModels = new Map<string, string>();

  for (const backend of new Set(solverBackends)) {
    const resolved = resolveBackendModel({
      explicitBackend: backend,
      explicitModel: options.solverModel,
      fallbackBackend: base.backend,
      fallbackModel: base.model,
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
  const judge = resolveBackendModel({
    explicitBackend: options.judgeBackend,
    explicitModel: options.judgeModel,
    fallbackBackend: base.backend,
    fallbackModel: base.model,
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

  if (verifyEnabled) {
    const verifier = resolveBackendModel({
      explicitBackend: options.verifierBackend,
      explicitModel: options.verifierModel,
      fallbackBackend: base.backend,
      fallbackModel: base.model,
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

  return { solver: solverConfig, judge: judgeConfig, verifier: verifierConfig, verifyEnabled, traceOptions };
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
    return {
      id: `solver-${i}-${module.category}`,
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
      const { solver, judge, verifier, verifyEnabled, traceOptions } = await expandDeepThinkOptions(options);

      // Step 2: Build trace with expanded options
      const trace: DeepThinkTrace = {
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
        return {
          id: `solver-${i}-${module.category}`,
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

      const ensembleResult = await runEnsemble(members, (event: EnsembleEvent) => {
        const toolEvent = makeToolEvent(event.memberId, event.message);
        if (toolEvent) queue.push(toolEvent);

        if (event.message.type === 'done') {
          queue.push({
            type: 'solver_complete',
            stage: 'solve',
            source: event.memberId,
            usage: event.message.usage,
          });
        }
      });

      usages.push(ensembleResult.totalUsage);
      queue.push({ type: 'ensemble_complete', usage: ensembleResult.totalUsage });

      const solverErrors = ensembleResult.outputs.flatMap(o => o.backendErrors ?? []);
      if (solverErrors.length > 0) {
        queue.push({ type: 'error', stage: 'solve', content: solverErrors[0] });
        queue.done();
        return;
      }

      if (ensembleResult.successful.length === 0) {
        const exceptionErrors = ensembleResult.outputs
          .filter(o => o.error)
          .map(o => o.error!);
        queue.push({
          type: 'error',
          stage: 'solve',
          content: exceptionErrors[0] ?? 'All solvers failed to produce output',
        });
        queue.done();
        return;
      }

      // Populate trace with solver outputs
      for (let i = 0; i < ensembleResult.outputs.length; i++) {
        const output = ensembleResult.outputs[i];
        const module = modules[i];
        trace.solve.candidates.push({
          id: output.id,
          module: {
            id: module.id,
            category: module.category,
            name: module.name,
          },
          response: output.text,
          usage: output.usage,
        });
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
          const toolEvent = makeToolEvent('judge', msg);
          if (toolEvent) queue.push(toolEvent);
        },
      });
      usages.push(judgeResult.usage);

      trace.judge.selectedIndex = judgeResult.decision.selectedIndex;
      trace.judge.confidence = judgeResult.decision.confidence;
      trace.judge.reasoning = judgeResult.decision.reasoning;

      // Emit candidate summary events AFTER judging (preserves current behavior)
      for (let i = 0; i < ensembleResult.successful.length; i++) {
        queue.push({
          type: 'candidate',
          stage: 'solve',
          content: `Candidate ${i + 1}: ${truncate(ensembleResult.successful[i], 200)}`,
        });
      }

      queue.push({
        type: 'selected',
        stage: 'solve',
        content: judgeResult.selected,
        confidence: judgeResult.decision.confidence,
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

      const shouldVerify = verifyEnabled && verifier !== null && judgeResult.decision.confidence < 0.7;

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
            const toolEvent = makeToolEvent('verifier', msg);
            if (toolEvent) queue.push(toolEvent);
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
      queue.fail(e instanceof Error ? e : new Error(String(e)));
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
