// Ensemble primitive: run multiple LLM calls in parallel.

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
