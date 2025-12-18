// Model aliases - map friendly names to backend + model pairs

export interface ModelAliasTarget {
  backend: string;
  model: string;
}

/**
 * Model aliases that auto-resolve to the correct backend.
 * When user specifies -m <alias> without -b, we can infer the backend.
 */
export const MODEL_ALIASES: Record<string, ModelAliasTarget> = {
  // Claude models
  'opus': { backend: 'claude-code', model: 'opus' },
  'sonnet': { backend: 'claude-code', model: 'sonnet' },
  'haiku': { backend: 'claude-code', model: 'haiku' },
  
  // OpenAI models (via codex)
  'gpt': { backend: 'codex', model: 'gpt-5.2' },
  
  // Gemini models
  'gemini-pro': { backend: 'gemini-cli', model: 'gemini-3-pro-preview' },
  'gemini-flash': { backend: 'gemini-cli', model: 'gemini-3-flash-preview' },
};

/**
 * Normalize model name for alias lookup.
 * Trims whitespace and lowercases.
 */
export function normalizeModelName(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Resolve a model alias to its backend + model target.
 * Returns undefined if the model is not a known alias.
 */
export function resolveModelAlias(model: string): ModelAliasTarget | undefined {
  const normalized = normalizeModelName(model);
  return MODEL_ALIASES[normalized];
}

/**
 * Check if a model name is a known alias.
 */
export function isModelAlias(model: string): boolean {
  return resolveModelAlias(model) !== undefined;
}

/**
 * List all available model aliases.
 */
export function listModelAliases(): string[] {
  return Object.keys(MODEL_ALIASES);
}
