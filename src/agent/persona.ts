import { readdir } from 'fs/promises';
import { join } from 'path';
import { getPersonasDir, getPersonaDir } from '../util/paths';
import type { ReasoningLevel, AgentConfig, SandboxMode, GlobalConfig } from './config';
import { resolveModel, resolveReasoning } from './config';

export interface PersonaMetadata {
  reasoning?: ReasoningLevel;
  // Future: sandbox?, category?, etc.
}

export interface Persona {
  name: string;
  systemPrompt: string;
  path: string;
  defaultReasoning: ReasoningLevel;
  metadata?: PersonaMetadata; // Parsed from frontmatter
}

export interface LoadPersonaOptions {
  baseDir?: string;
  metadata?: PersonaMetadata; // Override metadata (programmatic use)
}

/**
 * Parse persona metadata from YAML frontmatter.
 * Supports simple scalar values: key: value
 * Preserves reasoning: minimal|low|medium|high|xhigh
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
          const validReasoning: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
          if (validReasoning.includes(normalizedValue as ReasoningLevel)) {
            metadata.reasoning = normalizedValue as ReasoningLevel;
          }
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

  const personaDir = getPersonaDir(name, options.baseDir);
  const agentsPath = join(personaDir, 'AGENTS.md');

  const file = Bun.file(agentsPath);
  if (!await file.exists()) {
    throw new Error(`Persona not found: ${name} (expected ${agentsPath})`);
  }

  const systemPrompt = await file.text();

  // Resolve reasoning level with precedence: param > frontmatter > default
  const frontmatterMetadata = parsePersonaMetadata(systemPrompt);
  const defaultReasoning = options.metadata?.reasoning
    ?? frontmatterMetadata.reasoning
    ?? 'medium';

  return {
    name,
    systemPrompt,
    path: agentsPath,
    defaultReasoning,
    metadata: frontmatterMetadata,
  };
}

export async function listPersonas(baseDir?: string): Promise<string[]> {
  const personasDir = getPersonasDir(baseDir);
  
  try {
    const entries = await readdir(personasDir, { withFileTypes: true });
    const personas: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentsPath = join(personasDir, entry.name, 'AGENTS.md');
        if (await Bun.file(agentsPath).exists()) {
          personas.push(entry.name);
        }
      }
    }
    
    return personas.sort();
  } catch {
    return [];
  }
}

export async function personaExists(name: string, baseDir?: string): Promise<boolean> {
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
  
  if (options.systemPrompt) {
    systemPrompt = options.systemPrompt;
  } else {
    const persona = await loadPersona(personaName, options.baseDir);
    systemPrompt = persona.systemPrompt;
    systemPromptPath = persona.path;
    personaReasoning = persona.defaultReasoning;
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
    ?? options.aliasReasoning
    ?? personaReasoning 
    ?? resolveReasoning({
        backend: options.backend,
        globalConfig,
      });
  
  return {
    model: model ?? '',
    reasoning,
    sandbox: options.sandbox ?? 'read-only',
    systemPrompt,
    systemPromptPath,
  };
}
