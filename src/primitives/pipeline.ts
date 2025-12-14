/**
 * Pipeline implementation - Compose stages with data flow.
 */

import type { UsageStats } from '../backend';
import type {
  Pipeline,
  PipelineStage,
  PipelineEvent,
  StepContext,
  Step,
  Ensemble,
  Verification,
} from './types';
import { combineUsage } from './step';

export interface CreatePipelineOptions<I, O> {
  /** Pipeline name */
  name: string;
  /** Pipeline stages */
  stages: PipelineStage[];
}

/**
 * Create a pipeline instance.
 */
export function createPipeline<I, O>(options: CreatePipelineOptions<I, O>): Pipeline<I, O> {
  const { name, stages } = options;
  
  return {
    name,
    stages,
    
    async *run(input: I): AsyncIterable<PipelineEvent<O>> {
      const context: StepContext = {
        originalTask: String(input),
        priorSteps: [],
      };
      
      const usages: UsageStats[] = [];
      let currentOutput: unknown = input;
      
      for (const stage of stages) {
        const result = yield* executeStage(stage, currentOutput, context);
        
        if (result.error) {
          yield {
            type: 'error',
            stage: getStateName(stage),
            content: result.error,
            timestamp: Date.now(),
          };
          break;
        }
        
        currentOutput = result.output;
        if (result.usage) {
          usages.push(result.usage);
        }
        
        // Add to prior steps
        context.priorSteps.push({
          name: getStateName(stage),
          output: result.output,
        });
      }
      
      yield {
        type: 'complete',
        output: currentOutput as O,
        totalUsage: combineUsage(usages),
        timestamp: Date.now(),
      };
    },
  };
}

interface StageResult {
  output: unknown;
  usage?: UsageStats;
  error?: string;
}

async function* executeStage(
  stage: PipelineStage,
  input: unknown,
  context: StepContext
): AsyncGenerator<PipelineEvent<unknown>, StageResult> {
  const stageName = getStateName(stage);
  
  yield {
    type: 'stage_start',
    stage: stageName,
    timestamp: Date.now(),
  };
  
  try {
    let result: StageResult;
    
    switch (stage.type) {
      case 'step':
        result = await executeStep(stage.step, input, context);
        break;
      
      case 'ensemble':
        result = await executeEnsemble(stage.ensemble, input, context);
        break;
      
      case 'verification':
        result = await executeVerification(stage.verification, input as string, context);
        break;
      
      case 'branch':
        result = yield* executeBranch(stage, input, context);
        break;
      
      case 'loop':
        result = yield* executeLoop(stage, input, context);
        break;
      
      default:
        result = { output: input, error: `Unknown stage type` };
    }
    
    if (!result.error) {
      yield {
        type: 'stage_complete',
        stage: stageName,
        output: result.output,
        usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
        timestamp: Date.now(),
      };
    }
    
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { output: input, error: errorMsg };
  }
}

async function executeStep(
  step: Step<unknown, unknown>,
  input: unknown,
  context: StepContext
): Promise<StageResult> {
  const result = await step.run(input, context);
  return {
    output: result.output,
    usage: result.usage,
  };
}

async function executeEnsemble(
  ensemble: Ensemble<unknown, unknown>,
  input: unknown,
  context: StepContext
): Promise<StageResult> {
  const result = await ensemble.run(input, context);
  return {
    output: result.selected,
    usage: result.usage,
  };
}

async function executeVerification(
  verification: Verification,
  draft: string,
  context: StepContext
): Promise<StageResult> {
  // Generate checks
  const checks = await verification.generateChecks(draft, context);
  
  if (checks.length === 0) {
    return { output: draft };
  }
  
  // Answer checks
  const results = await verification.answerChecks(checks);
  
  // Revise if needed
  const revision = await verification.revise(draft, results);
  
  return {
    output: revision.revised,
    // Note: Usage tracking for verification would need to be accumulated
    // across multiple solver calls. For now, we return undefined.
  };
}

async function* executeBranch(
  stage: { type: 'branch'; condition: (ctx: StepContext) => string; branches: Record<string, PipelineStage[]>; name: string },
  input: unknown,
  context: StepContext
): AsyncGenerator<PipelineEvent<unknown>, StageResult> {
  const branchName = stage.condition(context);
  const branchStages = stage.branches[branchName];
  
  if (!branchStages) {
    return { output: input, error: `Unknown branch: ${branchName}` };
  }
  
  const usages: UsageStats[] = [];
  let currentOutput = input;
  
  for (const branchStage of branchStages) {
    const result = yield* executeStage(branchStage, currentOutput, context);
    
    if (result.error) {
      return result;
    }
    
    currentOutput = result.output;
    if (result.usage) {
      usages.push(result.usage);
    }
  }
  
  return {
    output: currentOutput,
    usage: combineUsage(usages),
  };
}

async function* executeLoop(
  stage: { type: 'loop'; maxIterations: number; until: (ctx: StepContext) => boolean; body: PipelineStage[]; name: string },
  input: unknown,
  context: StepContext
): AsyncGenerator<PipelineEvent<unknown>, StageResult> {
  const usages: UsageStats[] = [];
  let currentOutput = input;
  let iteration = 0;
  
  while (iteration < stage.maxIterations && !stage.until(context)) {
    for (const bodyStage of stage.body) {
      const result = yield* executeStage(bodyStage, currentOutput, context);
      
      if (result.error) {
        return result;
      }
      
      currentOutput = result.output;
      if (result.usage) {
        usages.push(result.usage);
      }
      
      // Update context for loop condition
      context.priorSteps.push({
        name: `${stage.name}-iter-${iteration}`,
        output: result.output,
      });
    }
    
    iteration++;
  }
  
  return {
    output: currentOutput,
    usage: combineUsage(usages),
  };
}

function getStateName(stage: PipelineStage): string {
  return stage.name;
}
