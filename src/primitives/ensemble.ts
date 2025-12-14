/**
 * Ensemble implementation - Parallel solvers with aggregation.
 */

import { collectMessages, extractText, getUsage } from '../backend';
import type { UsageStats } from '../backend';
import type {
  Ensemble,
  EnsembleResult,
  Aggregator,
  Solver,
  StepContext,
} from './types';
import { combineUsage } from './step';

export interface CreateEnsembleOptions<I, O> {
  /** Ensemble name for logging/tracing */
  name: string;
  /** Solvers to run in parallel */
  solvers: Solver[];
  /** Strategy for combining outputs */
  aggregator: Aggregator<O>;
  /** Format input into prompt (shared by all solvers) */
  formatPrompt?: (input: I, context?: StepContext) => string;
  /** Parse messages to output type */
  parseOutput?: (text: string) => O;
}

/**
 * Create an ensemble instance.
 */
export function createEnsemble<I, O>(options: CreateEnsembleOptions<I, O>): Ensemble<I, O> {
  const {
    name,
    solvers,
    aggregator,
    formatPrompt = (input) => String(input),
    parseOutput = (text) => text as O,
  } = options;
  
  return {
    name,
    solvers,
    aggregator,
    
    async run(input: I, context?: StepContext): Promise<EnsembleResult<O>> {
      const prompt = formatPrompt(input, context);
      const additionalContext = context?.additionalContext;
      
      // Run all solvers in parallel
      const results = await Promise.all(
        solvers.map(async (solver) => {
          try {
            const messages = await collectMessages(solver.run(prompt, additionalContext));
            const text = extractText(messages);
            const usage = getUsage(messages) ?? { inputTokens: 0, outputTokens: 0 };
            return { output: parseOutput(text), usage, error: null };
          } catch (error) {
            return {
              output: null as O,
              usage: { inputTokens: 0, outputTokens: 0 },
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })
      );
      
      // Filter successful outputs
      const successfulOutputs = results
        .filter((r): r is { output: O; usage: UsageStats; error: null } => r.error === null)
        .map(r => r.output);
      
      // Aggregate
      const aggregated = await aggregator.aggregate(successfulOutputs, context);
      
      // Combine usage
      const totalUsage = combineUsage(results.map(r => r.usage));
      
      return {
        selected: aggregated.selected,
        confidence: aggregated.confidence,
        candidates: successfulOutputs,
        conflicts: aggregated.conflicts,
        usage: totalUsage,
      };
    },
  };
}

/**
 * Create a string ensemble that outputs strings.
 */
export function createStringEnsemble(options: {
  name: string;
  solvers: Solver[];
  aggregator: Aggregator<string>;
  formatPrompt?: (input: string, context?: StepContext) => string;
}): Ensemble<string, string> {
  return createEnsemble({
    ...options,
    parseOutput: (text) => text,
  });
}
