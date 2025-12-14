/**
 * Persona loading and management.
 * 
 * Personas are stored in ~/.config/veda/personas/<name>/AGENTS.md
 */

import { readdir } from 'fs/promises';
import { join } from 'path';
import { getPersonasDir, getPersonaDir } from '../util/paths';
import type { ReasoningLevel, AgentConfig, SandboxMode } from './config';
import { withSandboxNotice } from './sandbox';

export interface Persona {
  /** Persona name (directory name) */
  name: string;
  /** System prompt content */
  systemPrompt: string;
  /** Path to AGENTS.md file */
  path: string;
  /** Default reasoning level for this persona */
  defaultReasoning: ReasoningLevel;
}

/**
 * Default reasoning levels for built-in personas.
 * All personas use codex backend with gpt-5.2.
 */
const PERSONA_REASONING: Record<string, ReasoningLevel> = {
  'navigator-plan': 'high',
  'navigator-chat': 'medium',
  'reviewer': 'medium',
};

/**
 * Load a persona by name.
 */
export async function loadPersona(name: string, baseDir?: string): Promise<Persona> {
  const personaDir = getPersonaDir(name, baseDir);
  const agentsPath = join(personaDir, 'AGENTS.md');
  
  const file = Bun.file(agentsPath);
  if (!await file.exists()) {
    throw new Error(`Persona not found: ${name} (expected ${agentsPath})`);
  }
  
  const systemPrompt = await file.text();
  
  return {
    name,
    systemPrompt,
    path: agentsPath,
    defaultReasoning: PERSONA_REASONING[name] ?? 'medium',
  };
}

/**
 * List all available personas.
 */
export async function listPersonas(baseDir?: string): Promise<string[]> {
  const personasDir = getPersonasDir(baseDir);
  
  try {
    const entries = await readdir(personasDir, { withFileTypes: true });
    const personas: string[] = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Check if AGENTS.md exists
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

/**
 * Check if a persona exists.
 */
export async function personaExists(name: string, baseDir?: string): Promise<boolean> {
  const agentsPath = join(getPersonaDir(name, baseDir), 'AGENTS.md');
  return await Bun.file(agentsPath).exists();
}

export interface ResolveConfigOptions {
  /** Persona name */
  persona?: string;
  /** Model override */
  model?: string;
  /** Reasoning level override */
  reasoning?: ReasoningLevel;
  /** Sandbox mode */
  sandbox?: SandboxMode;
  /** Base config directory */
  baseDir?: string;
  /** Inline system prompt (overrides persona) */
  systemPrompt?: string;
}

/**
 * Resolve final agent configuration by merging persona defaults with overrides.
 */
export async function resolveAgentConfig(
  options: ResolveConfigOptions,
  defaults: { model: string; reasoning: ReasoningLevel; persona: string }
): Promise<AgentConfig> {
  const personaName = options.persona ?? defaults.persona;
  
  // Load persona if not using inline system prompt
  let systemPrompt: string;
  let systemPromptPath: string | undefined;
  let defaultReasoning: ReasoningLevel = defaults.reasoning;
  
  if (options.systemPrompt) {
    systemPrompt = options.systemPrompt;
  } else {
    const persona = await loadPersona(personaName, options.baseDir);
    systemPrompt = persona.systemPrompt;
    systemPromptPath = persona.path;
    defaultReasoning = persona.defaultReasoning;
  }
  
  return {
    model: options.model ?? defaults.model,
    reasoning: options.reasoning ?? defaultReasoning,
    sandbox: options.sandbox ?? 'read-only',
    systemPrompt: withSandboxNotice(systemPrompt),
    systemPromptPath,
  };
}
