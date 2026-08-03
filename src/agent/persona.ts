import { readdir } from 'fs/promises';
import { join } from 'path';
import { getPersonasDir, getPersonaDir } from '../util/paths';
import type { ReasoningLevel, AgentConfig, SandboxMode, GlobalConfig } from './config';
import { resolveModel, resolveReasoning, parseSandboxMode } from './config';
import { withSandboxModeNotice } from './sandbox';

// Embedded (batteries-included) personas. These ship in the binary and are
// the default source — no `veda init` required. Users can override any of
// them by placing an AGENTS.md at ~/.config/veda/personas/<name>/AGENTS.md,
// or add brand-new personas there.
// (Mirrors the skills.ts embedding pattern: `import ... with { type: 'file' }`
// resolves to a path that Bun embeds into the compiled binary.)
import navigatorChatAgent from '../../personas/navigator-chat/AGENTS.md' with { type: 'file' };
import reviewerAgent from '../../personas/reviewer/AGENTS.md' with { type: 'file' };
import navigatorPlanAgent from '../../personas/navigator-plan/AGENTS.md' with { type: 'file' };
import workerAgent from '../../personas/worker/AGENTS.md' with { type: 'file' };

const EMBEDDED_PERSONA_PATHS: Record<string, string> = {
  'navigator-chat': navigatorChatAgent,
  'reviewer': reviewerAgent,
  'navigator-plan': navigatorPlanAgent,
  'worker': workerAgent,
};

/** Names of all batteries-included personas. */
export const EMBEDDED_PERSONA_NAMES = Object.keys(EMBEDDED_PERSONA_PATHS);

/** Read an embedded persona's AGENTS.md content, or undefined if not embedded. */
async function readEmbeddedPersona(name: string): Promise<string | undefined> {
  const path = EMBEDDED_PERSONA_PATHS[name];
  if (!path) return undefined;
  return await Bun.file(path).text();
}

/** Public alias for init.ts to materialize embedded personas to the config dir. */
export async function readPersonaForInit(name: string): Promise<string | undefined> {
  return readEmbeddedPersona(name);
}

export interface PersonaMetadata {
  reasoning?: ReasoningLevel;
  /** Tool allowlist. An empty array means no tools; 'all' grants the backend's full toolset. */
  tools?: string[] | 'all';
  /** Sandbox mode requested by the persona (worker defaults to workspace-write). */
  sandbox?: SandboxMode;
  // Future: category?, etc.
}

export interface Persona {
  name: string;
  systemPrompt: string;
  path: string;
  defaultReasoning: ReasoningLevel;
  tools?: string[] | 'all';
  /** Sandbox mode from frontmatter (falls below an explicit --sandbox flag). */
  defaultSandbox?: SandboxMode;
  metadata?: PersonaMetadata; // Parsed from frontmatter
}

export interface LoadPersonaOptions {
  baseDir?: string;
  metadata?: PersonaMetadata; // Override metadata (programmatic use)
}

/**
 * Parse persona metadata from YAML frontmatter.
 * Supports simple scalar values: key: value
 * Preserves reasoning: minimal|low|medium|high|xhigh|max
 */
export function parsePersonaMetadata(content: string): PersonaMetadata {
  // Extract frontmatter between --- delimiters
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!frontmatterMatch) {
    return {};
  }

  const yamlText = frontmatterMatch[1];
  const metadata: PersonaMetadata = {};

  // Simple YAML subset parser: key: value (support scalars only)
  const lines = yamlText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const normalizedKey = key.trim();
        const normalizedValue = value.trim();

        if (normalizedKey === 'reasoning') {
          // Validate reasoning level
          const validReasoning: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
          if (validReasoning.includes(normalizedValue as ReasoningLevel)) {
            metadata.reasoning = normalizedValue as ReasoningLevel;
          }
        } else if (normalizedKey === 'tools') {
          const lower = normalizedValue.toLowerCase();
          if (lower === 'none') {
            metadata.tools = [];
          } else if (lower === 'all') {
            // 'all' grants the backend's full toolset (undefined allowlist).
            metadata.tools = 'all';
          } else {
            metadata.tools = normalizedValue.split(',').map(tool => tool.trim()).filter(Boolean);
          }
        } else if (normalizedKey === 'sandbox') {
          const mode = parseSandboxMode(normalizedValue);
          if (mode) metadata.sandbox = mode;
        }
        // Future: parse other metadata fields here
      }
    }
  }

  return metadata;
}

/**
 * Load a persona from its AGENTS.md file.
 * Metadata precedence: param override > frontmatter > default 'medium'
 *
 * Backward compatible: accepts either (name, options) or (name, baseDir string)
 */
export async function loadPersona(name: string, optionsOrBaseDir?: LoadPersonaOptions | string): Promise<Persona> {
  // Handle backward compatibility: (name, baseDir) as string
  const options: LoadPersonaOptions = typeof optionsOrBaseDir === 'string'
    ? { baseDir: optionsOrBaseDir }
    : optionsOrBaseDir ?? {};

  // Prefer a user override in the config dir, if present. This lets users
  // tweak a bundled persona without forking the repo.
  const configDirPath = join(getPersonaDir(name, options.baseDir), 'AGENTS.md');
  const configFile = Bun.file(configDirPath);
  if (await configFile.exists()) {
    const systemPrompt = await configFile.text();
    const frontmatterMetadata = parsePersonaMetadata(systemPrompt);
    const defaultReasoning = options.metadata?.reasoning
      ?? frontmatterMetadata.reasoning
      ?? 'medium';
    return {
      name,
      systemPrompt,
      path: configDirPath,
      defaultReasoning,
      tools: options.metadata?.tools ?? frontmatterMetadata.tools,
      defaultSandbox: frontmatterMetadata.sandbox,
      metadata: frontmatterMetadata,
    };
  }

  // Otherwise use the embedded (batteries-included) persona.
  const embedded = await readEmbeddedPersona(name);
  if (embedded !== undefined) {
    const frontmatterMetadata = parsePersonaMetadata(embedded);
    const defaultReasoning = options.metadata?.reasoning
      ?? frontmatterMetadata.reasoning
      ?? 'medium';
    return {
      name,
      systemPrompt: embedded,
      path: EMBEDDED_PERSONA_PATHS[name],
      defaultReasoning,
      tools: options.metadata?.tools ?? frontmatterMetadata.tools,
      defaultSandbox: frontmatterMetadata.sandbox,
      metadata: frontmatterMetadata,
    };
  }

  // Not bundled and not in config.
  throw new Error(`Persona not found: ${name} (expected ${configDirPath}, or a bundled persona of that name)`);
}

export async function listPersonas(baseDir?: string): Promise<string[]> {
  // Merge embedded (batteries-included) personas with any user-defined ones
  // in the config dir. Config-dir entries can override embedded names.
  const configNames: string[] = [];
  const personasDir = getPersonasDir(baseDir);

  try {
    const entries = await readdir(personasDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentsPath = join(personasDir, entry.name, 'AGENTS.md');
        if (await Bun.file(agentsPath).exists()) {
          configNames.push(entry.name);
        }
      }
    }
  } catch {
    // config dir may not exist yet — that's fine, embedded personas still work
  }

  // Union, config-dir names taking precedence (they're overrides), sorted.
  const merged = Array.from(new Set([...EMBEDDED_PERSONA_NAMES, ...configNames]));
  return merged.sort();
}

export async function personaExists(name: string, baseDir?: string): Promise<boolean> {
  // Exists if it's embedded OR present in the config dir.
  if (EMBEDDED_PERSONA_PATHS[name] !== undefined) return true;
  const agentsPath = join(getPersonaDir(name, baseDir), 'AGENTS.md');
  return await Bun.file(agentsPath).exists();
}

export interface ResolveConfigOptions {
  persona?: string;
  model?: string;
  reasoning?: ReasoningLevel;
  sandbox?: SandboxMode;
  backend?: string;
  baseDir?: string;
  systemPrompt?: string;
  tools?: string[];
  noTools?: boolean;
  /** Reasoning level from model alias (used when no explicit -r flag). */
  aliasReasoning?: ReasoningLevel;
}

export async function resolveAgentConfig(
  options: ResolveConfigOptions,
  defaults: { persona: string },
  globalConfig?: GlobalConfig
): Promise<AgentConfig> {
  const personaName = options.persona ?? defaults.persona;
  
  let systemPrompt: string;
  let systemPromptPath: string | undefined;
  let personaReasoning: ReasoningLevel | undefined;
  let personaTools: string[] | 'all' | undefined;
  let personaSandbox: SandboxMode | undefined;
  
  if (options.systemPrompt) {
    systemPrompt = options.systemPrompt;
  } else {
    const persona = await loadPersona(personaName, options.baseDir);
    systemPrompt = persona.systemPrompt;
    systemPromptPath = persona.path;
    personaReasoning = persona.defaultReasoning;
    personaTools = persona.tools;
    personaSandbox = persona.defaultSandbox;
  }
  
  if (!options.backend) {
    throw new Error('Backend must be specified for agent config resolution');
  }
  
  const model = resolveModel({
    backend: options.backend,
    explicitModel: options.model,
    globalConfig,
  });
  
  const reasoning = options.reasoning 
    ?? personaReasoning 
    ?? options.aliasReasoning
    ?? resolveReasoning({
        backend: options.backend,
        globalConfig,
      });

  // Sandbox precedence: explicit --sandbox flag, then persona frontmatter
  // sandbox:, then the config DEFAULT_SANDBOX, then read-only.
  const sandbox = options.sandbox
    ?? personaSandbox
    ?? globalConfig?.defaultSandbox
    ?? 'read-only';

  // Tool policy. undefined means "backend's full toolset" (worker's
  // `tools: all`); [] means "no tools"; a list is an explicit allowlist.
  // Precedence: --no-tools > --tools > persona frontmatter > no tools.
  let tools: string[] | undefined;
  if (options.noTools) {
    tools = [];
  } else if (options.tools) {
    tools = options.tools;
  } else if (personaTools === undefined) {
    tools = [];
  } else if (personaTools === 'all') {
    tools = undefined;
  } else {
    tools = personaTools;
  }

  return {
    model: model ?? '',
    reasoning,
    sandbox,
    tools,
    systemPrompt: withSandboxModeNotice(systemPrompt, { tools, sandbox }),
    systemPromptPath,
  };
}

