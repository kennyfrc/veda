import { join } from 'path';
import { homedir } from 'os';

/**
 * Resolve the user home directory. Prefers process.env.HOME so runtime
 * overrides (e.g. tests, custom environments) take effect; Bun's os.homedir()
 * caches at startup and ignores later HOME changes.
 */
function homeDir(): string {
	return process.env.HOME || homedir();
}

/** User home directory, respecting runtime HOME overrides. */
export { homeDir as getHomeDir };

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

/** Get checkpoint file path for deep mode resume */
export function getCheckpointPath(sessionId: string, baseDir?: string): string {
  return join(getSessionDir(sessionId, baseDir), 'checkpoint.yaml');
}

/** Legacy path for migration from old format */
export function getLegacyThreadPath(sessionId: string, baseDir?: string): string {
  return join(getSessionDir(sessionId, baseDir), 'codex_thread_id');
}

/**
 * Agent skills discovery directories.
 *
 * `~/.agents/skills/` is read globally by both pi and OpenAI Codex CLI
 * (pi always trusts it; no project-trust prompt). Claude Code reads
 * `~/.claude/skills/` and follows symlinks, so install writes the canonical
 * file to `~/.agents/skills/` and symlinks `~/.claude/skills/<name>` to it.
 */
export function getAgentSkillsDir(): string {
	return join(homeDir(), '.agents', 'skills');
}

export function getClaudeSkillsDir(): string {
	return join(homeDir(), '.claude', 'skills');
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

/** Get judge statistics file path (JSONL format) - legacy */
export function getJudgeStatsPath(baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'judge-stats.jsonl');
}

/** Get pairwise statistics file path (JSONL format) */
export function getPairwiseStatsPath(baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'pairwise-stats.jsonl');
}

/** Get ratings snapshot file path (JSON format) */
export function getRatingsPath(baseDir?: string): string {
  return join(baseDir ?? getVedaHome(), 'ratings.json');
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
