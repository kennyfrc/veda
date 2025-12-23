import { getConfigPath } from '../util/paths';
import { getBackendDefaultModel, getBackendDefaultReasoning } from '../backend/defaults';
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
  persona?: string;
  backend?: string;
  model?: string;
  session?: string;
  notify?: boolean;
  backendModels?: Record<string, string>;      // Per-backend model: CODEX_MODEL, CLAUDE_CODE_MODEL, etc.
  backendReasoning?: Record<string, ReasoningLevel>;  // Per-backend reasoning: CODEX_REASONING, etc.
}

const DEFAULT_PERSONA = 'navigator-chat';
const DEFAULT_BACKEND = 'codex';

/** Parses shell-style config (KEY="value" or KEY=value) */
export function parseConfigFile(content: string): GlobalConfig {
  const config: GlobalConfig = {};
  const backendModels: Record<string, string> = {};
  const backendReasoning: Record<string, ReasoningLevel> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    const match = trimmed.match(/^([A-Z_]+)=["']?([^"']+)["']?$/);
    if (match) {
      const [, key, value] = match;
      
      const backendModelMatch = key.match(/^(.+)_MODEL$/);
      if (backendModelMatch) {
        const prefix = backendModelMatch[1];
        // CLAUDE_CODE -> claude-code
        const backendId = prefix.toLowerCase().replace(/_/g, '-');
        backendModels[backendId] = value;
        continue;
      }
      
      const backendReasoningMatch = key.match(/^(.+)_REASONING$/);
      if (backendReasoningMatch) {
        const prefix = backendReasoningMatch[1];
        const backendId = prefix.toLowerCase().replace(/_/g, '-');
        if (isValidReasoning(value)) {
          backendReasoning[backendId] = value;
        }
        continue;
      }
      
      switch (key) {
        case 'PERSONA':
          config.persona = value;
          break;
        case 'BACKEND':
          config.backend = value;
          break;
        case 'MODEL':
          config.model = value;
          break;
        case 'SESSION':
          config.session = value;
          break;
        case 'NOTIFY': {
          const lval = value.toLowerCase();
          if (lval === 'true') config.notify = true;
          if (lval === 'false') config.notify = false;
          break;
        }
      }
    }
  }
  
  if (Object.keys(backendModels).length > 0) {
    config.backendModels = backendModels;
  }
  
  if (Object.keys(backendReasoning).length > 0) {
    config.backendReasoning = backendReasoning;
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
  persona: string;
  backend: string;
}> {
  const globalConfig = await loadGlobalConfig(baseDir);
  
  return {
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

export interface ResolveModelOptions {
  backend: string;
  explicitModel?: string;
  globalConfig?: GlobalConfig;
}

export function resolveModel(options: ResolveModelOptions): string | undefined {
  const { backend, explicitModel, globalConfig } = options;
  
  if (explicitModel) return explicitModel;
  
  const userOverride = globalConfig?.backendModels?.[backend];
  if (userOverride) return userOverride;

  if (globalConfig?.model) {
    const alias = resolveModelAlias(globalConfig.model);
    // If it's an alias, only use it if it matches the current backend.
    // If it's not an alias, we treat it as a literal model name for the current backend.
    if (!alias || alias.backend === backend) {
      return globalConfig.model;
    }
  }
  
  return getBackendDefaultModel(backend);
}

export interface ResolveReasoningOptions {
  backend: string;
  explicitReasoning?: ReasoningLevel;
  globalConfig?: GlobalConfig;
}

export function resolveReasoning(options: ResolveReasoningOptions): ReasoningLevel {
  const { backend, explicitReasoning, globalConfig } = options;
  
  if (explicitReasoning) return explicitReasoning;
  
  const userOverride = globalConfig?.backendReasoning?.[backend];
  if (userOverride) return userOverride;
  
  return getBackendDefaultReasoning(backend);
}

export interface ResolvedBackendModel {
  backend: string;
  model?: string;
  fromAlias: boolean;
}

/**
 * Resolve both backend and model together, with alias support.
 * Enables `-m opus` (without -b) to auto-select claude-code backend.
 */
export interface ResolveBackendModelOptions {
  explicitBackend?: string;
  explicitModel?: string;
  fallbackBackend?: string;
  fallbackModel?: string;
  globalConfig?: GlobalConfig;
}

export function resolveBackendModel(opts: ResolveBackendModelOptions): ResolvedBackendModel {
  const { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig } = opts;
  
  let backend: string;
  let modelForResolution: string | undefined;
  let fromAlias = false;

  // Potential model to use for resolution if nothing else is provided
  const preferredModel = explicitModel ?? fallbackModel ?? globalConfig?.model;
  
  // Try to resolve alias if model is provided
  const aliasTarget = preferredModel ? resolveModelAlias(preferredModel) : undefined;

  if (explicitBackend) {
    // Explicit backend provided
    backend = explicitBackend;
    
    if (aliasTarget && aliasTarget.backend === explicitBackend) {
      // Model is an alias for this specific backend
      modelForResolution = aliasTarget.model;
      fromAlias = true;
    } else {
      // Treat preferredModel as a literal model name for this backend
      modelForResolution = preferredModel;
    }
  } else if (explicitModel) {
    // No explicit backend - check if model is an alias
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
  } else if (globalConfig?.model) {
    // Use global config model as fallback
    if (aliasTarget && !fallbackBackend) {
      backend = aliasTarget.backend;
      modelForResolution = aliasTarget.model;
      fromAlias = true;
    } else {
      backend = fallbackBackend ?? 'codex';
      modelForResolution = globalConfig.model;
    }
  } else {
    // No model specified at all - use fallback backend
    backend = fallbackBackend ?? 'codex';
    modelForResolution = undefined;
  }
  
  // Step 4: Resolve final model using precedence logic in resolveModel
  const model = resolveModel({
    backend,
    explicitModel: modelForResolution,
    globalConfig,
  });
  
  return { backend, model, fromAlias };
}
