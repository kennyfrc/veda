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
export { DroidBackend, createDroidBackend } from './droid';
export { PiBackend, createPiBackend } from './pi';

import { registerBackend } from './registry';
import { createCodexBackend } from './codex';
import { createClaudeBackend } from './claude';
import { createDroidBackend } from './droid';
import { createPiBackend } from './pi';

// Register backends with canonical names
registerBackend('codex', createCodexBackend);
registerBackend('claude-code', createClaudeBackend);
registerBackend('droid', createDroidBackend);
registerBackend('pi', createPiBackend);
