import { describe, test, expect } from 'bun:test';
import {
  deriveModelMatches,
  deriveModuleMatches,
  deriveCategoryMatches,
  deriveJudgeMatches,
  deriveAllMatches,
  judgeKey,
  modelKey,
  moduleKey,
  categoryKey,
} from '../../src/stats/derive-matches';
import type { PairwiseStatEntry } from '../../src/stats/pairwise-types';

describe('derive-matches', () => {
  // Helper to create a minimal test entry
  function makeEntry(overrides: Partial<PairwiseStatEntry> = {}): PairwiseStatEntry {
    return {
      version: 1,
      timestamp: '2024-01-01T00:00:00Z',
      promptHash: 'abc123',
      runId: '2024-01-01T00:00:00Z-abc123',
      judgeMode: 'pairwise',
      candidates: [
        { candidateId: 'c1', solverBackend: 'claude', solverModel: 'opus', category: 'analytical', moduleId: 'so_what' },
        { candidateId: 'c2', solverBackend: 'codex', solverModel: 'gpt-5', category: 'creative', moduleId: 'invert' },
      ],
      votes: [
        { pairId: 'c1:c2', judgeBackend: 'claude', judgeModel: 'opus', candidateA: 'c1', candidateB: 'c2', outcome: 'A', confidence: 'high' },
        { pairId: 'c1:c2', judgeBackend: 'codex', judgeModel: 'gpt-5', candidateA: 'c1', candidateB: 'c2', outcome: 'B', confidence: 'medium' },
      ],
      pairResults: [
        { pairId: 'c1:c2', candidateA: 'c1', candidateB: 'c2', verdict: 'split', consensusWinner: null, agreementRate: 0.5 },
      ],
      ...overrides,
    };
  }

  describe('key functions', () => {
    test('judgeKey formats correctly', () => {
      expect(judgeKey('claude', 'opus')).toBe('judge:claude:opus');
    });

    test('modelKey formats correctly', () => {
      expect(modelKey('codex', 'gpt-5')).toBe('solver:codex:gpt-5');
    });

    test('moduleKey formats correctly', () => {
      expect(moduleKey('analytical', 'so_what')).toBe('module:analytical/so_what');
    });

    test('categoryKey formats correctly', () => {
      expect(categoryKey('analytical')).toBe('category:analytical');
    });
  });

  describe('deriveModelMatches', () => {
    test('creates matches for different models', () => {
      const entry = makeEntry();
      const matches = deriveModelMatches(entry);

      // Two votes, each creates 2 match records (one per side)
      expect(matches.size).toBe(2);

      const claudeMatches = matches.get('solver:claude:opus')!;
      const codexMatches = matches.get('solver:codex:gpt-5')!;

      expect(claudeMatches).toHaveLength(2);
      expect(codexMatches).toHaveLength(2);

      // First vote: claude wins (A=c1=claude)
      expect(claudeMatches[0].score).toBe(1);
      expect(codexMatches[0].score).toBe(0);

      // Second vote: codex wins (B=c2=codex)
      expect(claudeMatches[1].score).toBe(0);
      expect(codexMatches[1].score).toBe(1);
    });

    test('skips self-matches for same model', () => {
      const entry = makeEntry({
        candidates: [
          { candidateId: 'c1', solverBackend: 'claude', solverModel: 'opus', category: 'analytical', moduleId: 'so_what' },
          { candidateId: 'c2', solverBackend: 'claude', solverModel: 'opus', category: 'creative', moduleId: 'invert' },
        ],
      });
      const matches = deriveModelMatches(entry);

      // Same model vs itself = no matches
      expect(matches.size).toBe(0);
    });
  });

  describe('deriveModuleMatches', () => {
    test('creates matches for different modules', () => {
      const entry = makeEntry();
      const matches = deriveModuleMatches(entry);

      expect(matches.size).toBe(2);
      expect(matches.has('module:analytical/so_what')).toBe(true);
      expect(matches.has('module:creative/invert')).toBe(true);
    });

    test('skips self-matches for same module', () => {
      const entry = makeEntry({
        candidates: [
          { candidateId: 'c1', solverBackend: 'claude', solverModel: 'opus', category: 'analytical', moduleId: 'so_what' },
          { candidateId: 'c2', solverBackend: 'codex', solverModel: 'gpt-5', category: 'analytical', moduleId: 'so_what' },
        ],
      });
      const matches = deriveModuleMatches(entry);

      expect(matches.size).toBe(0);
    });
  });

  describe('deriveCategoryMatches', () => {
    test('creates matches for different categories', () => {
      const entry = makeEntry();
      const matches = deriveCategoryMatches(entry);

      expect(matches.size).toBe(2);
      expect(matches.has('category:analytical')).toBe(true);
      expect(matches.has('category:creative')).toBe(true);
    });

    test('skips self-matches for same category', () => {
      const entry = makeEntry({
        candidates: [
          { candidateId: 'c1', solverBackend: 'claude', solverModel: 'opus', category: 'analytical', moduleId: 'so_what' },
          { candidateId: 'c2', solverBackend: 'codex', solverModel: 'gpt-5', category: 'analytical', moduleId: 'other' },
        ],
      });
      const matches = deriveCategoryMatches(entry);

      expect(matches.size).toBe(0);
    });
  });

  describe('deriveJudgeMatches', () => {
    test('draws when verdict is split', () => {
      const entry = makeEntry(); // Default has split verdict
      const matches = deriveJudgeMatches(entry);

      expect(matches.size).toBe(2);
      
      const claudeJudge = matches.get('judge:claude:opus')!;
      const codexJudge = matches.get('judge:codex:gpt-5')!;

      // Both should draw (score=0.5)
      expect(claudeJudge[0].score).toBe(0.5);
      expect(codexJudge[0].score).toBe(0.5);
    });

    test('winner when one judge matches consensus', () => {
      const entry = makeEntry({
        pairResults: [
          { pairId: 'c1:c2', candidateA: 'c1', candidateB: 'c2', verdict: 'A', consensusWinner: 'c1', agreementRate: 1.0 },
        ],
      });
      const matches = deriveJudgeMatches(entry);

      const claudeJudge = matches.get('judge:claude:opus')!;
      const codexJudge = matches.get('judge:codex:gpt-5')!;

      // Claude voted A (correct), Codex voted B (wrong)
      expect(claudeJudge[0].score).toBe(1);
      expect(codexJudge[0].score).toBe(0);
    });

    test('draws when verdict is tie', () => {
      const entry = makeEntry({
        votes: [
          { pairId: 'c1:c2', judgeBackend: 'claude', judgeModel: 'opus', candidateA: 'c1', candidateB: 'c2', outcome: 'tie', confidence: 'high' },
          { pairId: 'c1:c2', judgeBackend: 'codex', judgeModel: 'gpt-5', candidateA: 'c1', candidateB: 'c2', outcome: 'tie', confidence: 'medium' },
        ],
        pairResults: [
          { pairId: 'c1:c2', candidateA: 'c1', candidateB: 'c2', verdict: 'tie', consensusWinner: null, agreementRate: 1.0 },
        ],
      });
      const matches = deriveJudgeMatches(entry);

      const claudeJudge = matches.get('judge:claude:opus')!;
      const codexJudge = matches.get('judge:codex:gpt-5')!;

      expect(claudeJudge[0].score).toBe(0.5);
      expect(codexJudge[0].score).toBe(0.5);
    });

    test('derives verdict from votes when pairResults missing', () => {
      const entry = makeEntry({
        votes: [
          { pairId: 'c1:c2', judgeBackend: 'claude', judgeModel: 'opus', candidateA: 'c1', candidateB: 'c2', outcome: 'A', confidence: 'high' },
          { pairId: 'c1:c2', judgeBackend: 'codex', judgeModel: 'gpt-5', candidateA: 'c1', candidateB: 'c2', outcome: 'A', confidence: 'medium' },
          { pairId: 'c1:c2', judgeBackend: 'droid', judgeModel: 'pro', candidateA: 'c1', candidateB: 'c2', outcome: 'B', confidence: 'low' },
        ],
        pairResults: undefined,
      });
      const matches = deriveJudgeMatches(entry);

      // Majority is A (2 votes), so claude and codex win, droid loses
      const claudeJudge = matches.get('judge:claude:opus')!;
      const codexJudge = matches.get('judge:codex:gpt-5')!;
      const droidJudge = matches.get('judge:droid:pro')!;

      // Claude vs Codex: both voted A (correct) = draw
      expect(claudeJudge.find(m => m.opponentKey === 'judge:codex:gpt-5')!.score).toBe(0.5);
      // Claude vs Droid: claude correct, droid wrong = claude wins
      expect(claudeJudge.find(m => m.opponentKey === 'judge:droid:pro')!.score).toBe(1);
      expect(droidJudge.find(m => m.opponentKey === 'judge:claude:opus')!.score).toBe(0);
    });
  });

  describe('deriveAllMatches', () => {
    test('returns all four match types', () => {
      const entry = makeEntry();
      const { judges, models, modules, categories } = deriveAllMatches(entry);

      expect(judges.size).toBeGreaterThan(0);
      expect(models.size).toBeGreaterThan(0);
      expect(modules.size).toBeGreaterThan(0);
      expect(categories.size).toBeGreaterThan(0);
    });
  });
});
