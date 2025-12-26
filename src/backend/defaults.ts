export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const BACKEND_DEFAULT_MODELS: Record<string, string> = {
  'claude-code': 'opus',
  'codex': 'gpt-5.2',
  'gemini-cli': 'gemini-3-pro-preview',
};

export const BACKEND_DEFAULT_REASONING: Record<string, ReasoningLevel> = {
  'claude-code': 'medium',
  'codex': 'medium',
  'gemini-cli': 'medium',
};

export function getBackendDefaultModel(backendId: string): string | undefined {
  return BACKEND_DEFAULT_MODELS[backendId];
}

export function getBackendDefaultReasoning(backendId: string): ReasoningLevel {
  return BACKEND_DEFAULT_REASONING[backendId] ?? 'medium';
}
