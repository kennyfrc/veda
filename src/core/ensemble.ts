import type { Message, UsageStats } from '../backend';
import { runLlm, combineUsage, type LlmRequest } from './llm';

export interface EnsembleMember {
  id: string;
  request: LlmRequest;
}

export interface EnsembleOutput {
  id: string;
  text: string;
  usage?: UsageStats;
  error?: string;
  backendErrors?: string[];
}

export interface EnsembleResult {
  outputs: EnsembleOutput[];
  successful: string[];
  totalUsage: UsageStats;
}

export interface EnsembleEvent {
  memberId: string;
  message: Message;
}

/**
 * Maximum attempts per member when output is empty.
 * Retry once if response has no text AND no errors (transient "conk out").
 */
const MAX_ATTEMPTS = 2;

export async function runEnsemble(
  members: EnsembleMember[],
  onEvent?: (event: EnsembleEvent) => void
): Promise<EnsembleResult> {
  const results = await Promise.all(
    members.map(async (member): Promise<EnsembleOutput> => {
      let attempts = 0;
      let accumulatedUsage: UsageStats = { inputTokens: 0, outputTokens: 0 };

      while (attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
          const response = await runLlm({
            ...member.request,
            onMessage: onEvent 
              ? (msg) => onEvent({ memberId: member.id, message: msg })
              : undefined,
          });

          // Accumulate usage across attempts (provider charges even for empty output)
          if (response.usage) {
            accumulatedUsage = combineUsage([accumulatedUsage, response.usage]);
          }

          // Success (has text) or hard failure (has errors) → return immediately
          if (response.text || response.errors.length > 0) {
            return {
              id: member.id,
              text: response.text,
              usage: accumulatedUsage,
              backendErrors: response.errors.length > 0 ? response.errors : undefined,
            };
          }

          // Empty text + no errors → transient failure, retry if attempts remain
          // (loop continues)

        } catch (error) {
          // Exception (network error, spawn failure, etc.) → fail fast, no retry
          return {
            id: member.id,
            text: '',
            error: error instanceof Error ? error.message : String(error),
            usage: accumulatedUsage.inputTokens > 0 ? accumulatedUsage : undefined,
          };
        }
      }

      // Exhausted retries → return empty result with accumulated usage
      return {
        id: member.id,
        text: '',
        usage: accumulatedUsage,
      };
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
