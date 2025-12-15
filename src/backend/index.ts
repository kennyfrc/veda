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

export { CodexBackend, createCodexBackend } from './codex';
export { ClaudeBackend, createClaudeBackend } from './claude';
export { GeminiBackend, createGeminiBackend } from './gemini';

import { registerBackend } from './registry';
import { createCodexBackend } from './codex';
import { createClaudeBackend } from './claude';
import { createGeminiBackend } from './gemini';

registerBackend('codex', createCodexBackend);
registerBackend('claude', createClaudeBackend);
registerBackend('gemini', createGeminiBackend);
