/**
 * Core Orchestration Primitives
 * 
 * These primitives form the foundation for all AI orchestration patterns:
 * - Simple prompts: Solver → Step
 * - Self-Consistency: Ensemble + Aggregator
 * - Chain-of-Verification: Verification
 * - Complex workflows: Pipeline
 */

import type { Backend, Message, UsageStats } from '../backend';

// Re-export Message for consumers that need it
export type { Message };

// ============================================================================
// Solver - A configured LLM endpoint with a role
// ============================================================================

export interface Solver {
  /** Unique identifier (e.g., "planner", "solver-1", "verifier") */
  readonly id: string;
  
  /** Underlying backend */
  readonly backend: Backend;
  
  /** Role-specific system prompt */
  readonly systemPrompt: string;
  
  /** Solver configuration */
  readonly config: SolverConfig;
  
  /**
   * Run a prompt through this solver.
   * Yields normalized Message events.
   */
  run(prompt: string, context?: string): AsyncIterable<Message>;
}

export interface SolverConfig {
  /** Model identifier */
  model?: string;
  /** Reasoning level */
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Sandbox mode */
  sandbox?: 'read-only' | 'workspace-write' | 'full';
  /** Working directory - important for read-only sandbox to access project files */
  cwd?: string;
}

// ============================================================================
// Step - Single LLM call with typed input/output
// ============================================================================

export interface Step<I, O> {
  /** Step name for logging/tracing */
  readonly name: string;
  
  /** Solver to use for this step */
  readonly solver: Solver;
  
  /**
   * Format input into a prompt string.
   */
  formatPrompt(input: I, context?: StepContext): string;
  
  /**
   * Parse output messages into typed result.
   */
  parseOutput(messages: Message[]): O;
  
  /**
   * Execute the step.
   */
  run(input: I, context?: StepContext): Promise<StepResult<O>>;
}

export interface StepContext {
  /** Original task/prompt that started the workflow */
  originalTask: string;
  /** Results from prior steps in the workflow */
  priorSteps: Array<{ name: string; output: unknown }>;
  /** Additional context (e.g., file selection) */
  additionalContext?: string;
}

export interface StepResult<O> {
  /** Parsed output */
  output: O;
  /** Usage statistics */
  usage: UsageStats;
  /** Session/thread ID for resume */
  sessionId: string;
  /** Raw messages from the solver */
  messages: Message[];
}

// ============================================================================
// Ensemble - Parallel solvers with aggregation
// ============================================================================

export interface Ensemble<I, O> {
  /** Ensemble name for logging/tracing */
  readonly name: string;
  
  /** Solvers to run in parallel */
  readonly solvers: Solver[];
  
  /** Strategy for combining outputs */
  readonly aggregator: Aggregator<O>;
  
  /**
   * Execute all solvers in parallel and aggregate results.
   */
  run(input: I, context?: StepContext): Promise<EnsembleResult<O>>;
}

export interface EnsembleResult<O> {
  /** The selected/merged output */
  selected: O;
  /** Agreement/confidence rate (0-1) */
  confidence: number;
  /** All individual outputs */
  candidates: O[];
  /** Conflicting outputs (if any) */
  conflicts?: string[];
  /** Combined usage statistics */
  usage: UsageStats;
}

// ============================================================================
// Aggregator - Strategy for combining multiple outputs
// ============================================================================

export interface Aggregator<O> {
  /** Aggregator name */
  readonly name: string;
  
  /**
   * Combine multiple outputs into one.
   */
  aggregate(outputs: O[], context?: StepContext): AggregatedOutput<O> | Promise<AggregatedOutput<O>>;
}

export interface AggregatedOutput<O> {
  /** Selected or merged output */
  selected: O;
  /** Confidence/agreement score (0-1) */
  confidence: number;
  /** Conflicting alternatives (if any) */
  conflicts?: string[];
}

// ============================================================================
// Verification - Task-aware output checking
// ============================================================================

export interface Verification {
  /** Verification type */
  readonly type: 'factual' | 'code' | 'reasoning';
  
  /** Solver for verification steps */
  readonly solver: Solver;
  
  /**
   * Generate verification checks from a draft output.
   */
  generateChecks(draft: string, context: StepContext): Promise<Check[]>;
  
  /**
   * Answer the generated checks.
   */
  answerChecks(checks: Check[]): Promise<CheckResult[]>;
  
  /**
   * Revise the draft based on check results.
   */
  revise(draft: string, results: CheckResult[]): Promise<RevisionResult>;
}

export interface Check {
  /** Unique check identifier */
  id: string;
  /** Question to verify */
  question: string;
  /** Specific claim being checked (optional) */
  targetClaim?: string;
}

export interface CheckResult {
  /** Check ID this result corresponds to */
  checkId: string;
  /** Answer to the verification question */
  answer: string;
  /** Whether the answer contradicts the draft */
  contradictsDraft: boolean;
  /** Confidence in this result (0-1) */
  confidence: number;
}

export interface RevisionResult {
  /** Revised output */
  revised: string;
  /** Summary of changes made */
  changes: string[];
  /** Unresolved conflicts */
  conflicts: string[];
  /** Whether the output was unchanged */
  unchanged: boolean;
}

// ============================================================================
// Pipeline - Compose stages with data flow
// ============================================================================

export interface Pipeline<I, O> {
  /** Pipeline name */
  readonly name: string;
  
  /** Pipeline stages */
  readonly stages: PipelineStage[];
  
  /**
   * Execute the pipeline.
   * Yields events as stages complete.
   */
  run(input: I): AsyncIterable<PipelineEvent<O>>;
}

export type PipelineStage =
  | StepStage
  | EnsembleStage
  | VerificationStage
  | BranchStage
  | LoopStage;

export interface StepStage {
  type: 'step';
  name: string;
  step: Step<unknown, unknown>;
}

export interface EnsembleStage {
  type: 'ensemble';
  name: string;
  ensemble: Ensemble<unknown, unknown>;
}

export interface VerificationStage {
  type: 'verification';
  name: string;
  verification: Verification;
}

export interface BranchStage {
  type: 'branch';
  name: string;
  /** Function to determine which branch to take */
  condition: (ctx: StepContext) => string;
  /** Map of branch names to stage sequences */
  branches: Record<string, PipelineStage[]>;
}

export interface LoopStage {
  type: 'loop';
  name: string;
  /** Maximum iterations */
  maxIterations: number;
  /** Termination condition */
  until: (ctx: StepContext) => boolean;
  /** Loop body stages */
  body: PipelineStage[];
}

// ============================================================================
// Pipeline Events
// ============================================================================

export type PipelineEvent<O> =
  | { type: 'stage_start'; stage: string; timestamp: number }
  | { type: 'stage_complete'; stage: string; output: unknown; usage: UsageStats; timestamp: number }
  | { type: 'message'; stage: string; content: string; timestamp: number }
  | { type: 'warning'; stage: string; content: string; timestamp: number }
  | { type: 'error'; stage: string; content: string; timestamp: number }
  | { type: 'complete'; output: O; totalUsage: UsageStats; timestamp: number };
