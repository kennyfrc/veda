/**
 * Primitives module exports.
 */

// Core types
export type {
  Solver,
  SolverConfig,
  Step,
  StepContext,
  StepResult,
  Ensemble,
  EnsembleResult,
  Aggregator,
  AggregatedOutput,
  Verification,
  Check,
  CheckResult,
  RevisionResult,
  Pipeline,
  PipelineStage,
  StepStage,
  EnsembleStage,
  VerificationStage,
  BranchStage,
  LoopStage,
  PipelineEvent,
} from './types';

// Built-in aggregators
export {
  MajorityVote,
  FirstSuccess,
  Longest,
  createJudgeAggregator,
  createMergeAggregator,
} from './aggregators';

// Factory functions
export {
  createSolver,
  createSolverPool,
  type CreateSolverOptions,
  type CreateSolverPoolOptions,
} from './solver';

export {
  createStep,
  createTextStep,
  combineUsage,
  type CreateStepOptions,
} from './step';

export {
  createEnsemble,
  createStringEnsemble,
  type CreateEnsembleOptions,
} from './ensemble';

export {
  createVerification,
  type CreateVerificationOptions,
} from './verification';

export {
  createPipeline,
  type CreatePipelineOptions,
} from './pipeline';
