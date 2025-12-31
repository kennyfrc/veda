// DeepThink: parallel solvers → judge aggregation → optional verification.

import { loadGlobalConfig, resolveBackendModel } from '../agent/config';
import { AsyncQueue, c } from '../util';
import type { Message, UsageStats } from '../backend';
import {
  runEnsemble,
  runJudge,
  runVerification,
  runRevision,
  combineUsage,
  selectModules,
  isUnchanged,
  getModuleById,
  type EnsembleMember,
  type EnsembleEvent,
  type Reasoning,
  type ReasoningModule,
  type Check,
  type CheckResult,
} from '../core';
import {
  buildDeepSolverSystemPrompt,
  JUDGE_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
} from './prompts';

/**
 * Standardized member ID format: type-index-backend-model-module
 * Examples: solver-0-claude-code-opus-analytical/so_what_test, judge-0-gemini-cli-gemini-pro-NA, verifier-0-codex-gpt-5.2-factual
 * Note: module portion uses category/module_id format for solvers.
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
  revisionReasoning?: Reasoning;
  categories?: string[];
  modules?: string[];
  cwd?: string;
  solverBackends?: string[];  // Array of backends for parallel solvers (supports randomization)
  solverModel?: string;
  judgeBackend?: string;
  judgeModel?: string;
  verifierBackend?: string;
  verifierModel?: string;
  revisionBackend?: string;
  revisionModel?: string;
  /** Run identity hash for checkpoint validation */
  runIdentityHash?: string;
  /** Callback for checkpoint persistence (called after each stage) */
  onCheckpoint?: (checkpoint: DeepThinkCheckpointData) => Promise<void>;
  /** Checkpoint to resume from (skips completed stages) */
  resumeCheckpoint?: DeepThinkCheckpointData;
}

/** Data emitted for checkpoint persistence */
export interface DeepThinkCheckpointData {
  trace: DeepThinkTrace;
  status: 'partial' | 'complete';
  completedStage: 'solve' | 'judge' | 'verify';
  failedStage?: 'judge' | 'verify' | 'revision';
  error?: string;
  successfulCandidateIds: string[];
  judgeSeed?: string;
  judgeIndexMapping?: number[];
  judgeSelectedIndex?: number;
  judgeSelectedDisplayIndex?: number;
  selectedCandidateId?: string;
  verifyChecks?: Check[];
  partialVerifyResults?: CheckResult[];
  usageAtCheckpoint: UsageStats;
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

export interface RevisionOptions {
  /** Backend for revision */
  backend: string;
  /** Model override for revision */
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
    revision?: { backend: string; model?: string };
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
    selectedIndex: number;  // Original index in successful candidates array
    selectedDisplayIndex: number;  // Display index (1-indexed) as shown to user and judge
    confidence: number;
    consensusAnalysis?: string;
    reasoning?: string;
  };
  verify?: {
    checks: Array<{ id: string; question: string; targetClaim?: string; difficulty?: string }>;
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
  type: 'stage_start' | 'stage_complete' | 'candidate' | 'selected' | 'verified' | 'complete' | 'tool_start' | 'error' | 'ensemble_complete' | 'solver_complete' | 'verify_questions' | 'verify_check_complete' | 'revision_complete' | 'checkpoint';
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
  consensusAnalysis?: string; // For 'selected' event: judge's consensus analysis
  // Selected solver metadata (for 'selected' event)
  selectedMember?: { backend: string; model: string; index: number };
  selectedModule?: { id: string; category: string; name: string; prompt: string }
  usage?: UsageStats;
  result?: DeepThinkResult;
  // Verification-specific fields
  checkIndex?: number;  // 0-based index of current check (for verify_check_complete and tool_start during verification)
  checkId?: string;     // ID of current check
  checks?: Array<{ id: string; question: string; targetClaim?: string; difficulty?: string }>;  // For verify_questions event
  verdict?: 'supports' | 'contradicts' | 'uncertain';  // For verify_check_complete
  checkpoint?: DeepThinkCheckpointData;  // For checkpoint event
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
  consensusAnalysis?: string;
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
  revision: RevisionOptions | null;
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
    revision?: { backend: string; model?: string };
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
    sandbox: 'full',
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
    sandbox: 'full',
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

  // Step 5: Resolve revision config (if verification enabled)
  let revisionConfig: RevisionOptions | null = null;
  if (verifyEnabled) {
    // Revision defaults to verifier settings unless explicitly overridden
    const revisionFallbackBackend = verifierConfig?.backend ?? judge.backend;
    const revisionFallbackModel = verifierConfig?.model ?? judge.model;

    const revisionResolved = resolveBackendModel({
      explicitBackend: options.revisionBackend,
      explicitModel: options.revisionModel,
      fallbackBackend: revisionFallbackBackend,
      fallbackModel: revisionFallbackModel,
      globalConfig,
    });

    if (revisionResolved.model) {
      revisionConfig = {
        backend: revisionResolved.backend,
        model: revisionResolved.model,
        systemPrompt: VERIFIER_SYSTEM_PROMPT,  // Same system prompt as verifier
        reasoning: options.revisionReasoning ?? options.verifyReasoning ?? 'high',
        sandbox: 'full',
        cwd: options.cwd ?? process.cwd(),
      };
    }
  }

  // Step 6: Build trace options
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
    revision: revisionConfig ? {
      backend: revisionConfig.backend,
      model: revisionConfig.model,
    } : undefined,
  };

  return { solver: solverConfig, judge: judgeConfig, verifier: verifierConfig, revision: revisionConfig, verifyEnabled, forceVerify, traceOptions };
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
      module: `${module.category}/${module.id}`,
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
    consensusAnalysis: result.decision.consensusAnalysis,
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
    // Stage tracking for error checkpoints
    // currentStage: where we are now (for failure attribution)
    // lastCompletedStage: last successfully completed stage (safe resume point)
    type CurrentStage = 'init' | 'solve' | 'judge' | 'verify' | 'revision';
    type LastCompletedStage = 'none' | 'solve' | 'judge' | 'verify';
    let currentStage: CurrentStage = 'init';
    let lastCompletedStage: LastCompletedStage = 'none';
    
    // These need to be accessible in catch block for error checkpoints
    // trace is assigned early in the try block before any use
    let trace!: DeepThinkTrace;
    let successfulCandidateIds: string[] = [];
    let judgeSeed = '';
    let judgeIndexMapping: number[] = [];
    let judgeSelectedIndex = 0;
    let selectedDisplayIdx = 0;
    let selectedMemberId: string | undefined;
    
    try {
      // Step 1: Expand options into configured structs
      const { solver, judge, verifier, revision, verifyEnabled, forceVerify, traceOptions } = await expandDeepThinkOptions(options);

      // Check if resuming from checkpoint
      const resumeFrom = options.resumeCheckpoint?.completedStage;
      const isResuming = !!resumeFrom;
      
      // Stage order for resume logic (higher = further along)
      const stageOrder: Record<string, number> = { solve: 1, judge: 2, verify: 3 };
      const resumeStageNum = resumeFrom ? stageOrder[resumeFrom] ?? 0 : 0;

      // Step 2: Build trace with expanded options (or restore from checkpoint)
      // When resuming, deep clone to avoid mutating checkpoint data.
      // Note: JSON clone drops undefined/Map/non-JSON values - trace is JSON-safe today.
      trace = isResuming && options.resumeCheckpoint?.trace
        ? JSON.parse(JSON.stringify(options.resumeCheckpoint.trace))
        : {
            trace_version: 2,
            prompt,
            context: solver.context,
            options: traceOptions,
            solve: { candidates: [] },
            judge: { selectedIndex: 0, selectedDisplayIndex: 0, confidence: 0 },
          };
      // === Variables that carry across stages ===
      let successfulCandidates: string[] = [];
      let successfulToOutputsMap = new Map<number, number>();
      let solverMetaMap = new Map<string, MemberMeta>();
      let modules: ReasoningModule[] = [];

      // Step 3: Run solver ensemble (or restore from checkpoint)
      // Skip solve if we've completed it (stage >= 1)
      const skipSolve = isResuming && resumeStageNum >= 1;
      currentStage = 'solve';
      
      if (skipSolve && options.resumeCheckpoint) {
        // Restore state from checkpoint
        console.error(c.cyan('[deep]') + ' Skipping solve stage (restored from checkpoint)');
        lastCompletedStage = 'solve'; // We're resuming from at least solve
        
        successfulCandidateIds = options.resumeCheckpoint.successfulCandidateIds;
        
        // Reconstruct successful candidates from trace
        const candidateIdSet = new Set(successfulCandidateIds);
        successfulCandidates = trace.solve.candidates
          .filter(c => candidateIdSet.has(c.id))
          .map(c => c.response);
        
        // Reconstruct successfulToOutputsMap
        let successIdx = 0;
        for (let i = 0; i < trace.solve.candidates.length; i++) {
          if (candidateIdSet.has(trace.solve.candidates[i].id)) {
            successfulToOutputsMap.set(successIdx++, i);
          }
        }
        
        // Reconstruct modules from trace, looking up prompts from registry
        modules = trace.solve.candidates.map(c => {
          // Look up full module from registry to get the prompt
          const registryModule = getModuleById(c.module.id);
          return {
            id: c.module.id,
            category: c.module.category as ReasoningModule['category'],
            name: c.module.name,
            prompt: registryModule?.prompt ?? '', // Fallback to empty if module not found
          };
        });
        
        // Reconstruct solverMetaMap from trace
        for (let i = 0; i < trace.solve.candidates.length; i++) {
          const candidate = trace.solve.candidates[i];
          solverMetaMap.set(candidate.id, {
            type: 'solver',
            backend: 'unknown', // Not stored in trace
            model: 'unknown',
            index: i,
            module: `${candidate.module.category}/${candidate.module.id}`,
            id: candidate.id,
          });
        }
        
        // Restore usage from checkpoint
        usages.push(options.resumeCheckpoint.usageAtCheckpoint);
      } else {
        // Run solve stage normally
        queue.push({ type: 'stage_start', stage: 'solve' });

        modules = selectModules({
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
            module: `${module.category}/${module.id}`,
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
        for (let i = 0; i < modules.length; i++) {
          const backend = solver.backends[i % solver.backends.length];
          const model = solver.backendModels.get(backend) ?? solver.model;
          const moduleSpec = `${modules[i].category}/${modules[i].id}`;
          const memberId = formatMemberId({
            type: 'solver',
            backend,
            model: model ?? 'unknown',
            index: i,
            module: moduleSpec,
          });
          solverMetaMap.set(memberId, {
            type: 'solver',
            backend,
            model: model ?? 'unknown',
            index: i,
            module: moduleSpec,
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
            const ctx = meta 
              ? `[solver-${meta.index + 1}:${meta.backend}:${meta.model}:${meta.module}]`
              : `[${output.id}]`;
            console.error(`${c.yellow('[warning]')} ${ctx} Solver failed: ${errorMsg}`);
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

        // Store successful candidates
        successfulCandidates = ensembleResult.successful;

        // Populate trace with solver outputs
        // Build mapping from successful index to outputs index for correct trace.judge.selectedIndex reference
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

        // Extract successful candidate IDs for checkpoint
        successfulCandidateIds = ensembleResult.outputs
          .filter(o => !o.error && !o.backendErrors?.length && o.text)
          .map(o => o.id);

        // === CHECKPOINT: After solvers complete ===
        if (options.onCheckpoint) {
          const checkpointData: DeepThinkCheckpointData = {
            trace,
            status: 'partial',
            completedStage: 'solve',
            successfulCandidateIds,
            usageAtCheckpoint: ensembleResult.totalUsage,
          };
          await options.onCheckpoint(checkpointData);
          queue.push({ type: 'checkpoint', checkpoint: checkpointData });
        }
        lastCompletedStage = 'solve';
      }

      // === Variables that carry from judge stage ===
      let finalAnswer = '';
      let judgeConfidence = 0;
      let judgeSessionId: string | undefined;

      // Step 4: Run judge selection (or restore from checkpoint)
      // Skip judge if we've completed it (stage >= 2)
      const skipJudge = isResuming && resumeStageNum >= 2;
      currentStage = 'judge';
      
      if (skipJudge && options.resumeCheckpoint) {
        // Restore judge state from checkpoint
        console.error(c.cyan('[deep]') + ' Skipping judge stage (restored from checkpoint)');
        lastCompletedStage = 'judge'; // We're resuming from at least judge
        
        // Get selected candidate from checkpoint
        const selectedIdx = options.resumeCheckpoint.judgeSelectedIndex ?? trace.judge.selectedIndex;
        const outputsIdx = successfulToOutputsMap.get(selectedIdx) ?? selectedIdx;
        finalAnswer = trace.solve.candidates[outputsIdx]?.response ?? '';
        judgeConfidence = trace.judge.confidence;
        selectedDisplayIdx = (options.resumeCheckpoint.judgeSelectedDisplayIndex ?? trace.judge.selectedDisplayIndex) - 1;
        selectedMemberId = options.resumeCheckpoint.selectedCandidateId ?? trace.solve.candidates[outputsIdx]?.id;
        judgeSeed = options.resumeCheckpoint.judgeSeed ?? '';
        judgeIndexMapping = options.resumeCheckpoint.judgeIndexMapping ?? [];
        judgeSelectedIndex = selectedIdx;
      } else {
        // Run judge stage normally
        const judgeResult = await runJudge({
          backend: judge.backend,
          model: judge.model,
          systemPrompt: judge.systemPrompt,
          reasoning: judge.reasoning,
          sandbox: judge.sandbox,
          cwd: judge.cwd,
          candidates: successfulCandidates,
          originalTask: prompt,
          seed: `${prompt}-${Date.now()}`,
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

        // Store judge results
        finalAnswer = judgeResult.selected;
        judgeConfidence = judgeResult.decision.confidence;
        judgeSelectedIndex = judgeResult.decision.selectedIndex;
        judgeIndexMapping = judgeResult.indexMapping;
        judgeSessionId = judgeResult.sessionId;
        judgeSeed = `${prompt}-${Date.now()}`;

        // Find the display index (what the judge saw and referenced in its reasoning)
        selectedDisplayIdx = judgeResult.indexMapping.findIndex(
          origIdx => origIdx === judgeResult.decision.selectedIndex
        );

        // Map successful index to outputs index for correct trace reference
        trace.judge.selectedIndex = successfulToOutputsMap.get(judgeResult.decision.selectedIndex) ?? 0;
        trace.judge.selectedDisplayIndex = selectedDisplayIdx + 1;
        trace.judge.confidence = judgeResult.decision.confidence;
        trace.judge.consensusAnalysis = judgeResult.decision.consensusAnalysis;
        trace.judge.reasoning = judgeResult.decision.reasoning;

        // Look up selected solver metadata
        const selectedOriginalIdx = judgeResult.decision.selectedIndex;
        const selectedOutputsIdx = successfulToOutputsMap.get(selectedOriginalIdx) ?? 0;
        selectedMemberId = trace.solve.candidates[selectedOutputsIdx]?.id;

        // Emit shuffled note before candidates
        queue.push({
          type: 'candidate',
          stage: 'solve',
          content: '(candidates shuffled to reduce position bias)',
        });

        // Emit candidate summary events in the SAME shuffled order the judge sees
        for (let displayIdx = 0; displayIdx < judgeResult.indexMapping.length; displayIdx++) {
          const originalIdx = judgeResult.indexMapping[displayIdx];
          const outputsIdx = successfulToOutputsMap.get(originalIdx);
          const candidateMemberId = outputsIdx !== undefined ? trace.solve.candidates[outputsIdx]?.id : undefined;
          const candidateMeta = candidateMemberId ? solverMetaMap.get(candidateMemberId) : undefined;
          queue.push({
            type: 'candidate',
            stage: 'solve',
            content: `Candidate ${displayIdx + 1}: ${truncate(successfulCandidates[originalIdx], 200)}`,
            member: candidateMeta,
          });
        }

        // Look up selected solver metadata for display
        const selectedModule = modules[selectedOutputsIdx];
        const selectedMeta = selectedMemberId ? solverMetaMap.get(selectedMemberId) : undefined;
        
        queue.push({
          type: 'selected',
          stage: 'solve',
          content: judgeResult.selected,
          confidence: judgeResult.decision.confidence,
          selectedIndex: selectedDisplayIdx >= 0 ? selectedDisplayIdx : 0,
          reasoning: judgeResult.decision.reasoning,
          consensusAnalysis: judgeResult.decision.consensusAnalysis,
          selectedMember: selectedMeta ? {
            backend: selectedMeta.backend,
            model: selectedMeta.model,
            index: selectedMeta.index,
          } : undefined,
          selectedModule: selectedModule ? {
            id: selectedModule.id,
            category: selectedModule.category,
            name: selectedModule.name,
            prompt: selectedModule.prompt,
          } : undefined,
        });

        queue.push({
          type: 'stage_complete',
          stage: 'solve',
          confidence: judgeResult.decision.confidence,
          usage: combineUsage(usages),
        });
      }

      // === CHECKPOINT: After judge completes (only if we ran judge) ===
      if (options.onCheckpoint && !skipJudge) {
        const checkpointData: DeepThinkCheckpointData = {
          trace,
          status: 'partial',
          completedStage: 'judge',
          successfulCandidateIds,
          judgeSeed,
          judgeIndexMapping,
          judgeSelectedIndex,
          judgeSelectedDisplayIndex: selectedDisplayIdx + 1,
          selectedCandidateId: selectedMemberId,
          usageAtCheckpoint: combineUsage(usages),
        };
        await options.onCheckpoint(checkpointData);
        queue.push({ type: 'checkpoint', checkpoint: checkpointData });
      }
      lastCompletedStage = 'judge';

      // Step 5: Optionally run verification
      let wasRevised = false;
      let lastSessionId = judgeSessionId;
      let lastBackend = judge.backend;

      const shouldVerify = verifyEnabled && verifier !== null && (judgeConfidence < 0.7 || forceVerify);

      if (shouldVerify && verifier) {
        currentStage = 'verify';
        queue.push({ type: 'stage_start', stage: 'verify' });

        // Check if resuming with partial verify state
        // If we have verifyChecks from checkpoint, use them to ensure deterministic resume
        // If we have partialVerifyResults, skip those checks
        const checksOverride = options.resumeCheckpoint?.verifyChecks;
        const completedResults = options.resumeCheckpoint?.partialVerifyResults;
        
        if (checksOverride && checksOverride.length > 0) {
          const completedCount = completedResults?.length ?? 0;
          console.error(c.cyan('[deep]') + ` Resuming verify stage (${completedCount}/${checksOverride.length} checks completed)`);
        }

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
          // Resume support: use pre-computed checks and skip completed results
          checksOverride,
          completedResults,
          // Factory creates per-check handlers that capture index/id in closure.
          // This fixes the race condition where parallel checks interleave events.
          createCheckMessageHandler: ({ index, check }) => {
            return (msg: Message) => {
              const verifierId = formatMemberId({
                type: 'verifier',
                backend: verifier.backend,
                model: verifier.model ?? 'unknown',
                index,
                module: verifier.type,
              });
              const toolEvent = makeToolEvent(verifierId, msg);
              if (toolEvent) {
                toolEvent.member = {
                  type: 'verifier',
                  backend: verifier.backend,
                  model: verifier.model ?? 'unknown',
                  index,
                  module: verifier.type,
                  id: verifierId,
                };
                // Tag with check info for display
                toolEvent.checkIndex = index;
                toolEvent.checkId = check.id;
                queue.push(toolEvent);
              }
            };
          },
          onChecksGenerated: (checks) => {
            queue.push({
              type: 'verify_questions',
              stage: 'verify',
              checks: checks.map(c => ({
                id: c.id,
                question: c.question,
                targetClaim: c.targetClaim,
                difficulty: c.difficulty,
              })),
            });
          },
          onCheckComplete: ({ index, check, result }) => {
            queue.push({
              type: 'verify_check_complete',
              stage: 'verify',
              checkIndex: index,
              checkId: check.id,
              verdict: result.verdict,
              confidence: result.confidence,
              content: result.answer,
            });
          },
        });
        usages.push(verifyResult.usage);

        trace.verify = {
          checks: verifyResult.checks.map(c => ({
            id: c.id,
            question: c.question,
            targetClaim: c.targetClaim,
            difficulty: c.difficulty,
          })),
          results: verifyResult.results.map(r => ({
            checkId: r.checkId,
            answer: r.answer,
            verdict: r.verdict,
            confidence: r.confidence,
          })),
        };

        // Count contradictions for verify summary
        const contradictionResults = verifyResult.results.filter(r => r.verdict === 'contradicts');
        const contradictions = contradictionResults.length;
        const uncertain = verifyResult.results.filter(r => r.verdict === 'uncertain').length;
        
        queue.push({
          type: 'stage_complete',
          stage: 'verify',
          content: contradictions > 0 
            ? `${contradictions} contradiction${contradictions > 1 ? 's' : ''} found`
            : uncertain > 0 
              ? `${uncertain} uncertain` 
              : 'all checks passed',
        });

        // === CHECKPOINT: After verify completes ===
        if (options.onCheckpoint) {
          const checkpointData: DeepThinkCheckpointData = {
            trace,
            status: 'partial',
            completedStage: 'verify',
            successfulCandidateIds,
            judgeSeed,
            judgeIndexMapping,
            judgeSelectedIndex,
            judgeSelectedDisplayIndex: selectedDisplayIdx + 1,
            selectedCandidateId: selectedMemberId,
            verifyChecks: verifyResult.checks,
            partialVerifyResults: verifyResult.results,
            usageAtCheckpoint: combineUsage(usages),
          };
          await options.onCheckpoint(checkpointData);
          queue.push({ type: 'checkpoint', checkpoint: checkpointData });
        }
        lastCompletedStage = 'verify';

        // Run revision if there are contradictions and we have a revision config
        if (contradictions > 0 && revision) {
          currentStage = 'revision';
          // Emit revise phase start
          queue.push({ type: 'stage_start', stage: 'revise' });

          const revisionResult = await runRevision({
            backend: revision.backend,
            model: revision.model,
            systemPrompt: revision.systemPrompt,
            reasoning: revision.reasoning,
            sandbox: revision.sandbox,
            cwd: revision.cwd,
            draft: finalAnswer,
            contradictions: contradictionResults,
            onMessage: (msg: Message) => {
              const revisionId = formatMemberId({
                type: 'verifier',  // Use 'verifier' type for consistent display
                backend: revision.backend,
                model: revision.model ?? 'unknown',
                index: 0,
                module: 'revision',
              });
              const toolEvent = makeToolEvent(revisionId, msg);
              if (toolEvent) {
                toolEvent.member = {
                  type: 'verifier',
                  backend: revision.backend,
                  model: revision.model ?? 'unknown',
                  index: 0,
                  module: 'revision',
                  id: revisionId,
                };
                queue.push(toolEvent);
              }
            },
          });

          usages.push(revisionResult.usage);

          if (!isUnchanged(revisionResult.revision, finalAnswer)) {
            finalAnswer = revisionResult.revision.revised;
            wasRevised = true;

            if (revisionResult.sessionId) {
              lastSessionId = revisionResult.sessionId;
              lastBackend = revision.backend;
            }

            trace.verify.revision = {
              changes: revisionResult.revision.changes,
              revised: revisionResult.revision.revised,
            };

            // Emit revision details
            queue.push({
              type: 'revision_complete',
              stage: 'revise',
              content: revisionResult.revision.changes.join('\n'),
            });
          }

          queue.push({
            type: 'stage_complete',
            stage: 'revise',
          });
        }
      }

      // Step 6: Combine results
      const totalUsage = combineUsage(usages);

      const result: DeepThinkResult = {
        answer: finalAnswer,
        confidence: judgeConfidence,
        candidates: successfulCandidates,
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
      // Extract error message
      let errorMessage: string;
      if (e instanceof Error) {
        errorMessage = e.message;
      } else if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
        errorMessage = (e as { message: string }).message;
      } else {
        errorMessage = String(e);
      }

      // Save failure checkpoint if we have a completed stage to resume from
      // Only record failedStage for stages that can meaningfully fail (judge, verify, revision)
      if (options.onCheckpoint && lastCompletedStage !== 'none' && trace) {
        const failedStage = currentStage === 'judge' || currentStage === 'verify' || currentStage === 'revision'
          ? currentStage
          : undefined;
        
        try {
          const failureCheckpoint: DeepThinkCheckpointData = {
            trace,
            status: 'partial',
            completedStage: lastCompletedStage,
            failedStage,
            error: errorMessage,
            successfulCandidateIds,
            judgeSeed: judgeSeed || undefined,
            judgeIndexMapping: judgeIndexMapping.length > 0 ? judgeIndexMapping : undefined,
            judgeSelectedIndex: judgeSelectedIndex || undefined,
            judgeSelectedDisplayIndex: selectedDisplayIdx ? selectedDisplayIdx + 1 : undefined,
            selectedCandidateId: selectedMemberId,
            usageAtCheckpoint: combineUsage(usages),
          };
          await options.onCheckpoint(failureCheckpoint);
        } catch (checkpointError) {
          // Don't let checkpoint write failures swallow the original error
          console.error(c.yellow('[deep]') + ' Failed to save error checkpoint:', checkpointError);
        }
      }

      // Convert to Error and fail the queue
      if (e instanceof Error) {
        queue.fail(e);
      } else {
        queue.fail(new Error(errorMessage));
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
  if (trace.judge) {
    stages.push('judge');
  }
  if (trace.verify) {
    stages.push('verify');
    if (trace.verify.revision) {
      stages.push('revise');
    }
  }

  return stages;
}
