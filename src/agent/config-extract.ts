/**
 * Extracted helpers for backend/model resolution.
 * These were previously embedded in resolveBackendModel.
 * Separated for testability and reduced duplication.
 */

import { resolveModelAlias as resolveModelAliasImpl, normalizeModelName } from './model-aliases';
import type { ResolvedBackendModel, ModelSource } from './config';

/**
 * Resolved alias target with normalized name.
 */
export interface AliasTarget {
  backend: string;
  model: string;
}

/**
 * Normalize model name and resolve to known alias if possible.
 */
export function resolveModelAliasNormalized(model: string): string {
  return normalizeModelName(model);
}

/**
 * Try to resolve a model name to its alias target.
 * Returns undefined if not a known alias.
 */
export function tryResolveAliasTarget(model: string): AliasTarget | undefined {
  return resolveModelAliasImpl(model);
}

/**
 * Check if an alias should apply to the given backend.
 *
 * An alias applies if:
 * 1. No explicit backend provided AND the alias resolves to some backend, OR
 * 2. The explicit backend matches the alias's backend
 */
export function shouldApplyAlias(
  explicitBackend: string | undefined,
  aliasTarget: AliasTarget
): boolean {
  if (!explicitBackend) {
    // No backend specified → use alias's backend
    return true;
  }
  // Backend specified → only apply if it matches
  return aliasTarget.backend === explicitBackend;
}

/**
 * Determine the backend to use when resolving.
 */
export function determineBackend(
  explicitBackend: string | undefined,
  aliasTarget: AliasTarget | undefined,
  shouldUseAlias: boolean,
  fallbackBackend: string
): string {
  if (explicitBackend) {
    return explicitBackend;
  }
  if (aliasTarget && shouldUseAlias) {
    return aliasTarget.backend;
  }
  return fallbackBackend;
}

/**
 * Determine the model to use for final resolution.
 *
 * This is the model that will be passed to `resolveModel()` for final
 * resolution (which also checks backendModels config).
 */
export function determineModelForResolution(
  explicitModel: string | undefined,
  aliasTarget: AliasTarget | undefined,
  useAlias: boolean,
  fallbackModel: string | undefined,
  globalConfigModel: string | undefined
): string | undefined {
  // Explicit model takes precedence
  if (explicitModel) {
    // Only use alias if useAlias is true
    if (useAlias && aliasTarget) {
      return aliasTarget.model;
    }
    return explicitModel;
  }

  // Fallback model next
  if (fallbackModel) {
    if (useAlias && aliasTarget) {
      return aliasTarget.model;
    }
    return fallbackModel;
  }

  // Global config model last
  if (globalConfigModel) {
    if (useAlias && aliasTarget) {
      return aliasTarget.model;
    }
    return globalConfigModel;
  }

  // No model specified
  return undefined;
}

/**
 * Main resolution logic for determining backend and model together.
 * This simplifies the original resolveBackendModel function.
 */
export interface ResolveBackendModelExtractedOptions {
  explicitBackend?: string;
  explicitModel?: string;
  fallbackBackend?: string;
  fallbackModel?: string;
  globalConfig?: { model?: string };
}

export function resolveBackendModelExtracted(
  opts: ResolveBackendModelExtractedOptions,
  resolveModelFn: (backend: string, model?: string) => string | undefined
): ResolvedBackendModel {
  const { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig } = opts;

  // Potential model to consider for alias resolution
  const preferredModel = explicitModel ?? fallbackModel ?? globalConfig?.model;

  // Try to resolve alias
  const aliasTarget = preferredModel ? tryResolveAliasTarget(preferredModel) : undefined;

  // Determine if we should use the alias
  // We only use the alias if it applies to the backend we're using
  // AND if the backend is not explicitly specified differently
  let useAlias = aliasTarget && shouldApplyAlias(explicitBackend, aliasTarget);

  // Special case: if we would have used a fallback and fallbackModel is an alias,
  // don't use the alias if fallbackBackend is specified (treat as literal)
  if (explicitModel == null && fallbackModel != null && fallbackBackend != null) {
    useAlias = false;
  }

  // Determine backend
  const backend = determineBackend(
    explicitBackend,
    aliasTarget,
    useAlias ?? false,
    fallbackBackend ?? 'codex'
  );

  // Determine model for final resolution
  const modelForResolution = determineModelForResolution(
    explicitModel,
    aliasTarget,
    useAlias ?? false,
    fallbackModel,
    globalConfig?.model
  );

  // Final model resolution using the provided resolveModel function
  const model = resolveModelFn(backend, modelForResolution);

  // Determine source based on actual resolution outcome
  let source: ModelSource;
  if (useAlias) {
    // Alias was used - normalize the aliasName for consistency
    source = { kind: 'alias', aliasName: normalizeModelName(preferredModel!) };
  } else if (explicitModel || explicitBackend) {
    source = { kind: 'explicit' };
  } else if (fallbackModel) {
    // A fallback model was explicitly specified
    source = { kind: 'fallback' };
  } else {
    // Using backend's built-in default model
    source = { kind: 'default' };
  }

  return { backend, model, source };
}
