/**
 * Agent configuration types and loading.
 */

import { getConfigPath } from '../util/paths';

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
/** Sandbox modes (user-facing names) */
export type SandboxMode = 'read-only' | 'workspace-write' | 'full';

/** Map user-facing sandbox mode to codex CLI value */
export function toCodexSandbox(mode: SandboxMode): string {
  switch (mode) {
    case 'read-only': return 'read-only';
    case 'workspace-write': return 'workspace-write';
    case 'full': return 'danger-full-access';
  }
}

export interface AgentConfig {
  /** Model identifier */
  model: string;
  /** Reasoning level for chain-of-thought */
  reasoning: ReasoningLevel;
  /** Sandbox mode for file access */
  sandbox: SandboxMode;
  /** System prompt content */
  systemPrompt: string;
  /** Path to system prompt file (if loaded from file) */
  systemPromptPath?: string;
}

export interface GlobalConfig {
  /** Default model */
  model?: string;
  /** Default reasoning level */
  reasoning?: ReasoningLevel;
  /** Default persona */
  persona?: string;
  /** Default backend */
  backend?: string;
  /** Default session */
  session?: string;
}

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_REASONING: ReasoningLevel = 'medium';
const DEFAULT_PERSONA = 'navigator-chat';
const DEFAULT_BACKEND = 'codex';

/**
 * Parse a shell-style config file (KEY="value" format).
 */
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

/**
 * Load global config from ~/.config/veda/config
 */
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

/**
 * Get default values with global config overlay.
 */
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

/**
 * Validate reasoning level.
 */
export function isValidReasoning(level: string): level is ReasoningLevel {
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(level);
}

/**
 * Validate sandbox mode.
 */
export function isValidSandbox(mode: string): mode is SandboxMode {
  return ['read-only', 'workspace-write', 'full'].includes(mode);
}

/** Sandbox mode aliases for CLI input */
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
