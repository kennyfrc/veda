import { join, dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { cwd } from 'process';
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

/**
 * Find the nearest project root — the closest ancestor of `dir` (default:
 * current working directory) that contains a `.git` entry. Returns undefined
 * when no git root is found (e.g. running outside a repo).
 */
export function findProjectRoot(dir?: string): string | undefined {
  let current = dir ? resolve(dir) : cwd();
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Project-local veda home: `<projectRoot>/.veda`, or undefined when no git
 * project root is discoverable from the cwd. Session artifacts live here so
 * they travel with the repo and any agent operating in the folder can read
 * them in place (rather than hiding them in the user-global config).
 */
export function getProjectVedaBase(dir?: string): string | undefined {
  const root = findProjectRoot(dir);
  return root ? join(root, '.veda') : undefined;
}

export function getSessionDir(sessionId: string, baseDir?: string): string {
  // Explicit baseDir (tests) and an explicit VEDA_HOME override always win.
  // Otherwise prefer project-local `.veda/sessions/<session>`; fall back to
  // the user-global veda home when no project root is discoverable. Config,
  // personas, and stats stay user-global (getVedaHome) by design.
  const base = baseDir
    ?? (process.env.VEDA_HOME ? getVedaHome() : (getProjectVedaBase() ?? getVedaHome()));
  return join(base, 'sessions', sessionId);
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
