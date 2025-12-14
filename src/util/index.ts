/**
 * Utility module exports.
 */

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
