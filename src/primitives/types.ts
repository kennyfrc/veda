// Core orchestration primitives for AI workflows.

import type { Backend, Message, UsageStats } from '../backend';

export type { Message };

export interface Solver {
  readonly id: string;
  readonly backend: Backend;
  readonly systemPrompt: string;
  readonly config: SolverConfig;
  run(prompt: string, context?: string): AsyncIterable<Message>;
}

export interface SolverConfig {
  model?: string;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'full';
  cwd?: string;
}

export interface Step<I, O> {
  readonly name: string;
  readonly solver: Solver;
  formatPrompt(input: I, context?: StepContext): string;
  parseOutput(messages: Message[]): O;
  run(input: I, context?: StepContext): Promise<StepResult<O>>;
}

export interface StepContext {
  originalTask: string;
  priorSteps: Array<{ name: string; output: unknown }>;
  additionalContext?: string;
}

export interface StepResult<O> {
  output: O;
  usage: UsageStats;
  sessionId: string;
  messages: Message[];
}

export interface Ensemble<I, O> {
  readonly name: string;
  readonly solvers: Solver[];
  readonly aggregator: Aggregator<O>;
  run(input: I, context?: StepContext): Promise<EnsembleResult<O>>;
}

export interface EnsembleResult<O> {
  selected: O;
  confidence: number;
  candidates: O[];
  conflicts?: string[];
  usage: UsageStats;
}

export interface Aggregator<O> {
  readonly name: string;
  aggregate(outputs: O[], context?: StepContext): AggregatedOutput<O> | Promise<AggregatedOutput<O>>;
}

export interface AggregatedOutput<O> {
  selected: O;
  confidence: number;
  conflicts?: string[];
}

export interface Verification {
  readonly type: 'factual' | 'code' | 'reasoning';
  readonly solver: Solver;
  generateChecks(draft: string, context: StepContext): Promise<GenerateChecksResult>;
  answerChecks(checks: Check[]): Promise<AnswerChecksResult>;
  revise(draft: string, results: CheckResult[]): Promise<RevisionResult>;
}

export interface GenerateChecksResult {
  checks: Check[];
  usage: UsageStats;
}

export interface AnswerChecksResult {
  results: CheckResult[];
  usage: UsageStats;
}

export interface Check {
  id: string;
  question: string;
  targetClaim?: string;
}

export interface CheckResult {
  checkId: string;
  answer: string;
  contradictsDraft: boolean;
  confidence: number;
}

export interface RevisionResult {
  revised: string;
  changes: string[];
  conflicts: string[];
  unchanged: boolean;
  usage: UsageStats;
}

export interface Pipeline<I, O> {
  readonly name: string;
  readonly stages: PipelineStage[];
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
  condition: (ctx: StepContext) => string;
  branches: Record<string, PipelineStage[]>;
}

export interface LoopStage {
  type: 'loop';
  name: string;
  maxIterations: number;
  until: (ctx: StepContext) => boolean;
  body: PipelineStage[];
}

export type PipelineEvent<O> =
  | { type: 'stage_start'; stage: string; timestamp: number }
  | { type: 'stage_complete'; stage: string; output: unknown; usage: UsageStats; timestamp: number }
  | { type: 'message'; stage: string; content: string; timestamp: number }
  | { type: 'warning'; stage: string; content: string; timestamp: number }
  | { type: 'error'; stage: string; content: string; timestamp: number }
  | { type: 'complete'; output: O; totalUsage: UsageStats; timestamp: number };
