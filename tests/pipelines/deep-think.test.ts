import { describe, expect, test } from 'bun:test';
import { getDeepThinkStages, type DeepThinkTrace } from '../../src/pipelines/deep-think';

describe('DeepThink staging', () => {
  describe('getDeepThinkStages', () => {
    test('returns empty array when no trace', () => {
      const stages = getDeepThinkStages(undefined);
      expect(stages).toEqual([]);
    });

    test('returns solve and judge stages when trace exists without verify', () => {
      const trace: DeepThinkTrace = {
        prompt: 'test prompt',
        options: { backend: 'codex', k: 3, verify: false },
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0.5 },
      };

      const stages = getDeepThinkStages(trace);
      expect(stages).toEqual(['solve', 'judge']);
    });

    test('returns solve, judge, verify stages when trace has verify', () => {
      const trace: DeepThinkTrace = {
        prompt: 'test prompt',
        options: { backend: 'codex', k: 3, verify: true },
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0.5 },
        verify: {
          checks: [],
          results: [],
        },
      };

      const stages = getDeepThinkStages(trace);
      expect(stages).toEqual(['solve', 'judge', 'verify']);
    });

    test('includes revise stage when verify has revision', () => {
      const trace: DeepThinkTrace = {
        prompt: 'test prompt',
        options: { backend: 'codex', k: 3, verify: true },
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0.5 },
        verify: {
          checks: [{ id: '1', question: 'test?' }],
          results: [{ checkId: '1', answer: 'yes', verdict: 'supports', confidence: 0.8 }],
          revision: { changes: ['fix'], revised: 'improved' },
        },
      };

      const stages = getDeepThinkStages(trace);
      expect(stages).toEqual(['solve', 'judge', 'verify', 'revise']);
    });

    test('maintains stage order (solve → judge → verify → revise)', () => {
      const trace: DeepThinkTrace = {
        prompt: 'test',
        options: { backend: 'codex', k: 3, verify: true },
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0.5 },
        verify: { checks: [], results: [], revision: { changes: ['x'], revised: 'y' } },
      };

      const stages = getDeepThinkStages(trace);
      expect(stages[0]).toBe('solve');
      expect(stages[1]).toBe('judge');
      expect(stages[2]).toBe('verify');
      expect(stages[3]).toBe('revise');
    });

    test('always returns solve when trace exists', () => {
      // Even with minimal trace, solve should always be present
      const traces: DeepThinkTrace[] = [
        {
          prompt: '',
          options: { backend: 'codex', k: 1, verify: false },
          solve: { candidates: [] },
          judge: { selectedIndex: 0, confidence: 0 },
        },
        {
          prompt: 'x',
          options: { backend: 'codex', k: 100, verify: true },
          solve: { candidates: [] },
          judge: { selectedIndex: 0, confidence: 1.0 },
          verify: { checks: [], results: [] },
        },
      ];

      for (const trace of traces) {
        const stages = getDeepThinkStages(trace);
        expect(stages.length).toBeGreaterThan(0);
        expect(stages).toContain('solve');
      }
    });
  });
});
