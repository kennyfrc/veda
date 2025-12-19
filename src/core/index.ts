// Core primitives: plain data types + functions, no hidden state.

// LLM primitive
export type {
  Message,
  UsageStats,
  Reasoning,
  Sandbox,
  LlmRequest,
  LlmResponse,
} from './llm';

export {
  runLlm,
  streamLlm,
  isBackendAvailable,
  extractText,
  extractErrors,
  getSessionId,
  getUsage,
  combineUsage,
  collectAllMessages,
} from './llm';

// Ensemble primitive
export type {
  EnsembleMember,
  EnsembleOutput,
  EnsembleResult,
  EnsembleEvent,
} from './ensemble';

export { runEnsemble } from './ensemble';

// Judge primitive
export type {
  ConfidenceLevel,
  JudgeDecision,
  JudgeResult,
} from './judge';

export {
  formatJudgePrompt,
  parseJudgeDecision,
  runJudge,
} from './judge';

// Verification primitive
export type {
  VerificationType,
  Check,
  CheckResult,
  Revision,
  VerificationResult,
} from './verify';

export {
  formatGenerateChecksPrompt,
  formatAnswerChecksPrompt,
  formatRevisionPrompt,
  parseChecks,
  parseCheckResults,
  parseRevision,
  runVerification,
} from './verify';

// Reasoning modules
export type {
  ModuleCategory,
  ReasoningModule,
  SelectModulesOptions,
} from './modules';

export {
  REASONING_MODULES,
  ALL_CATEGORIES,
  MODULES_BY_CATEGORY,
  MODULE_BY_ID,
  selectModules,
} from './modules';
