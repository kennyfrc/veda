/**
 * CLI Input Types - Discriminated unions for type-safe command handling.
 * 
 * Design principle: "Parse, don't validate"
 * These types make impossible states unrepresentable.
 */

// =============================================================================
// Command Discriminated Union
// =============================================================================

export type VedaInput =
  | { command: 'prompt'; mode: 'simple'; config: SimpleConfig }
  | { command: 'prompt'; mode: 'deep'; config: DeepConfig }
  | { command: 'resume'; config: ResumeConfig }
  | { command: 'sel'; subcommand: SelSubcommand; args: string[]; session: string }
  | { command: 'stats'; config: StatsConfig }
  | { command: 'init' }
  | { command: 'personas'; subcommand?: string }
  | { command: 'help' }
  | { command: 'version' }
  | { command: 'dry-run'; resolved: DryRunOutput }

export type SelSubcommand = 'add' | 'rm' | 'ls' | 'clear' | 'tokens';

// =============================================================================
// Simple Mode Config
// =============================================================================

export interface SimpleConfig {
  session: string;
  prompt: string;
  backend: string;
  model: string;
  persona?: string;
  reasoning?: ReasoningLevel;
  sandbox?: SandboxMode;
  context: ContextConfig;
  output: OutputConfig;
  notify: boolean;
}

// =============================================================================
// Deep Mode Config
// =============================================================================

export interface DeepConfig {
  session: string;
  prompt: string;
  k: number;  // Always 1-12, validated at parse time
  categories?: string[];  // Filter for module categories
  modules?: string[];     // Explicit module IDs (overrides categories)
  context: ContextConfig;
  output: OutputConfig;
  verify: VerifyConfig;
  stages: StageConfigs;
  trace?: string;
  notify: boolean;
}

/**
 * Verification config as discriminated union.
 * Prevents --no-verify + --force-verify at type level.
 */
export type VerifyConfig =
  | { enabled: false }
  | { enabled: true; forced: boolean }

export interface StageConfigs {
  solver: SolverConfig;
  judge: StageConfig;
  verifier: StageConfig;
  revision: StageConfig;
}

/**
 * Solver config as discriminated union.
 * Prevents --solver-backend + --distribute-solvers at type level.
 */
export type SolverConfig =
  | { mode: 'fixed'; backend: string; model: string; reasoning?: ReasoningLevel }
  | { mode: 'distributed'; backends: string[]; modelPerBackend: Map<string, string>; reasoning?: ReasoningLevel }

export interface StageConfig {
  backend: string;
  model: string;
  reasoning?: ReasoningLevel;
}

// =============================================================================
// Resume Config
// =============================================================================

export interface ResumeConfig {
  session: string;
  prompt?: string;
  model?: string;
  persona?: string;
  reasoning?: ReasoningLevel;
  sandbox?: SandboxMode;
  output: OutputConfig;
  notify: boolean;
}

// =============================================================================
// Stats Config
// =============================================================================

export type StatsGroupBy = 'module' | 'category' | 'model' | 'judge';

export interface StatsConfig {
  groupBy: StatsGroupBy;
  limit: number;
  json: boolean;
}

// =============================================================================
// Shared Config Types
// =============================================================================

export interface ContextConfig {
  useSelection: boolean;  // Inverse of --no-sel
  adhocFiles: string[];   // -f flags
}

export type OutputConfig =
  | { format: 'text' }
  | { format: 'json' }
  | { format: 'file'; path: string }

export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type SandboxMode = 'read-only' | 'workspace-write' | 'full';

// =============================================================================
// Resolution Metadata
// =============================================================================

export type ResolutionSource = 'explicit' | 'alias' | 'prefix' | 'config' | 'default';

export interface ResolvedBackendModel {
  backend: string;
  model: string;
  source: ResolutionSource;
}

// =============================================================================
// Dry Run Output
// =============================================================================

export interface DryRunOutput {
  command: string;
  mode?: string;
  session: string;
  backend: ResolvedBackendModel;
  stages?: {
    solver: { mode: string; backends: string[]; models: Record<string, string> };
    judge: ResolvedBackendModel;
    verifier: ResolvedBackendModel;
    revision: ResolvedBackendModel;
  };
  flags: Record<string, unknown>;
}

// =============================================================================
// Raw Flags (intermediate parsing artifact)
// =============================================================================

/**
 * Raw flags from argv tokenization.
 * This is an internal artifact, not the public API.
 */
export interface RawFlags {
  // Session & Identity
  session?: string;
  
  // Backend/Model
  backend?: string;
  model?: string;
  
  // Persona & Behavior
  persona?: string;
  reasoning?: string;
  sandbox?: string;
  
  // Context
  files: string[];
  noSel: boolean;
  
  // Output
  output?: string;
  json: boolean;
  
  // Notifications
  notify?: boolean;
  
  // Deep mode flags
  deep: boolean;
  k?: number;
  categories?: string[];
  modules?: string[];
  noVerify: boolean;
  forceVerify: boolean;
  trace?: string;
  
  // Deep mode per-stage overrides
  solverBackend?: string;
  solverModel?: string;
  judgeBackend?: string;
  judgeModel?: string;
  verifierBackend?: string;
  verifierModel?: string;
  revisionBackend?: string;
  revisionModel?: string;
  
  // Deep mode per-stage reasoning overrides
  solverReasoning?: string;
  judgeReasoning?: string;
  verifierReasoning?: string;
  revisionReasoning?: string;
  
  // Deep mode distribution
  distributeSolvers?: boolean;  // undefined = not set by CLI (use config)
  solverBackends?: string[];
  
  // Stats command options
  statsModule: boolean;
  statsCategory: boolean;
  statsModel: boolean;
  statsJudge: boolean;
  limit?: number;

  // Meta
  help: boolean;
  version: boolean;
  dryRun: boolean;
}

export interface ParsedPositionals {
  command: string;
  subcommand?: string;
  args: string[];
  prompt?: string;
}

// =============================================================================
// Command Classification
// =============================================================================

export type CommandType =
  | { type: 'prompt'; mode: 'simple' }
  | { type: 'prompt'; mode: 'deep' }
  | { type: 'resume' }
  | { type: 'sel'; subcommand: SelSubcommand }
  | { type: 'init' }
  | { type: 'personas' }
  | { type: 'help' }
  | { type: 'version' }

// =============================================================================
// Validation Errors
// =============================================================================

export class CliValidationError extends Error {
  constructor(
    message: string,
    public readonly code: CliErrorCode,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'CliValidationError';
  }
}

export type CliErrorCode =
  | 'FLAG_REQUIRES_VALUE'
  | 'INVALID_SESSION_ID'
  | 'FLAG_NOT_APPLICABLE'
  | 'MUTUALLY_EXCLUSIVE_FLAGS'
  | 'ALIAS_BACKEND_MISMATCH'
  | 'UNKNOWN_MODEL'
  | 'INVALID_K_VALUE'
  | 'UNKNOWN_COMMAND'
  | 'MISSING_PROMPT'
  | 'UNKNOWN_FLAG'
  | 'AMBIGUOUS_PROMPT';
