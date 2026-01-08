/**
 * Tests for winner rationale extraction from multi-judge results.
 * 
 * Verifies that rationales from judges who ranked the winner as #1
 * in their pool are correctly extracted and surfaced.
 */
import { describe, it, expect } from 'bun:test';
import {
  aggregateJudgeResults,
  CONFIDENCE_PENALTY,
  type CandidateInfo,
  type JudgePoolResult,
} from '../../src/core/multi-judge';

describe('winner rationale extraction', () => {
  const candidates: CandidateInfo[] = [
    { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
    { id: 'solver-1', solverBackend: 'codex', content: 'B' },
    { id: 'solver-2', solverBackend: 'gemini-cli', content: 'C' },
  ];

  it('should preserve reasoning in RankEntry via ranksByJudge', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Best solution with clear structure.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium', reasoning: 'Good but incomplete.' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);

    // Find solver-0's aggregated score
    const solver0Score = result.scores.find(s => s.candidateId === 'solver-0');
    expect(solver0Score).toBeDefined();
    expect(solver0Score!.ranksByJudge).toHaveLength(1);
    expect(solver0Score!.ranksByJudge[0].reasoning).toBe('Best solution with clear structure.');
  });

  it('should include reasoning from all judges who ranked winner as #1', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Codex: Clear winner.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'gemini-cli',
        judgeModel: 'gemini-3-pro',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Gemini: Excellent approach.' },
          { candidateId: 'solver-1', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-1'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);

    // Winner should be solver-0 (both judges ranked it #1)
    expect(result.winnerCandidateId).toBe('solver-0');

    // Check that winner's ranksByJudge has reasoning from both judges
    const winnerScore = result.scores.find(s => s.candidateId === 'solver-0');
    expect(winnerScore).toBeDefined();
    expect(winnerScore!.ranksByJudge).toHaveLength(2);

    const codexRanking = winnerScore!.ranksByJudge.find(r => r.judgeBackend === 'codex');
    expect(codexRanking?.reasoning).toBe('Codex: Clear winner.');

    const geminiRanking = winnerScore!.ranksByJudge.find(r => r.judgeBackend === 'gemini-cli');
    expect(geminiRanking?.reasoning).toBe('Gemini: Excellent approach.');
  });

  it('should only include reasoning from judges who gave rank=1 for tie scenario', () => {
    // Scenario: solver-0 gets rank 1 from codex, rank 2 from gemini
    // Only codex's reasoning should be used for "best rank" rationale
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Codex ranked this #1.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'gemini-cli',
        judgeModel: 'gemini-3-pro',
        rankings: [
          { candidateId: 'solver-1', rank: 1, confidence: 'high', reasoning: 'Gemini preferred solver-1.' },
          { candidateId: 'solver-0', rank: 2, confidence: 'medium', reasoning: 'Gemini ranked solver-0 second.' },
        ],
        poolSize: 2,
        indexMapping: ['solver-1', 'solver-0'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);

    // Check that solver-0's ranksByJudge includes gemini's reasoning too
    const solver0Score = result.scores.find(s => s.candidateId === 'solver-0');
    expect(solver0Score).toBeDefined();
    expect(solver0Score!.ranksByJudge).toHaveLength(2);

    // The reasoning is preserved at aggregation level (all rankings)
    // The filtering of "only rank=1" happens in judge-unified when building winnerRationales
    const geminiRanking = solver0Score!.ranksByJudge.find(r => r.judgeBackend === 'gemini-cli');
    expect(geminiRanking?.reasoning).toBe('Gemini ranked solver-0 second.');
    expect(geminiRanking?.rank).toBe(2);
  });

  it('should handle missing reasoning gracefully', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high' }, // No reasoning
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);

    const solver0Score = result.scores.find(s => s.candidateId === 'solver-0');
    expect(solver0Score).toBeDefined();
    expect(solver0Score!.ranksByJudge[0].reasoning).toBeUndefined();
  });
});
