/**
 * Ensemble primitive: run multiple LLM calls in parallel.
 * Plain data types + functions, no hidden state.
 */

import type { UsageStats } from '../backend';
import { runLlm, combineUsage, type LlmRequest } from './llm';

// ============================================================================
// Data Types
// ============================================================================

export interface EnsembleMember {
  id: string;
  request: LlmRequest;
}

export interface EnsembleOutput {
  id: string;
  text: string;
  usage?: UsageStats;
  error?: string;
}

export interface EnsembleResult {
  outputs: EnsembleOutput[];
  successful: string[];  // Just the texts of successful outputs
  totalUsage: UsageStats;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Run multiple LLM calls in parallel and collect results.
 */
export async function runEnsemble(members: EnsembleMember[]): Promise<EnsembleResult> {
  const results = await Promise.all(
    members.map(async (member): Promise<EnsembleOutput> => {
      try {
        const response = await runLlm(member.request);
        return {
          id: member.id,
          text: response.text,
          usage: response.usage,
        };
      } catch (error) {
        return {
          id: member.id,
          text: '',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  const successful = results
    .filter(r => !r.error && r.text)
    .map(r => r.text);

  const totalUsage = combineUsage(results.map(r => r.usage));

  return {
    outputs: results,
    successful,
    totalUsage,
  };
}
