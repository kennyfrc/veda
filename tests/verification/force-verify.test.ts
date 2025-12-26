import { describe, test, expect } from 'bun:test';
import {
  type DeepThinkOptions,
  type DeepThinkTrace,
} from '../../src/pipelines/deep-think';

describe('forceVerify option', () => {
  describe('DeepThinkOptions interface', () => {
    test('forceVerify is optional in DeepThinkOptions', () => {
      const options: DeepThinkOptions = {
        k: 3,
      };

      // TypeScript should allow omitting forceVerify
      expect(options.forceVerify).toBeUndefined();
    });

    test('forceVerify can be set to true', () => {
      const options: DeepThinkOptions = {
        k: 3,
        forceVerify: true,
      };

      expect(options.forceVerify).toBe(true);
    });

    test('forceVerify can be set to false', () => {
      const options: DeepThinkOptions = {
        k: 3,
        forceVerify: false,
      };

      expect(options.forceVerify).toBe(false);
    });
  });
});

describe('DeepThinkTrace structure', () => {
  test('options can include forceVerify', () => {
    const trace: DeepThinkTrace = {
      trace_version: 2,
      prompt: 'test prompt',
      options: {
        backend: 'codex',
        k: 3,
        verify: true,
        forceVerify: true,
      },
      solve: { candidates: [] },
      judge: { selectedIndex: 0, confidence: 0.5 },
    };

    expect(trace.options.forceVerify).toBe(true);
  });

  test('options.forceVerify is optional', () => {
    const trace: DeepThinkTrace = {
      trace_version: 2,
      prompt: 'test prompt',
      options: {
        backend: 'codex',
        k: 3,
        verify: true,
      },
      solve: { candidates: [] },
      judge: { selectedIndex: 0, confidence: 0.5 },
    };

    expect(trace.options.forceVerify).toBeUndefined();
  });
});
