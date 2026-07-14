export interface ModelAliasTarget {
  backend: string;
  model: string;
  /** Optional default reasoning level for this alias. */
  reasoning?: string;
}

export const MODEL_ALIASES: Record<string, ModelAliasTarget> = {
  // Claude models
  'opus': { backend: 'claude-code', model: 'opus' },
  'sonnet': { backend: 'claude-code', model: 'sonnet' },
  'haiku': { backend: 'claude-code', model: 'haiku' },
  
  // OpenAI models (via codex)
  'gpt': { backend: 'codex', model: 'gpt-5.3-codex' },

  // Droid models (via droid exec)
  'fable': { backend: 'droid', model: 'claude-fable-5' },

  // jdc models (via jdc CLI)
  'glm': { backend: 'jdc', model: 'jdc/makora/zai-org/GLM-5.2-NVFP4', reasoning: 'high' },
  'sol': { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'high' },
};

export function normalizeModelName(input: string): string {
  return input.trim().toLowerCase();
}

export function resolveModelAlias(model: string): ModelAliasTarget | undefined {
  const normalized = normalizeModelName(model);
  return MODEL_ALIASES[normalized];
}

export function isModelAlias(model: string): boolean {
  return resolveModelAlias(model) !== undefined;
}

export function listModelAliases(): string[] {
  return Object.keys(MODEL_ALIASES);
}
