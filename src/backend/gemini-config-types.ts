// Types and utilities for Gemini CLI configuration management

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Model generation enum for Gemini models
 */
export enum ModelGeneration {
  GEN_2_5 = 'GEN_2_5',
  GEN_3 = 'GEN_3',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Thinking configuration (discriminated union to prevent mixing)
 */
export type ThinkingConfig =
  | { gen: 'GEN_3'; thinkingLevel: 'LOW' | 'MEDIUM' | 'HIGH' }
  | { gen: 'GEN_2_5'; thinkingBudget: number };

/**
 * Gemini CLI settings.json schema (partial, relevant fields only)
 */
export interface GeminiSettingsSchema {
  modelConfigs?: {
    customAliases?: Record<string, ModelAlias>;
    overrides?: ModelOverride[];
    aliases?: Record<string, ModelAlias>;
  };
  // ... other sections (security, general, mcpServers, etc.)
}

export interface ModelAlias {
  extends?: string;
  modelConfig: {
    model?: string;
    generateContentConfig?: {
      temperature?: number;
      topP?: number;
      topK?: number;
      thinkingConfig?: {
        thinkingBudget?: number;
        thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
        includeThoughts?: boolean;
      };
      maxOutputTokens?: number;
      tools?: unknown[];
    };
  };
}

export interface ModelOverride {
  match: {
    model?: string;
    overrideScope?: string;
  };
  veda?: {
    overrideId: string;
    createdAt: number; // Unix timestamp ms
    reasoningLevel: string;
  };
  modelConfig?: {
    generateContentConfig?: {
      thinkingConfig?: ThinkingConfig;
    };
  };
}

/**
 * Veda-specific override entry
 */
export interface VedaOverride {
  match: {
    model: string;
    overrideScope: string;
  };
  veda: {
    overrideId: string;
    createdAt: number;
    reasoningLevel: string;
  };
  modelConfig: {
    generateContentConfig: {
      thinkingConfig: ThinkingConfig;
    };
  };
}

/**
 * Config manager state
 */
export interface ConfigManagerState {
  backupFilePath: string | null;
  overrideId: string | null;
  originalSettings: GeminiSettingsSchema | null;
  hasModifiedSettings: boolean;
}

/**
 * Config error types (defunctionalized)
 */
export type ConfigError =
  | { type: 'READ_ERROR'; message: string; cause?: Error }
  | { type: 'WRITE_ERROR'; message: string; cause?: Error }
  | { type: 'PARSE_ERROR'; message: string; cause?: Error }
  | { type: 'UNKNOWN_MODEL'; message: string; cause?: never }
  | { type: 'READ_ONLY_MODE'; message: string; sandbox: string; cause?: never }
  | { type: 'BACKUP_ERROR'; message: string; cause?: Error }
  | { type: 'RESTORE_ERROR'; message: string; cause?: Error }
  | { type: 'CLEANUP_ERROR'; message: string; cause?: Error };

// ============================================================================
// Model Generation Detection
// ============================================================================

/**
 * Detect Gemini model generation from model name
 */
export function detectModelGeneration(model: string): ModelGeneration {
  if (model.startsWith('gemini-3-')) {
    return ModelGeneration.GEN_3;
  }
  if (model.startsWith('gemini-2.5-') || model.startsWith('gemini-2-')) {
    return ModelGeneration.GEN_2_5;
  }
  return ModelGeneration.UNKNOWN;
}

// ============================================================================
// Reasoning Level Mapping
// ============================================================================

/**
 * Map veda reasoning level to Gemini 3.x thinkingLevel
 */
function mapToThinkingLevel(
  reasoning: ReasoningLevel
): 'LOW' | 'MEDIUM' | 'HIGH' {
  switch (reasoning) {
    case 'minimal':
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
    case 'xhigh':
      return 'HIGH';
  }
}

/**
 * Map veda reasoning level to Gemini 2.x thinkingBudget (tokens)
 */
function mapToThinkingBudget(reasoning: ReasoningLevel): number {
  switch (reasoning) {
    case 'minimal':
    case 'low':
      return 8192;
    case 'medium':
      return 16000;
    case 'high':
    case 'xhigh':
      return 32000;
  }
}

/**
 * Map veda reasoning level to Gemini thinking config (gen-dependent)
 */
export function mapReasoningToGeminiConfig(
  reasoning: ReasoningLevel,
  gen: ModelGeneration
): ThinkingConfig | null {
  if (gen === ModelGeneration.GEN_3) {
    return {
      gen: 'GEN_3',
      thinkingLevel: mapToThinkingLevel(reasoning),
    };
  }
  if (gen === ModelGeneration.GEN_2_5) {
    return {
      gen: 'GEN_2_5',
      thinkingBudget: mapToThinkingBudget(reasoning),
    };
  }
  return null;
}
