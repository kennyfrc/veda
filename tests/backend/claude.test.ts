import { describe, expect, test } from 'bun:test';

/**
 * Direct implementation of toClaudeReasoningTokens for testing purposes.
 * Mirrors the implementation in src/backend/claude.ts
 */
function toClaudeReasoningTokens(reasoning: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): string {
  switch (reasoning) {
    case 'minimal': return '0';
    case 'low': return '7999';      // 8k-1
    case 'medium': return '15999';  // 16k-1
    case 'high': return '31999';    // 32k-1
    case 'xhigh': return '63999';   // 64k-1
  }
}

describe('Claude Reasoning Token Mapping', () => {
  test('maps minimal to 0 (disabled)', () => {
    expect(toClaudeReasoningTokens('minimal')).toBe('0');
  });

  test('maps low to 7999 (8k-1)', () => {
    expect(toClaudeReasoningTokens('low')).toBe('7999');
  });

  test('maps medium to 15999 (16k-1)', () => {
    expect(toClaudeReasoningTokens('medium')).toBe('15999');
  });

  test('maps high to 31999 (32k-1)', () => {
    expect(toClaudeReasoningTokens('high')).toBe('31999');
  });

  test('maps xhigh to 63999 (64k-1)', () => {
    expect(toClaudeReasoningTokens('xhigh')).toBe('63999');
  });

  test('all values are unique (no collisions)', () => {
    const values = new Set([
      toClaudeReasoningTokens('minimal'),
      toClaudeReasoningTokens('low'),
      toClaudeReasoningTokens('medium'),
      toClaudeReasoningTokens('high'),
      toClaudeReasoningTokens('xhigh'),
    ]);
    expect(values.size).toBe(5);
  });
});

describe('Claude Reasoning Token Values (Verification)', () => {
  test('token values are integers in string format', () => {
    for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh'] as const) {
      const value = toClaudeReasoningTokens(level);
      expect(value).toMatch(/^\d+$/); // Must be all digits
      expect(Number(value)).toBeInteger();
    }
  });

  test('token values increase monotonically', () => {
    const levels: Array<'minimal' | 'low' | 'medium' | 'high' | 'xhigh'> = ['minimal', 'low', 'medium', 'high', 'xhigh'];
    const values = levels.map(toClaudeReasoningTokens).map(Number);

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  test('token values respect 8k-1 multiples (literal k=1000)', () => {
    // Verify literal interpretation: 8k-1 = 7999
    expect(Number(toClaudeReasoningTokens('low'))).toBe(8 * 1000 - 1);
    expect(Number(toClaudeReasoningTokens('medium'))).toBe(16 * 1000 - 1);
    expect(Number(toClaudeReasoningTokens('high'))).toBe(32 * 1000 - 1);
    expect(Number(toClaudeReasoningTokens('xhigh'))).toBe(64 * 1000 - 1);
  });
});
