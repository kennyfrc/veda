import { join } from 'path';
import { homedir } from 'os';

export function getVedaHome(): string {
  return process.env.VEDA_HOME ?? join(homedir(), '.config', 'veda');
}

/** @deprecated Use getVedaHome() instead */
export const VEDA_HOME = join(homedir(), '.config', 'veda');

export function getSessionDir(sessionId: string, baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'sessions', sessionId);
}

export function getSelectionPath(sessionId: string, baseDir?: string): string {
  return join(getSessionDir(sessionId, baseDir), 'selection');
}

export function getThreadPath(sessionId: string, baseDir?: string): string {
  return join(getSessionDir(sessionId, baseDir), 'thread.json');
}

/** Legacy path for migration from old format */
export function getLegacyThreadPath(sessionId: string, baseDir?: string): string {
  return join(getSessionDir(sessionId, baseDir), 'codex_thread_id');
}

/** Get personas directory */
export function getPersonasDir(baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'personas');
}

/** Get specific persona directory */
export function getPersonaDir(name: string, baseDir?: string): string {
  return join(getPersonasDir(baseDir), name);
}

/** Get global config file path */
export function getConfigPath(baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'config');
}

/** Default session ID */
export const DEFAULT_SESSION = 'default';

/** Validate session ID format */
export function isValidSessionId(id: string): boolean {
  if (id.length === 0 || id.length > 64) return false;
  // Allowed: A-Za-z0-9._:-
  return /^[A-Za-z0-9._:-]+$/.test(id);
}

/** Ensure directory exists */
export async function ensureDir(path: string): Promise<void> {
  await Bun.write(join(path, '.keep'), '');
  await Bun.file(join(path, '.keep')).delete();
}
