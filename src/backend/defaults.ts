export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type ModelStage = 'base' | 'solver' | 'judge' | 'verifier' | 'revision';

export const BACKEND_DEFAULT_MODELS: Record<string, string> = {
  'claude-code': 'opus',
  'codex': 'gpt-5.2',
  'gemini-cli': 'gemini-3-pro-preview',
  'mu': 'mu/fireworks/accounts/fireworks/routers/kimi-k2p6',
};

/**
 * Stage-specific default model overrides.
 *
 * Important: these are only used when the user has not provided a model via:
 * - explicit CLI flags
 * - per-backend config override (e.g. CODEX_MODEL)
 * - global config MODEL
 */
export const BACKEND_STAGE_DEFAULT_MODELS: Record<string, Partial<Record<ModelStage, string>>> = {
  codex: {
    solver: 'gpt-5.3-codex',
    verifier: 'gpt-5.3-codex',
  },
};

export const BACKEND_DEFAULT_REASONING: Record<string, ReasoningLevel> = {
  'claude-code': 'medium',
  'codex': 'medium',
  'gemini-cli': 'medium',
  'mu': 'medium',
};

export function getBackendDefaultModel(backendId: string): string | undefined {
  return BACKEND_DEFAULT_MODELS[backendId];
}

export function getBackendDefaultModelForStage(
  backendId: string,
  stage: ModelStage
): string | undefined {
  const stageOverride = BACKEND_STAGE_DEFAULT_MODELS[backendId]?.[stage];
  return stageOverride ?? getBackendDefaultModel(backendId);
}

export function getBackendDefaultReasoning(backendId: string): ReasoningLevel {
  return BACKEND_DEFAULT_REASONING[backendId] ?? 'medium';
}
