import { describe, expect, test } from 'bun:test';
import { MajorityVote, FirstSuccess, Longest } from '../../src/primitives/aggregators';

describe('MajorityVote', () => {
  test('returns empty for no outputs', () => {
    const result = MajorityVote.aggregate([]);
    expect(result.selected).toBe('');
    expect(result.confidence).toBe(0);
  });

  test('returns single output with full confidence', () => {
    const result = MajorityVote.aggregate(['answer']);
    expect(result.selected).toBe('answer');
    expect(result.confidence).toBe(1);
  });

  test('selects majority answer', () => {
    const result = MajorityVote.aggregate(['yes', 'yes', 'no']);
    expect(result.selected).toBe('yes');
    expect(result.confidence).toBeCloseTo(2/3);
    expect(result.conflicts).toContain('no');
  });

  test('handles unanimous agreement', () => {
    const result = MajorityVote.aggregate(['correct', 'correct', 'correct']);
    expect(result.selected).toBe('correct');
    expect(result.confidence).toBe(1);
    expect(result.conflicts).toBeUndefined();
  });

  test('handles tie by picking first', () => {
    const result = MajorityVote.aggregate(['a', 'b']);
    // Both have count 1, so first wins
    expect(['a', 'b']).toContain(result.selected);
    expect(result.confidence).toBe(0.5);
  });

  test('normalizes whitespace for comparison', () => {
    const result = MajorityVote.aggregate(['yes', ' yes ', '  yes']);
    expect(result.confidence).toBe(1);
  });

  test('normalizes case for comparison but preserves original', () => {
    const result = MajorityVote.aggregate(['Yes', 'yes', 'YES']);
    expect(result.confidence).toBe(1);
    expect(['Yes', 'yes', 'YES']).toContain(result.selected);
  });
});

describe('FirstSuccess', () => {
  test('returns empty for no outputs', () => {
    const result = FirstSuccess.aggregate([]);
    expect(result.selected).toBe('');
    expect(result.confidence).toBe(0);
  });

  test('returns first non-empty output', () => {
    const result = FirstSuccess.aggregate(['', '  ', 'valid', 'also valid']);
    expect(result.selected).toBe('valid');
    expect(result.confidence).toBe(1);
  });

  test('skips whitespace-only outputs', () => {
    const result = FirstSuccess.aggregate(['  ', '\n\t', 'answer']);
    expect(result.selected).toBe('answer');
  });

  test('returns empty if all outputs empty', () => {
    const result = FirstSuccess.aggregate(['', '  ', '\n']);
    expect(result.selected).toBe('');
    expect(result.confidence).toBe(0);
  });
});

describe('Longest', () => {
  test('returns empty for no outputs', () => {
    const result = Longest.aggregate([]);
    expect(result.selected).toBe('');
    expect(result.confidence).toBe(0);
  });

  test('returns longest output', () => {
    const result = Longest.aggregate(['short', 'medium text', 'this is the longest text']);
    expect(result.selected).toBe('this is the longest text');
  });

  test('confidence based on length disparity', () => {
    // When one is much longer, confidence should be higher
    const result = Longest.aggregate(['a', 'aaaaaaaaaa']);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('handles equal lengths', () => {
    const result = Longest.aggregate(['abc', 'def', 'ghi']);
    expect(['abc', 'def', 'ghi']).toContain(result.selected);
  });
});
