/**
 * Tests for ensemble retry logic on empty output.
 * 
 * Verifies that runEnsemble retries once when a member returns
 * empty text without errors (transient "conk out" behavior).
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { runEnsemble, type EnsembleMember } from '../../src/core/ensemble';
import type { LlmResponse } from '../../src/core/llm';

// Mock runLlm to control responses
const mockRunLlm = mock(() => Promise.resolve({} as LlmResponse));

// Replace the real runLlm with our mock
mock.module('../../src/core/llm', () => ({
  runLlm: mockRunLlm,
  combineUsage: (usages: Array<{ inputTokens: number; outputTokens: number } | undefined>) => {
    return usages.reduce(
      (acc, u) => {
        if (!u) return acc;
        return {
          inputTokens: acc.inputTokens + u.inputTokens,
          outputTokens: acc.outputTokens + u.outputTokens,
        };
      },
      { inputTokens: 0, outputTokens: 0 }
    );
  },
}));

const createMember = (id: string): EnsembleMember => ({
  id,
  request: {
    backend: 'test',
    prompt: 'test prompt',
    systemPrompt: 'test system',
  },
});

describe('runEnsemble retry logic', () => {
  beforeEach(() => {
    mockRunLlm.mockClear();
  });

  test('success on first attempt - no retry', async () => {
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'success answer',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(1);
    expect(result.outputs[0].text).toBe('success answer');
    expect(result.outputs[0].usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(result.successful).toEqual(['success answer']);
  });

  test('empty output on first attempt - retries and succeeds', async () => {
    // First call: empty output (triggers retry)
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 0 },
    });
    // Second call: success
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'retry success',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(2);
    expect(result.outputs[0].text).toBe('retry success');
    // Usage accumulated: 100+100 input, 0+50 output
    expect(result.outputs[0].usage).toEqual({ inputTokens: 200, outputTokens: 50 });
    expect(result.successful).toEqual(['retry success']);
  });

  test('empty output on both attempts - returns empty with accumulated usage', async () => {
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 0 },
    });
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 0 },
    });

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(2);
    expect(result.outputs[0].text).toBe('');
    expect(result.outputs[0].usage).toEqual({ inputTokens: 200, outputTokens: 0 });
    expect(result.successful).toEqual([]); // Empty filtered out
  });

  test('backend error on first attempt - no retry', async () => {
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: ['rate limit exceeded'],
      usage: { inputTokens: 50, outputTokens: 0 },
    });

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(1);
    expect(result.outputs[0].text).toBe('');
    expect(result.outputs[0].backendErrors).toEqual(['rate limit exceeded']);
    expect(result.successful).toEqual([]);
  });

  test('exception on first attempt - no retry', async () => {
    mockRunLlm.mockRejectedValueOnce(new Error('network failure'));

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(1);
    expect(result.outputs[0].text).toBe('');
    expect(result.outputs[0].error).toBe('network failure');
    expect(result.successful).toEqual([]);
  });

  test('exception after accumulated usage - preserves usage', async () => {
    // First call: empty (retry triggered)
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 0 },
    });
    // Second call: throws
    mockRunLlm.mockRejectedValueOnce(new Error('timeout'));

    const result = await runEnsemble([createMember('m1')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(2);
    expect(result.outputs[0].error).toBe('timeout');
    // Should preserve usage from first attempt
    expect(result.outputs[0].usage).toEqual({ inputTokens: 100, outputTokens: 0 });
  });

  test('multiple members - each retries independently', async () => {
    // Member 1: success on first try
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'answer 1',
      errors: [],
      usage: { inputTokens: 50, outputTokens: 25 },
    });
    // Member 2: empty then success
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 50, outputTokens: 0 },
    });
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'answer 2',
      errors: [],
      usage: { inputTokens: 50, outputTokens: 30 },
    });

    const result = await runEnsemble([createMember('m1'), createMember('m2')]);

    expect(mockRunLlm).toHaveBeenCalledTimes(3);
    expect(result.outputs[0].text).toBe('answer 1');
    expect(result.outputs[0].usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    expect(result.outputs[1].text).toBe('answer 2');
    expect(result.outputs[1].usage).toEqual({ inputTokens: 100, outputTokens: 30 });
    expect(result.successful).toEqual(['answer 1', 'answer 2']);
  });

  test('totalUsage sums all accumulated usage across members', async () => {
    // Member 1: empty then success (2 attempts)
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: '',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 0 },
    });
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'a1',
      errors: [],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    // Member 2: success (1 attempt)
    mockRunLlm.mockResolvedValueOnce({
      messages: [],
      text: 'a2',
      errors: [],
      usage: { inputTokens: 80, outputTokens: 40 },
    });

    const result = await runEnsemble([createMember('m1'), createMember('m2')]);

    // m1: 200 in, 50 out; m2: 80 in, 40 out
    expect(result.totalUsage).toEqual({ inputTokens: 280, outputTokens: 90 });
  });
});
