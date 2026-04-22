export type {
  Message,
  UsageStats,
  RunOptions,
  ResumeOptions,
  Backend,
  BackendFactory,
} from './types';

export {
  extractText,
  extractErrors,
  getSessionId,
  getUsage,
  collectMessages,
} from './types';

export {
  registerBackend,
  getBackend,
  hasBackend,
  listBackends,
  getAvailableBackends,
} from './registry';

export { 
  getBackendDefaultModel, 
  getBackendDefaultReasoning,
  BACKEND_DEFAULT_MODELS,
  BACKEND_DEFAULT_REASONING,
} from './defaults';

export { CodexBackend, createCodexBackend } from './codex';
export { ClaudeBackend, createClaudeBackend } from './claude';
export { GeminiBackend, createGeminiBackend } from './gemini';
export { MuBackend, createMuBackend } from './mu';

import { registerBackend } from './registry';
import { createCodexBackend } from './codex';
import { createClaudeBackend } from './claude';
import { createGeminiBackend } from './gemini';
import { createMuBackend } from './mu';

// Register backends with canonical names
registerBackend('codex', createCodexBackend);
registerBackend('claude-code', createClaudeBackend);
registerBackend('gemini-cli', createGeminiBackend);
registerBackend('mu', createMuBackend);
