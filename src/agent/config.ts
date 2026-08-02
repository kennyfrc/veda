import { getConfigPath } from '../util/paths';
import {
  getBackendDefaultModel,
  getBackendDefaultModelForStage,
  getBackendDefaultReasoning,
  type ModelStage,
} from '../backend/defaults';
import { resolveBackendModelExtracted, tryResolveAliasTarget } from './config-extract';
import { parseModelAliases, type UserAliases } from './model-aliases';

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
  /** Tool allowlist. `[]` means no tools (the advisory default). `undefined`
   *  means the backend's full toolset is granted (the worker's `tools: all`).
   *  A non-empty list is an explicit allowlist. */
  tools?: string[];
  systemPrompt: string;
  systemPromptPath?: string;
}

export interface DeepModeConfig {
  distributeSolvers?: boolean;
  solverBackends?: string[];
  /** Listed mode: one solver per entry (alias or model ID); uniform prompt unless --modules zipped. */
  solverModels?: string[];
  solverReasoning?: ReasoningLevel;
  judgeBackend?: string;
  judgeModel?: string;
  judgeReasoning?: ReasoningLevel;
  verifierBackend?: string;
  verifierModel?: string;
  verifierReasoning?: ReasoningLevel;
  revisionBackend?: string;
  revisionModel?: string;
  revisionReasoning?: ReasoningLevel;
}

export interface GlobalConfig {
  persona?: string;
  backend?: string;
  model?: string;
  session?: string;
  notify?: boolean;
  notifySound?: string;
  backendModels?: Record<string, string>;
  backendReasoning?: Record<string, ReasoningLevel>;
  deep?: DeepModeConfig;
  defaultReasoning?: ReasoningLevel;
  defaultSandbox?: SandboxMode;
  /** User-defined model aliases (MODEL_ALIASES). Override the built-in table. */
  modelAliases?: UserAliases;
}

const DEFAULT_PERSONA = 'navigator-chat';
const DEFAULT_BACKEND = 'codex';

export function parseConfigFile(content: string): GlobalConfig {
  const config: GlobalConfig = {};
  const backendModels: Record<string, string> = {};
  const backendReasoning: Record<string, ReasoningLevel> = {};
  const deep: DeepModeConfig = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    const match = trimmed.match(/^([A-Z_]+)=["']?([^"']+)["']?$/);
    if (match) {
      const [, key, value] = match;
      
      // Deep mode config (DEEP_* keys)
      if (key.startsWith('DEEP_')) {
        switch (key) {
          case 'DEEP_DISTRIBUTE_SOLVERS':
            deep.distributeSolvers = value.toLowerCase() === 'true';
            break;
          case 'DEEP_SOLVER_BACKENDS':
            deep.solverBackends = value.split(',').map(s => s.trim()).filter(s => s);
            break;
          case 'DEEP_SOLVER_MODELS':
            deep.solverModels = value.split(',').map(s => s.trim()).filter(s => s);
            break;
          case 'DEEP_SOLVER_REASONING':
            if (isValidReasoning(value)) deep.solverReasoning = value;
            break;
          case 'DEEP_JUDGE_BACKEND':
            deep.judgeBackend = value;
            break;
          case 'DEEP_JUDGE_MODEL':
            deep.judgeModel = value;
            break;
          case 'DEEP_JUDGE_REASONING':
            if (isValidReasoning(value)) deep.judgeReasoning = value;
            break;
          case 'DEEP_VERIFIER_BACKEND':
            deep.verifierBackend = value;
            break;
          case 'DEEP_VERIFIER_MODEL':
            deep.verifierModel = value;
            break;
          case 'DEEP_VERIFIER_REASONING':
            if (isValidReasoning(value)) deep.verifierReasoning = value;
            break;
          case 'DEEP_REVISION_BACKEND':
            deep.revisionBackend = value;
            break;
          case 'DEEP_REVISION_MODEL':
            deep.revisionModel = value;
            break;
          case 'DEEP_REVISION_REASONING':
            if (isValidReasoning(value)) deep.revisionReasoning = value;
            break;
        }
        continue;
      }
      
      // Per-backend model override (e.g., CODEX_MODEL)
      const backendModelMatch = key.match(/^(.+)_MODEL$/);
      if (backendModelMatch) {
        const prefix = backendModelMatch[1];
        const backendId = prefix.toLowerCase().replace(/_/g, '-');
        backendModels[backendId] = value;
        continue;
      }
      
      // Per-backend reasoning override (e.g., CODEX_REASONING)
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
        case 'MODEL_ALIASES':
          // User-defined aliases (name=backend/model[:reasoning], comma-separated).
          config.modelAliases = parseModelAliases(value);
          break;
        case 'SESSION':
          config.session = value;
          break;
        case 'DEFAULT_SANDBOX': {
          const mode = parseSandboxMode(value);
          if (mode) config.defaultSandbox = mode;
          break;
        }
        case 'NOTIFY': {
          const lval = value.toLowerCase();
          if (lval === 'true') config.notify = true;
          if (lval === 'false') config.notify = false;
          break;
        }
        case 'NOTIFY_SOUND':
          config.notifySound = value;
          break;
      }
    }
  }
  
  if (Object.keys(backendModels).length > 0) {
    config.backendModels = backendModels;
  }
  
  if (Object.keys(backendReasoning).length > 0) {
    config.backendReasoning = backendReasoning;
  }
  
  if (Object.keys(deep).length > 0) {
    config.deep = deep;
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
  return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level);
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
    const alias = tryResolveAliasTarget(globalConfig.model, globalConfig.modelAliases);
    if (!alias || alias.backend === backend) {
      return globalConfig.model;
    }
  }

  return getBackendDefaultModel(backend);
}

export interface ResolveModelForStageOptions {
  backend: string;
  stage: ModelStage;
  explicitModel?: string;
  globalConfig?: GlobalConfig;
}

/**
 * Stage-aware model resolution.
 *
 * Same precedence as `resolveModel()`, but the final built-in default can vary by stage.
 */
export function resolveModelForStage(options: ResolveModelForStageOptions): string | undefined {
  const { backend, stage, explicitModel, globalConfig } = options;

  if (explicitModel) return explicitModel;

  const userOverride = globalConfig?.backendModels?.[backend];
  if (userOverride) return userOverride;

  if (globalConfig?.model) {
    const alias = tryResolveAliasTarget(globalConfig.model, globalConfig.modelAliases);
    if (!alias || alias.backend === backend) {
      return globalConfig.model;
    }
  }

  return getBackendDefaultModelForStage(backend, stage);
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

export type ModelSource =
  | { kind: 'explicit' }
  | { kind: 'alias'; aliasName: string }
  | { kind: 'prefix' }
  | { kind: 'fallback' }
  | { kind: 'default' };

export interface ResolvedBackendModel {
  backend: string;
  model?: string;
  source: ModelSource;
  /** Reasoning level from alias, if the alias specified one. */
  aliasReasoning?: ReasoningLevel;
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

  return resolveBackendModelExtracted(
    { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig, modelAliases: globalConfig?.modelAliases },
    (backend, model) => resolveModel({ backend, explicitModel: model, globalConfig })
  );
}

export function resolveBackendModelForStage(
  stage: ModelStage,
  opts: ResolveBackendModelOptions
): ResolvedBackendModel {
  const { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig } = opts;

  return resolveBackendModelExtracted(
    { explicitBackend, explicitModel, fallbackBackend, fallbackModel, globalConfig, modelAliases: globalConfig?.modelAliases },
    (backend, model) => resolveModelForStage({ backend, stage, explicitModel: model, globalConfig })
  );
}
