// Formatting utilities for console output

import type { UsageStats } from '../backend';

/**
 * Format usage statistics as a human-readable string.
 * Matches the format used in normal mode: "Tokens: X in, Y out"
 */
export function formatUsageStats(usage?: UsageStats | null): string {
  if (!usage) {
    return 'Tokens: ?';
  }

  return `Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`;
}
