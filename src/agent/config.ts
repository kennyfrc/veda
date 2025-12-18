import { getConfigPath } from '../util/paths';
import { getBackendDefaultModel } from '../backend/defaults';
import { resolveModelAlias } from './model-aliases';

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
  backendModels?: Record<string, string>;  // Per-backend model overrides
}

const DEFAULT_MODEL = 'gpt-5.2';
const DEFAULT_REASONING: ReasoningLevel = 'medium';
const DEFAULT_PERSONA = 'navigator-chat';
const DEFAULT_BACKEND = 'codex';

/** Parses shell-style config (KEY="value" or KEY=value) */
export function parseConfigFile(content: string): GlobalConfig {
  const config: GlobalConfig = {};
  const backendModels: Record<string, string> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // Parse KEY="value" or KEY=value
    const match = trimmed.match(/^([A-Z_]+)=["']?([^"']+)["']?$/);
    if (match) {
      const [, key, value] = match;
      
      // Per-backend model keys: CLAUDE_CODE_MODEL, CODEX_MODEL, GEMINI_CLI_MODEL
      const backendModelMatch = key.match(/^(.+)_MODEL$/);
      if (backendModelMatch) {
        const prefix = backendModelMatch[1];
        // Skip generic MODEL/DEFAULT_MODEL - those are handled below
        if (prefix !== '' && prefix !== 'DEFAULT') {
          // Convert CLAUDE_CODE -> claude-code, GEMINI_CLI -> gemini-cli
          const backendId = prefix.toLowerCase().replace(/_/g, '-');
          backendModels[backendId] = value;
          continue;
        }
      }
      
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
  
  if (Object.keys(backendModels).length > 0) {
    config.backendModels = backendModels;
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

// ============================================================================
// Model Resolution
// ============================================================================

export interface ResolveModelOptions {
  backend: string;
  explicitModel?: string;      // -m flag
  globalConfig?: GlobalConfig;
}

/**
 * Resolve model for a backend. Precedence:
 * 1. Explicit -m flag
 * 2. User config per-backend (e.g., CLAUDE_CODE_MODEL in config)
 * 3. Built-in default per backend
 * 4. Global MODEL config (legacy fallback)
 */
export function resolveModel(options: ResolveModelOptions): string | undefined {
  const { backend, explicitModel, globalConfig } = options;
  
  // 1. Explicit override wins
  if (explicitModel) {
    return explicitModel;
  }
  
  // 2. User config per-backend
  const userOverride = globalConfig?.backendModels?.[backend];
  if (userOverride) {
    return userOverride;
  }
  
  // 3. Built-in defaults per backend
  const builtinDefault = getBackendDefaultModel(backend);
  if (builtinDefault) {
    return builtinDefault;
  }
  
  // 4. Global MODEL config (legacy fallback for unknown backends)
  return globalConfig?.model;
}

// ============================================================================
// Backend + Model Resolution (with alias support)
// ============================================================================

export interface ResolveBackendModelOptions {
  /** Explicit backend from -b flag */
  explicitBackend?: string;
  /** Explicit model from -m flag (may be an alias) */
  explicitModel?: string;
  /** Fallback backend (e.g., defaults.backend or stage default) */
  fallbackBackend?: string;
  /** Fallback model (e.g., legacy -m for stage fallback) */
  fallbackModel?: string;
  /** Global config for per-backend overrides */
  globalConfig?: GlobalConfig;
}

export interface ResolvedBackendModel {
  /** Resolved backend name */
  backend: string;
  /** Resolved model (may be undefined for unknown backends with no config) */
  model?: string;
  /** Whether backend was inferred from a model alias */
  fromAlias: boolean;
}

/**
 * Resolve both backend and model together, with alias support.
 * 
 * Resolution algorithm:
 * 1. If explicitBackend is set → NO alias mapping (respect explicit backend choice)
 * 2. Else if explicitModel is a known alias → adopt alias's backend + model
 * 3. Determine final backend: explicitBackend ?? aliasBackend ?? fallbackBackend
 * 4. Resolve model using existing 4-level precedence via resolveModel()
 * 
 * This enables `-m opus` (without -b) to auto-select claude-code backend.
 */
export function resolveBackendModel(opts: ResolveBackendModelOptions): ResolvedBackendModel {
  const { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig } = opts;
  
  let backend: string;
  let modelForResolution: string | undefined;
  let fromAlias = false;
  
  // Step 1 & 2: Determine if alias applies
  if (explicitBackend) {
    // Explicit backend provided - no alias mapping
    // Treat explicitModel as a literal model name
    backend = explicitBackend;
    modelForResolution = explicitModel ?? fallbackModel;
  } else if (explicitModel) {
    // No explicit backend - check if model is an alias
    const aliasTarget = resolveModelAlias(explicitModel);
    if (aliasTarget) {
      // Alias matched - use alias's backend and model
      backend = aliasTarget.backend;
      modelForResolution = aliasTarget.model;
      fromAlias = true;
    } else {
      // Not an alias - use fallback backend with explicit model
      backend = fallbackBackend ?? 'codex';
      modelForResolution = explicitModel;
    }
  } else if (fallbackModel) {
    // No explicit model but have fallback - check if fallback is an alias
    const aliasTarget = resolveModelAlias(fallbackModel);
    if (aliasTarget && !fallbackBackend) {
      // Fallback model is an alias and no backend specified
      backend = aliasTarget.backend;
      modelForResolution = aliasTarget.model;
      fromAlias = true;
    } else {
      // Use fallback backend with fallback model
      backend = fallbackBackend ?? 'codex';
      modelForResolution = fallbackModel;
    }
  } else {
    // No model specified at all - use fallback backend
    backend = fallbackBackend ?? 'codex';
    modelForResolution = undefined;
  }
  
  // Step 4: Resolve final model using 4-level precedence
  const model = resolveModel({
    backend,
    explicitModel: modelForResolution,
    globalConfig,
  });
  
  return { backend, model, fromAlias };
}
