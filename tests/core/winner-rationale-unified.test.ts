/**
 * Tests for winner rationale extraction in the unified judge interface.
 * 
 * Verifies that WinnerRationale[] is correctly populated from judges
 * who ranked the winner as #1 in their pool.
 */
import { describe, it, expect } from 'bun:test';
import type { WinnerRationale } from '../../src/core/judge-unified';
import type { MultiJudgeResult, JudgePoolResult, CandidateInfo } from '../../src/core/multi-judge';

// Helper to simulate the winner rationale extraction logic from judge-unified
function extractWinnerRationales(
  judgeResults: JudgePoolResult[],
  winnerCandidateId: string
): WinnerRationale[] {
  const winnerRationales: WinnerRationale[] = [];
  for (const jr of judgeResults) {
    const winnerRanking = jr.rankings.find(r => r.candidateId === winnerCandidateId);
    // Only include if this judge gave winner rank=1 (best in their pool) and has reasoning
    if (winnerRanking && winnerRanking.rank === 1 && winnerRanking.reasoning) {
      winnerRationales.push({
        judgeBackend: jr.judgeBackend,
        judgeModel: jr.judgeModel,
        reasoning: winnerRanking.reasoning,
      });
    }
  }
  return winnerRationales;
}

describe('WinnerRationale extraction in unified judge', () => {
  it('should extract rationales only from judges who gave winner rank=1', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        rankings: [
          { candidateId: 'solver-1', rank: 1, confidence: 'high', reasoning: 'Claude: Best approach.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-1', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Codex: Preferred solver-0.' },
          { candidateId: 'solver-1', rank: 2, confidence: 'medium', reasoning: 'Codex: solver-1 is second.' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-1'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    // Assuming solver-1 wins overall (ranked #1 by claude, #2 by codex)
    const winnerRationales = extractWinnerRationales(judgeResults, 'solver-1');

    // Only claude-code should be included (gave solver-1 rank=1)
    expect(winnerRationales).toHaveLength(1);
    expect(winnerRationales[0].judgeBackend).toBe('claude-code');
    expect(winnerRationales[0].reasoning).toBe('Claude: Best approach.');
  });

  it('should extract multiple rationales when multiple judges gave winner rank=1', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Claude ranked solver-0 first.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Codex also ranked solver-0 first.' },
          { candidateId: 'solver-1', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-1'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const winnerRationales = extractWinnerRationales(judgeResults, 'solver-0');

    // Both judges gave solver-0 rank=1
    expect(winnerRationales).toHaveLength(2);
    expect(winnerRationales.map(r => r.judgeBackend).sort()).toEqual(['claude-code', 'codex']);
  });

  it('should return empty array when no judge gave winner rank=1 with reasoning', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high' }, // No reasoning
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    const winnerRationales = extractWinnerRationales(judgeResults, 'solver-0');

    expect(winnerRationales).toHaveLength(0);
  });

  it('should filter out judges who ranked winner lower than #1', () => {
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        rankings: [
          { candidateId: 'solver-1', rank: 1, confidence: 'high', reasoning: 'Claude preferred solver-1.' },
          { candidateId: 'solver-0', rank: 2, confidence: 'medium', reasoning: 'Claude ranked solver-0 second.' },
        ],
        poolSize: 2,
        indexMapping: ['solver-1', 'solver-0'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high', reasoning: 'Codex ranked solver-0 first.' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];

    // Assuming solver-0 wins overall
    const winnerRationales = extractWinnerRationales(judgeResults, 'solver-0');

    // Only codex should be included (claude gave solver-0 rank=2)
    expect(winnerRationales).toHaveLength(1);
    expect(winnerRationales[0].judgeBackend).toBe('codex');
    expect(winnerRationales[0].reasoning).toBe('Codex ranked solver-0 first.');
  });
});
