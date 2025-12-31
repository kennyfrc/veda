/**
 * CLI Resolution - Resolve backend/model with precedence rules.
 * 
 * Resolution Precedence (highest to lowest):
 * 1. Explicit CLI flag (--backend, --model, --solver-model, etc.)
 * 2. Model alias inference (opus → claude-code)
 * 3. Model prefix inference (gpt-5.2 → codex)
 * 4. Config file defaults
 * 5. Built-in defaults (codex/gpt-5.2)
 */

import type { 
  RawFlags, 
  ResolvedBackendModel, 
  ResolutionSource,
  StageConfig,
  SolverConfig,
  VerifyConfig,
  StageConfigs,
} from './types';
import { CliValidationError } from './types';
import { resolveModelAlias, MODEL_ALIASES } from '../agent/model-aliases';
import { getBackendDefaultModel } from '../backend/defaults';
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
// Backend/Model Resolution
// =============================================================================

export interface ResolveOptions {
  explicitBackend?: string;
  explicitModel?: string;
  globalConfig?: GlobalConfig;
}

/**
 * Resolve backend and model with full precedence chain.
 * Throws on alias/backend mismatch.
 */
export function resolveBackendModel(opts: ResolveOptions): ResolvedBackendModel {
  const { explicitBackend, explicitModel, globalConfig } = opts;
  
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
  } else if (globalConfig?.model) {
    // Try to resolve global model as alias or prefix
    const globalAlias = resolveModelAlias(globalConfig.model);
    if (globalAlias) {
      backend = globalAlias.backend;
      source = 'config';
    } else {
      const inferred = inferBackendFromPrefix(globalConfig.model);
      if (inferred) {
        backend = inferred;
        source = 'config';
      } else {
        backend = 'codex';
        source = 'default';
      }
    }
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
      model = getBackendDefaultModel(backend) ?? 'unknown';
    } else {
      model = globalConfig.model;
    }
  } else {
    model = getBackendDefaultModel(backend) ?? 'unknown';
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
  
  // Distributed mode: CLI flag > config > false
  const useDistributed = flags.distributeSolvers ?? deepConfig?.distributeSolvers ?? false;
  
  if (useDistributed) {
    // If solver model is an alias, it determines the backend (can't use sonnet on codex)
    // This overrides distributed backends from config
    if (solverModelAlias) {
      return {
        mode: 'fixed',
        backend: solverModelAlias.backend,
        model: solverModelAlias.model,
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
      });
      modelPerBackend.set(backend, resolved.model);
    }
    
    return {
      mode: 'distributed',
      backends,
      modelPerBackend,
    };
  }
  
  // Fixed mode: solver backend CLI > alias-inferred > base
  const effectiveBackend = flags.solverBackend 
    ?? (solverModelAlias ? solverModelAlias.backend : undefined);
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: flags.solverModel ?? flags.model,
    globalConfig,
  });
  
  return {
    mode: 'fixed',
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
  };
}

function resolveJudgeConfig(
  flags: RawFlags,
  _base: ResolvedBackendModel,
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
  
  // If judge model is an alias, let it drive the backend
  const judgeModel = flags.judgeModel ?? deepConfig?.judgeModel;
  const judgeModelAlias = judgeModel ? resolveModelAlias(judgeModel) : undefined;
  
  // Judge backend: CLI > alias-inferred > config > base
  const effectiveBackend = flags.judgeBackend 
    ?? (judgeModelAlias ? judgeModelAlias.backend : undefined)
    ?? deepConfig?.judgeBackend;
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: judgeModel ?? flags.model,
    globalConfig,
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
  };
}

function resolveVerifierConfig(
  flags: RawFlags,
  _base: ResolvedBackendModel,
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
  
  // If verifier model is an alias, let it drive the backend
  const verifierModel = flags.verifierModel ?? deepConfig?.verifierModel;
  const verifierModelAlias = verifierModel ? resolveModelAlias(verifierModel) : undefined;
  
  // Verifier backend: CLI > alias-inferred > config > base
  const effectiveBackend = flags.verifierBackend 
    ?? (verifierModelAlias ? verifierModelAlias.backend : undefined)
    ?? deepConfig?.verifierBackend;
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: verifierModel ?? flags.model,
    globalConfig,
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
  };
}

function resolveRevisionConfig(
  flags: RawFlags,
  _base: ResolvedBackendModel,
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
  
  // If revision model is an alias, let it drive the backend (don't inherit from verifier)
  const revisionModel = flags.revisionModel ?? deepConfig?.revisionModel;
  const revisionModelAlias = revisionModel ? resolveModelAlias(revisionModel) : undefined;
  
  // Revision backend: CLI > alias-inferred > config > verifier > base
  const effectiveBackend = flags.revisionBackend 
    ?? (revisionModelAlias ? revisionModelAlias.backend : undefined)
    ?? deepConfig?.revisionBackend 
    ?? flags.verifierBackend 
    ?? deepConfig?.verifierBackend;
  
  const resolved = resolveBackendModel({
    explicitBackend: effectiveBackend,
    explicitModel: revisionModel ?? flags.verifierModel ?? deepConfig?.verifierModel ?? flags.model,
    globalConfig,
  });
  
  return {
    backend: effectiveBackend ?? resolved.backend,
    model: resolved.model,
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
