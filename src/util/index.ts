export {
  VEDA_HOME,
  DEFAULT_SESSION,
  getVedaHome,
  getSessionDir,
  getSelectionPath,
  getThreadPath,
  getLegacyThreadPath,
  getPersonasDir,
  getPersonaDir,
  getConfigPath,
  isValidSessionId,
  ensureDir,
} from './paths';

export { withLock, acquireLock, LockError, type LockOptions } from './lock';
export type { Result } from './result';
export { ok, err, isOk, isErr } from './result';
export { AsyncQueue } from './queue';
export { formatUsageStats } from './format';
export { c } from './colors';
export {
  FORMAT_CONFIG,
  createFormatterState,
  formatPhaseHeader,
  formatPhaseSummary,
  accumulateTool,
  formatSolverComplete,
  truncateWithCount,
  formatToolStart,
  formatCandidateSeparator,
  formatCandidateContent,
  formatSelection,
  formatRevision,
  humanizeTokens,
  formatUsageCompact,
  formatStageUsage,
  formatFinalSeparator,
  formatCompletionStatus,
  formatFinalTokens,
  type PhaseState,
  type FormatterState,
} from './trace-format';
