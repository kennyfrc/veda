import { getConfigPath } from '../util/paths';

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type SandboxMode = 'read-only' | 'workspace-write' | 'full';

export function toCodexSandbox(mode: SandboxMode): string {
  switch (mode) {
    case 'read-only': return 'read-only';
    case 'workspace-write': return 'workspace-write';
    case 'full': return 'danger-full-access';
  }
}

export interface AgentConfig {
  model: string;
  reasoning: ReasoningLevel;
  sandbox: SandboxMode;
  systemPrompt: string;
  systemPromptPath?: string;
}

export interface GlobalConfig {
  model?: string;
  reasoning?: ReasoningLevel;
  persona?: string;
  backend?: string;
  session?: string;
}

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_REASONING: ReasoningLevel = 'medium';
const DEFAULT_PERSONA = 'navigator-chat';
const DEFAULT_BACKEND = 'codex';

/** Parses shell-style config (KEY="value" or KEY=value) */
export function parseConfigFile(content: string): GlobalConfig {
  const config: GlobalConfig = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Parse KEY="value" or KEY=value
    const match = trimmed.match(/^([A-Z_]+)=["']?([^"']+)["']?$/);
    if (match) {
      const [, key, value] = match;
      switch (key) {
        case 'MODEL':
        case 'DEFAULT_MODEL':
          config.model = value;
          break;
        case 'REASONING':
        case 'DEFAULT_REASONING':
          config.reasoning = value as ReasoningLevel;
          break;
        case 'PERSONA':
        case 'DEFAULT_PERSONA':
          config.persona = value;
          break;
        case 'BACKEND':
        case 'DEFAULT_BACKEND':
          config.backend = value;
          break;
        case 'SESSION':
        case 'DEFAULT_SESSION':
          config.session = value;
          break;
      }
    }
  }
  
  return config;
}

export async function loadGlobalConfig(baseDir?: string): Promise<GlobalConfig> {
  const configPath = getConfigPath(baseDir);
  
  try {
    const file = Bun.file(configPath);
    if (!await file.exists()) {
      return {};
    }
    const content = await file.text();
    return parseConfigFile(content);
  } catch {
    return {};
  }
}

export async function getDefaults(baseDir?: string): Promise<{
  model: string;
  reasoning: ReasoningLevel;
  persona: string;
  backend: string;
}> {
  const globalConfig = await loadGlobalConfig(baseDir);
  
  return {
    model: globalConfig.model ?? DEFAULT_MODEL,
    reasoning: globalConfig.reasoning ?? DEFAULT_REASONING,
    persona: globalConfig.persona ?? DEFAULT_PERSONA,
    backend: globalConfig.backend ?? DEFAULT_BACKEND,
  };
}

export function isValidReasoning(level: string): level is ReasoningLevel {
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(level);
}

export function isValidSandbox(mode: string): mode is SandboxMode {
  return ['read-only', 'workspace-write', 'full'].includes(mode);
}

export function parseSandboxMode(input: string): SandboxMode | undefined {
  switch (input.toLowerCase()) {
    case 'read-only':
    case 'readonly':
      return 'read-only';
    case 'workspace-write':
    case 'write':
      return 'workspace-write';
    case 'full':
    case 'danger-full-access':
      return 'full';
    default:
      return undefined;
  }
}
