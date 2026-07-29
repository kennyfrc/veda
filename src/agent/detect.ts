/**
 * Harness detection and default-model selection.
 *
 * `veda init` uses this to detect which backend CLIs are installed and
 * pick a sensible default model (full model name, never an alias) for
 * the skills to bake in.
 *
 * Priority (first installed wins):
 *   1. claude-code → claude-fable-5   (Fable)
 *   2. codex       → gpt-5.6-sol      (Sol)
 *   3. droid       → claude-fable-5   (Fable via droid)
 *   4. pi          → pi/neuralwatt/kimi-k3  (K3, pi's frontier option)
 */
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface DetectedBackend {
  name: string;
  /** The CLI command found on PATH. */
  command: string;
}

export interface DefaultModel {
  /** Full model name, e.g. "gpt-5.6-sol" or "pi/neuralwatt/kimi-k3". */
  model: string;
  /** The backend that serves it. */
  backend: string;
}

/** The binary names each backend ships. */
const BACKEND_BINARIES: Record<string, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'droid': 'droid',
  'pi': 'pi',
};

/** Default model for each backend (full model name, not an alias). */
const BACKEND_DEFAULT_MODEL: Record<string, DefaultModel> = {
  'claude-code': { model: 'claude-fable-5', backend: 'claude-code' },
  'codex':       { model: 'gpt-5.6-sol',    backend: 'codex' },
  'droid':       { model: 'claude-fable-5', backend: 'droid' },
  // pi: fireworks hosts Kimi K3. The model id is path-shaped
  // (accounts/fireworks/models/kimi-k3), so the veda spec is
  // pi/fireworks/accounts/fireworks/models/kimi-k3 — parsePiModel
  // splits on the first slash after pi/ to get provider + model.
  'pi':          { model: 'pi/fireworks/accounts/fireworks/models/kimi-k3', backend: 'pi' },
};

/** Detection priority: claude → codex → droid → pi. */
const DETECTION_ORDER = ['claude-code', 'codex', 'droid', 'pi'];

/**
 * Check whether a binary is on PATH. Uses a shell `command -v` so it
 * respects the user's actual PATH (including nvm, brew, etc.).
 */
export function isCommandAvailable(command: string): boolean {
  try {
    // Bun's process is sync; use execSync for the PATH probe.
    const { execSync } = require('child_process');
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which backend CLIs are installed, in priority order.
 */
export function detectBackends(): DetectedBackend[] {
  const found: DetectedBackend[] = [];
  for (const name of DETECTION_ORDER) {
    const cmd = BACKEND_BINARIES[name];
    if (isCommandAvailable(cmd)) {
      found.push({ name, command: cmd });
    }
  }
  return found;
}

/**
 * Pick the default model from the installed backends.
 * Returns undefined if no backend is installed.
 */
export function pickDefaultModel(backends?: DetectedBackend[]): DefaultModel | undefined {
  const installed = backends ?? detectBackends();
  if (installed.length === 0) return undefined;
  // First in priority order wins.
  return BACKEND_DEFAULT_MODEL[installed[0].name];
}

/**
 * Read a pi models.json and return all model IDs in the pi/<provider>/<id>
 * convention. Returns [] if pi isn't configured or the file is missing.
 */
export function listPiModels(): string[] {
  const path = join(homedir(), '.pi', 'agent', 'models.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    const ids: string[] = [];
    for (const [provider, cfg] of Object.entries(data.providers ?? {})) {
      for (const m of (cfg as any).models ?? []) {
        ids.push(`pi/${provider}/${m.id}`);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
