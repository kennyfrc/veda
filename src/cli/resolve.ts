/**
 * CLI Resolution - Resolve backend/model with precedence rules.
 * 
 * Resolution Precedence (highest to lowest):
 * 1. Explicit CLI flag (--backend, --model, --solver-model, etc.)
 * 2. Model alias inference (opus → claude-code)
 * 3. Model prefix inference (gpt-5.2 → codex)
 * 4. Config file defaults
 * 5. Built-in defaults (codex solver+verifier default: gpt-5.3-codex)
 */

import type { 
  RawFlags, 
  ResolvedBackendModel, 
  ResolutionSource,
  StageConfig,
  SolverConfig,
  VerifyConfig,
  StageConfigs,
  ReasoningLevel,
} from './types';
import { CliValidationError } from './types';
import { resolveModelAlias, MODEL_ALIASES } from '../agent/model-aliases';
import { getBackendDefaultModelForStage } from '../backend/defaults';
import type { GlobalConfig } from '../agent/config';

// =============================================================================
// Model Prefix Inference
// =============================================================================

const MODEL_PREFIX_TO_BACKEND: Record<string, string> = {
  'gpt-': 'codex',
  'o1-': 'codex',
  'o3-': 'codex',
  'gemini-': 'gemini-cli',
  'claude-': 'claude-code',
  'jdc/': 'jdc',
};

function inferBackendFromPrefix(model: string): string | undefined {
  const normalized = model.trim().toLowerCase();
  for (const [prefix, backend] of Object.entries(MODEL_PREFIX_TO_BACKEND)) {
    if (normalized.startsWith(prefix)) {
      return backend;
    }
  }
  return undefined;
}

// =============================================================================
// Base Pinning Detection
// =============================================================================

/**
 * Check if the base backend/model was explicitly pinned by the user.
 * 
 * A "pinned" base means the user intentionally selected a backend via:
 * - `-b <backend>` (explicit)
 * - `-m <alias>` where alias implies backend (e.g., opus → claude-code)
 * - `-m <model>` where model prefix implies backend (e.g., gpt-5 → codex)
 * 
 * When base is pinned, config-driven distribution should be suppressed
 * unless the user explicitly enables it with --distribute-solvers.
 */
function isBasePinned(source: ResolutionSource): boolean {
  return source === 'explicit' || source === 'alias' || source === 'prefix';
}

// =============================================================================
// Backend/Model Resolution
// =============================================================================

export interface ResolveOptions {
  explicitBackend?: string;
  explicitModel?: string;
  globalConfig?: GlobalConfig;
  /** Optional stage to apply stage-specific built-in defaults (deep mode). */
  stage?: 'base' | 'solver' | 'judge' | 'verifier' | 'revision';
}

/**
 * Resolve backend and model with full precedence chain.
 * Throws on alias/backend mismatch.
 */
export function resolveBackendModel(opts: ResolveOptions): ResolvedBackendModel {
  const { explicitBackend, explicitModel, globalConfig, stage = 'base' } = opts;
  
  // Try to resolve model alias first
  const aliasTarget = explicitModel ? resolveModelAlias(explicitModel) : undefined;
  
  // Check for alias/backend mismatch
  if (aliasTarget && explicitBackend && aliasTarget.backend !== explicitBackend) {
    throw new CliValidationError(
      `Model alias '${explicitModel}' targets ${aliasTarget.backend}, conflicts with -b ${explicitBackend}`,
      'ALIAS_BACKEND_MISMATCH',
      `Either remove -b ${explicitBackend} or use a different model`
    );
  }
  
  // Determine backend
  let backend: string;
  let source: ResolutionSource;
  
  if (explicitBackend) {
    backend = explicitBackend;
    source = 'explicit';
  } else if (aliasTarget) {
    backend = aliasTarget.backend;
    source = 'alias';
  } else if (explicitModel) {
    const inferred = inferBackendFromPrefix(explicitModel);
    if (inferred) {
      backend = inferred;
      source = 'prefix';
    } else {
      // Unknown model with no explicit backend
      throw new CliValidationError(
        `Unknown model: '${explicitModel}'`,
        'UNKNOWN_MODEL',
        `Use -b to specify backend, or use an alias: ${Object.keys(MODEL_ALIASES).join(', ')}`
      );
    }
  } else if (globalConfig?.backend) {
    backend = globalConfig.backend;
    source = 'config';
  } else {
    backend = 'codex';
    source = 'default';
  }
  
  // Determine model
  let model: string;
  
  if (aliasTarget) {
    model = aliasTarget.model;
  } else if (explicitModel) {
    model = explicitModel;
  } else if (globalConfig?.backendModels?.[backend]) {
    model = globalConfig.backendModels[backend];
  } else if (globalConfig?.model) {
    // Check if global model is an alias that doesn't match our backend
    const globalAlias = resolveModelAlias(globalConfig.model);
    if (globalAlias && globalAlias.backend !== backend) {
      // Global model alias doesn't match our backend, use backend default
      model = getBackendDefaultModelForStage(backend, stage) ?? 'unknown';
    } else {
      model = globalConfig.model;
    }
  } else {
    model = getBackendDefaultModelForStage(backend, stage) ?? 'unknown';
  }
  
  return { backend, model, source };
}

// =============================================================================
// Stage Resolution (Deep Mode)
// =============================================================================

export interface StageResolveOptions {
  flags: RawFlags;
  baseResolved: ResolvedBackendModel;
  globalConfig?: GlobalConfig;
}

/**
 * Resolve all deep mode stages.
 */
export function resolveDeepStages(opts: StageResolveOptions): StageConfigs {
  const { flags, baseResolved, globalConfig } = opts;
  
  const solver = resolveSolverConfig(flags, baseResolved, globalConfig);
  const judge = resolveJudgeConfig(flags, baseResolved, globalConfig);
  const verifier = resolveVerifierConfig(flags, baseResolved, globalConfig);
  const revision = resolveRevisionConfig(flags, baseResolved, globalConfig);
  
  return { solver, judge, verifier, revision };
}

function resolveSolverConfig(
  flags: RawFlags,
  base: ResolvedBackendModel,
  globalConfig?: GlobalConfig
): SolverConfig {
  const deepConfig = globalConfig?.deep;
  
  // Check if solver model is an alias (drives backend choice)
  const solverModelAlias = flags.solverModel ? resolveModelAlias(flags.solverModel) : undefined;
  
  // Check for solver-specific alias mismatch (only when both are explicit)
  if (flags.solverModel && flags.solverBackend) {
    if (solverModelAlias && solverModelAlias.backend !== flags.solverBackend) {
      throw new CliValidationError(
        `Model alias '${flags.solverModel}' targets ${solverModelAlias.backend}, conflicts with --solver-backend ${flags.solverBackend}`,
        'ALIAS_BACKEND_MISMATCH'
      );
    }
  }
  
  // Distributed mode: CLI flag > pinned base suppression > config > false
  // When base is pinned (user passed -b or -m that infers backend), suppress config distribution
  // unless user explicitly enables it with --distribute-solvers
  const useDistributed = flags.distributeSolvers !== undefined
    ? flags.distributeSolvers  // Explicit CLI flag always wins
    : isBasePinned(base.source)
      ? false  // Pinned base suppresses config distribution
      : (deepConfig?.distributeSolvers ?? false);
  
  // Resolve reasoning for solver stage
  const reasoning = resolveStageReasoning(flags, 'solver', globalConfig);
  
  if (useDistributed) {
    // If solver model is an alias, it determines the backend (can't use sonnet on codex)
    // This overrides distributed backends from config
    if (solverModelAlias) {
      return {
        mode: 'fixed',
        backend: solverModelAlias.backend,
        model: solverModelAlias.model,
        reasoning,
      };
    }
    
    // Backends: CLI > config > [base.backend]
    let backends: string[];
    if (flags.solverBackends) {
      backends = flags.solverBackends;
    } else if (deepConfig?.solverBackends) {
      backends = deepConfig.solverBackends;
    } else {
      backends = [base.backend];
    }
    const uniqueBackends = [...new Set(backends)];
    
    // Check for -m with multiple backends
    if (flags.model && uniqueBackends.length > 1) {
      throw new CliValidationError(
        'Cannot use -m with --distribute-solvers across multiple backends',
        'MUTUALLY_EXCLUSIVE_FLAGS',
        'Remove -m, or use --solver-model with backend-specific models'
      );
    }
    
    // Resolve model per backend
    const modelPerBackend = new Map<string, string>();
    for (const backend of uniqueBackends) {
      const resolved = resolveBackendModel({
        explicitBackend: backend,
        explicitModel: flags.model,
        globalConfig,
        stage: 'solver',
      });
      modelPerBackend.set(backend, resolved.model);
    }
    
    return {
      mode: 'distributed',
      backends,
      modelPerBackend,
      reasoning,
    };
  }
  
  // Fixed mode: solver backend CLI > alias-inferred > pinned base > resolved
  const effectiveBackend = flags.solverBackend 
    ?? (solverModelAlias ? solverModelAlias.backend : undefined)
    ?? (isBasePinned(base.source) ? base.backend : undefined);
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: flags.solverModel ?? flags.model,
    globalConfig,
    stage: 'solver',
  });
  
  return {
    mode: 'fixed',
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
    reasoning,
  };
}

function resolveJudgeConfig(
  flags: RawFlags,
  base: ResolvedBackendModel,
  globalConfig?: GlobalConfig
): StageConfig {
  const deepConfig = globalConfig?.deep;
  
  // Check for judge-specific alias mismatch (only when both are explicit)
  if (flags.judgeModel && flags.judgeBackend) {
    const alias = resolveModelAlias(flags.judgeModel);
    if (alias && alias.backend !== flags.judgeBackend) {
      throw new CliValidationError(
        `Model alias '${flags.judgeModel}' targets ${alias.backend}, conflicts with --judge-backend ${flags.judgeBackend}`,
        'ALIAS_BACKEND_MISMATCH'
      );
    }
  }
  
  // When base is pinned (-b or -m), suppress config defaults unless per-stage CLI flags are used
  const basePinned = isBasePinned(base.source);
  
  // If judge model is an alias, let it drive the backend
  // When base is pinned and no stage-specific flags, use base model (not config)
  const judgeModel = flags.judgeModel ?? (basePinned ? flags.model : deepConfig?.judgeModel);
  const judgeModelAlias = judgeModel ? resolveModelAlias(judgeModel) : undefined;
  
  // Judge backend: CLI > alias-inferred > (pinned base | config) > base
  const effectiveBackend = flags.judgeBackend 
    ?? (judgeModelAlias ? judgeModelAlias.backend : undefined)
    ?? (basePinned ? base.backend : deepConfig?.judgeBackend);
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: judgeModel ?? flags.model,
    globalConfig,
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
    reasoning: resolveStageReasoning(flags, 'judge', globalConfig),
  };
}

function resolveVerifierConfig(
  flags: RawFlags,
  base: ResolvedBackendModel,
  globalConfig?: GlobalConfig
): StageConfig {
  const deepConfig = globalConfig?.deep;
  
  // Check for verifier-specific alias mismatch (only when both are explicit)
  if (flags.verifierModel && flags.verifierBackend) {
    const alias = resolveModelAlias(flags.verifierModel);
    if (alias && alias.backend !== flags.verifierBackend) {
      throw new CliValidationError(
        `Model alias '${flags.verifierModel}' targets ${alias.backend}, conflicts with --verifier-backend ${flags.verifierBackend}`,
        'ALIAS_BACKEND_MISMATCH'
      );
    }
  }
  
  // When base is pinned (-b or -m), suppress config defaults unless per-stage CLI flags are used
  const basePinned = isBasePinned(base.source);
  
  // If verifier model is an alias, let it drive the backend
  // When base is pinned and no stage-specific flags, use base model (not config)
  const verifierModel = flags.verifierModel ?? (basePinned ? flags.model : deepConfig?.verifierModel);
  const verifierModelAlias = verifierModel ? resolveModelAlias(verifierModel) : undefined;
  
  // Verifier backend: CLI > alias-inferred > (pinned base | config) > base
  const effectiveBackend = flags.verifierBackend 
    ?? (verifierModelAlias ? verifierModelAlias.backend : undefined)
    ?? (basePinned ? base.backend : deepConfig?.verifierBackend);
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: verifierModel ?? flags.model,
    globalConfig,
    stage: 'verifier',
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
    reasoning: resolveStageReasoning(flags, 'verifier', globalConfig),
  };
}

function resolveRevisionConfig(
  flags: RawFlags,
  base: ResolvedBackendModel,
  globalConfig?: GlobalConfig
): StageConfig {
  const deepConfig = globalConfig?.deep;
  
  // Check for revision-specific alias mismatch (only when both are explicit)
  if (flags.revisionModel && flags.revisionBackend) {
    const alias = resolveModelAlias(flags.revisionModel);
    if (alias && alias.backend !== flags.revisionBackend) {
      throw new CliValidationError(
        `Model alias '${flags.revisionModel}' targets ${alias.backend}, conflicts with --revision-backend ${flags.revisionBackend}`,
        'ALIAS_BACKEND_MISMATCH'
      );
    }
  }
  
  // When base is pinned (-b or -m), suppress config defaults unless per-stage CLI flags are used
  const basePinned = isBasePinned(base.source);
  
  // If revision model is an alias, let it drive the backend (don't inherit from verifier)
  // When base is pinned and no stage-specific flags, use base model (not config)
  const revisionModel = flags.revisionModel ?? (basePinned ? flags.model : deepConfig?.revisionModel);
  const revisionModelAlias = revisionModel ? resolveModelAlias(revisionModel) : undefined;
  
  // Revision backend: CLI > alias-inferred > (pinned base | config > verifier) > base
  const effectiveBackend = flags.revisionBackend 
    ?? (revisionModelAlias ? revisionModelAlias.backend : undefined)
    ?? (basePinned ? base.backend : (deepConfig?.revisionBackend ?? flags.verifierBackend ?? deepConfig?.verifierBackend));
  
  // For model fallback: when base is pinned, use flags.model; otherwise use config/verifier cascade
  const modelFallback = basePinned 
    ? flags.model
    : (revisionModel ?? flags.verifierModel ?? deepConfig?.verifierModel ?? flags.model);
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: modelFallback,
    globalConfig,
    stage: 'revision',
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
    reasoning: resolveStageReasoning(flags, 'revision', globalConfig),
  };
}

// =============================================================================
// Verify Config Resolution
// =============================================================================

export function resolveVerifyConfig(flags: RawFlags): VerifyConfig {
  if (flags.noVerify) {
    return { enabled: false };
  }
  return { enabled: true, forced: flags.forceVerify };
}

// =============================================================================
// Reasoning Resolution
// =============================================================================

const VALID_REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;

function isValidReasoning(level: string): level is ReasoningLevel {
  return VALID_REASONING_LEVELS.includes(level as ReasoningLevel);
}

/**
 * Resolve reasoning level for a deep mode stage.
 * Precedence: per-stage CLI flag > base -r flag > config file > stage default
 * 
 * When base -r is set, it overrides config defaults for all stages (same pattern as -b/-m).
 * For revision stage, if not explicitly set, falls back to verifier's effective reasoning.
 */
export function resolveStageReasoning(
  flags: RawFlags,
  stage: 'solver' | 'judge' | 'verifier' | 'revision',
  globalConfig?: GlobalConfig
): ReasoningLevel {
  const deepConfig = globalConfig?.deep;
  
  // Detect base reasoning override: when -r is passed, it should override all stages
  // This suppresses per-stage config defaults unless per-stage CLI flags are used
  const baseReasoning = flags.reasoning;
  const cliHasBaseReasoning = baseReasoning !== undefined && isValidReasoning(baseReasoning);
  
  // Stage-specific defaults
  const STAGE_DEFAULTS: Record<string, ReasoningLevel> = {
    solver: 'medium',
    judge: 'medium',
    verifier: 'high',
    revision: 'high',  // Only used if verifier reasoning also not set
  };
  
  // Per-stage CLI flag (highest priority)
  const cliValue = {
    solver: flags.solverReasoning,
    judge: flags.judgeReasoning,
    verifier: flags.verifierReasoning,
    revision: flags.revisionReasoning,
  }[stage];
  
  if (cliValue && isValidReasoning(cliValue)) {
    return cliValue;
  }
  
  // Base -r flag (suppresses config defaults)
  if (cliHasBaseReasoning) {
    return baseReasoning as ReasoningLevel;
  }
  
  // Config file default
  const configValue = {
    solver: deepConfig?.solverReasoning,
    judge: deepConfig?.judgeReasoning,
    verifier: deepConfig?.verifierReasoning,
    revision: deepConfig?.revisionReasoning,
  }[stage];
  
  if (configValue) {
    return configValue;
  }
  
  // For revision without -r, fall back to verifier's effective reasoning
  if (stage === 'revision') {
    return resolveStageReasoning(flags, 'verifier', globalConfig);
  }
  
  return STAGE_DEFAULTS[stage];
}
