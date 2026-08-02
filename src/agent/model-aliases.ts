export interface ModelAliasTarget {
  backend: string;
  model: string;
  /** Optional default reasoning level for this alias. */
  reasoning?: string;
}

export const MODEL_ALIASES: Record<string, ModelAliasTarget> = {
  // Claude models
  'opus': { backend: 'claude-code', model: 'opus' },
  'sonnet': { backend: 'claude-code', model: 'sonnet' },
  'haiku': { backend: 'claude-code', model: 'haiku' },
  
  // OpenAI models (via codex)
  'gpt': { backend: 'codex', model: 'gpt-5.3-codex' },

  // Droid models (via droid exec)
  'fable': { backend: 'droid', model: 'claude-fable-5' },

  // pi models (via pi CLI)
  'glm': { backend: 'pi', model: 'pi/makora/zai-org/GLM-5.2-NVFP4', reasoning: 'xhigh' },
  'k3': { backend: 'pi', model: 'pi/neuralwatt/kimi-k3', reasoning: 'max' },
  'sol': { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'max' },
};

export interface UserAliases {
  [name: string]: ModelAliasTarget;
}

/**
 * Parse a MODEL_ALIASES config value into a user alias table.
 *
 * Format: comma-separated `name=model[:reasoning]` entries where `model` is
 * the FULL model string (e.g. `flash=pi/neuralwatt/deepseek-v4-flash`). The
 * backend is inferred from the model's prefix (pi/…, gpt-…, o1-/o3-, claude-…),
 * matching how veda already infers a backend for an unprefixed `-m` value.
 * Invalid entries are skipped.
 */
export function parseModelAliases(value: string): UserAliases {
  const out: UserAliases = {};
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const name = entry.slice(0, eq).trim().toLowerCase();
    const target = entry.slice(eq + 1).trim();
    if (!name || !target) continue;

    const reasoning = target.lastIndexOf(':') !== -1
      ? target.slice(target.lastIndexOf(':') + 1)
      : undefined;
    const model = reasoning !== undefined ? target.slice(0, target.lastIndexOf(':')) : target;
    const backend = inferAliasBackend(model);
    if (!model || !backend) continue;

    out[name] = { backend, model, ...(reasoning ? { reasoning } : {}) };
  }
  return out;
}

/** Infer an alias's backend from its model prefix (mirrors config-extract). */
function inferAliasBackend(model: string): string | undefined {
  const normalized = model.trim().toLowerCase();
  const prefixes: Array<[string, string]> = [
    ['pi/', 'pi'],
    ['gpt-', 'codex'],
    ['o1-', 'codex'],
    ['o3-', 'codex'],
    ['claude-', 'claude-code'],
  ];
  for (const [prefix, backend] of prefixes) {
    if (normalized.startsWith(prefix)) return backend;
  }
  return undefined;
}

export function normalizeModelName(input: string): string {
  return input.trim().toLowerCase();
}

export function resolveModelAlias(model: string, extraAliases?: UserAliases): ModelAliasTarget | undefined {
  const normalized = normalizeModelName(model);
  // User-defined aliases win over the built-in table (config is an override layer).
  if (extraAliases && extraAliases[normalized]) return extraAliases[normalized];
  return MODEL_ALIASES[normalized];
}

export function isModelAlias(model: string, extraAliases?: UserAliases): boolean {
  return resolveModelAlias(model, extraAliases) !== undefined;
}

export function listModelAliases(extraAliases?: UserAliases): string[] {
  return Object.keys({ ...MODEL_ALIASES, ...extraAliases });
}
