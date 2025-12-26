import type { UsageStats } from '../backend';

export function formatUsageStats(usage?: UsageStats | null): string {
  if (!usage) {
    return 'Tokens: ?';
  }

  return `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`;
}
