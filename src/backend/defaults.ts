// Backend default models - each backend has its own default

export const BACKEND_DEFAULT_MODELS: Record<string, string> = {
  'claude-code': 'opus',
  'codex': 'gpt-5.2',
  'gemini-cli': 'gemini-3-pro-preview',
};

/** Get built-in default model for a backend */
export function getBackendDefaultModel(backendId: string): string | undefined {
  return BACKEND_DEFAULT_MODELS[backendId];
}
