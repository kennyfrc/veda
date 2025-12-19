/**
 * Ensemble primitive: run multiple LLM calls in parallel.
 * Plain data types + functions, no hidden state.
 */

import type { Message, UsageStats } from '../backend';
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
  error?: string;         // Exception error
  backendErrors?: string[]; // Errors from backend (auth, API, etc.)
}

export interface EnsembleResult {
  outputs: EnsembleOutput[];
  successful: string[];  // Just the texts of successful outputs
  totalUsage: UsageStats;
}

/** Event emitted during ensemble execution */
export interface EnsembleEvent {
  memberId: string;
  message: Message;
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Run multiple LLM calls in parallel and collect results.
 * @param onEvent Optional callback for streaming events from each member
 */
export async function runEnsemble(
  members: EnsembleMember[],
  onEvent?: (event: EnsembleEvent) => void
): Promise<EnsembleResult> {
  const results = await Promise.all(
    members.map(async (member): Promise<EnsembleOutput> => {
      try {
        const response = await runLlm({
          ...member.request,
          onMessage: onEvent 
            ? (msg) => onEvent({ memberId: member.id, message: msg })
            : undefined,
        });
        return {
          id: member.id,
          text: response.text,
          usage: response.usage,
          backendErrors: response.errors.length > 0 ? response.errors : undefined,
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
    .filter(r => !r.error && !r.backendErrors?.length && r.text)
    .map(r => r.text);

  const totalUsage = combineUsage(results.map(r => r.usage));

  return {
    outputs: results,
    successful,
    totalUsage,
  };
}
