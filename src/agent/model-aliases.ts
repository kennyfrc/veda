export interface ModelAliasTarget {
  backend: string;
  model: string;
}

export const MODEL_ALIASES: Record<string, ModelAliasTarget> = {
  // Claude models
  'opus': { backend: 'claude-code', model: 'opus' },
  'sonnet': { backend: 'claude-code', model: 'sonnet' },
  'haiku': { backend: 'claude-code', model: 'haiku' },
  
  // OpenAI models (via codex)
  'gpt': { backend: 'codex', model: 'gpt-5.3-codex' },
  
  // Gemini models
  'gemini-pro': { backend: 'gemini-cli', model: 'gemini-3-pro-preview' },
  'gemini-flash': { backend: 'gemini-cli', model: 'gemini-3-flash-preview' },
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
