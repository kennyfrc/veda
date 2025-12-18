// Personas are stored in ~/.config/veda/personas/<name>/AGENTS.md

import { readdir } from 'fs/promises';
import { join } from 'path';
import { getPersonasDir, getPersonaDir } from '../util/paths';
import type { ReasoningLevel, AgentConfig, SandboxMode, GlobalConfig } from './config';
import { resolveModel, resolveReasoning } from './config';

export interface Persona {
  name: string;
  systemPrompt: string;
  path: string;
  defaultReasoning: ReasoningLevel;
}

const PERSONA_REASONING: Record<string, ReasoningLevel> = {
  'navigator-plan': 'high',
  'navigator-chat': 'medium',
  'reviewer': 'medium',
};

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
  backend?: string;           // Backend for model resolution
  baseDir?: string;
  systemPrompt?: string;
}

/** Merges persona defaults with overrides */
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
  
  // Resolve model and reasoning based on backend
  // Backend must be provided for proper resolution
  if (!options.backend) {
    throw new Error('Backend must be specified for agent config resolution');
  }
  
  const model = resolveModel({
    backend: options.backend,
    explicitModel: options.model,
    globalConfig,
  });
  
  // Reasoning precedence: explicit -r > persona default > backend config > backend built-in
  const reasoning = options.reasoning 
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
