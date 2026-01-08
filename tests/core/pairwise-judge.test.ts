import { describe, it, expect } from 'bun:test';
import {
  generatePairs,
  validatePairCoverage,
  buildPairwiseAssignments,
  formatPairwisePrompt,
  parsePairwiseResponse,
  aggregatePairVotes,
  computeCopelandScores,
  computePairwiseConfidence,
  type CandidateInfo,
  type CandidatePair,
  type PairwiseVote,
} from '../../src/core/pairwise-judge';

describe('generatePairs', () => {
  it('should generate all pairs for 3 candidates', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
      { id: 'c', solverBackend: 'gemini', content: 'C' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex', 'gemini']);
    
    // C(3,2) = 3 pairs
    expect(pairs.length).toBe(3);
    expect(pairs.map(p => p.id).sort()).toEqual(['a:b', 'a:c', 'b:c']);
  });
  
  it('should generate C(k,2) pairs for k candidates', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
      { id: 'c', solverBackend: 'gemini', content: 'C' },
      { id: 'd', solverBackend: 'claude', content: 'D' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex', 'gemini']);
    
    // C(4,2) = 6 pairs
    expect(pairs.length).toBe(6);
  });
  
  it('should set eligibility correctly for cross-backend pairs (Policy B)', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // Cross-backend pair: both judges eligible (Policy B)
    expect(pairs.length).toBe(1);
    expect(pairs[0].isSameBackend).toBe(false);
    expect(pairs[0].eligibleJudges.sort()).toEqual(['claude', 'codex']);
  });
  
  it('should set eligibility correctly for same-backend pairs', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A1' },
      { id: 'b', solverBackend: 'claude', content: 'A2' },
      { id: 'c', solverBackend: 'codex', content: 'B1' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // Same-backend pair (a,b): only codex eligible
    const samePair = pairs.find(p => p.id === 'a:b');
    expect(samePair).toBeDefined();
    expect(samePair!.isSameBackend).toBe(true);
    expect(samePair!.eligibleJudges).toEqual(['codex']);
    
    // Cross-backend pairs: both eligible
    const crossPair = pairs.find(p => p.id === 'a:c');
    expect(crossPair!.eligibleJudges.sort()).toEqual(['claude', 'codex']);
  });
  
  it('should handle 2 backends with 1 candidate each', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // 1 pair, both judges eligible
    expect(pairs.length).toBe(1);
    expect(pairs[0].eligibleJudges.sort()).toEqual(['claude', 'codex']);
  });
});

describe('validatePairCoverage', () => {
  it('should validate complete coverage', () => {
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude', 'codex'] },
    ];
    
    const result = validatePairCoverage(pairs);
    expect(result.valid).toBe(true);
    expect(result.uncoveredPairs).toEqual([]);
  });
  
  it('should detect uncovered pairs', () => {
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'claude', isSameBackend: true, eligibleJudges: [] },
    ];
    
    const result = validatePairCoverage(pairs);
    expect(result.valid).toBe(false);
    expect(result.uncoveredPairs).toContain('a:b');
  });
});

describe('buildPairwiseAssignments', () => {
  it('should assign pairs to eligible judges', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    const assignments = buildPairwiseAssignments(pairs, ['claude', 'codex'], 'test-hash');
    
    // Both judges should have the pair
    expect(assignments.length).toBe(2);
    expect(assignments.find(a => a.judgeBackend === 'claude')?.pairs.length).toBe(1);
    expect(assignments.find(a => a.judgeBackend === 'codex')?.pairs.length).toBe(1);
  });
  
  it('should exclude judges from same-backend pairs', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A1' },
      { id: 'b', solverBackend: 'claude', content: 'A2' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    const assignments = buildPairwiseAssignments(pairs, ['claude', 'codex'], 'test-hash');
    
    // Only codex should have the pair (claude excluded from same-backend)
    expect(assignments.length).toBe(1);
    expect(assignments[0].judgeBackend).toBe('codex');
  });
  
  it('should produce deterministic shuffles with same seed', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
      { id: 'c', solverBackend: 'gemini', content: 'C' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex', 'gemini']);
    const assignments1 = buildPairwiseAssignments(pairs, ['claude', 'codex', 'gemini'], 'same-hash');
    const assignments2 = buildPairwiseAssignments(pairs, ['claude', 'codex', 'gemini'], 'same-hash');
    
    expect(assignments1).toEqual(assignments2);
  });
});

describe('formatPairwisePrompt', () => {
  it('should format pairs correctly', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'Answer A' },
      { id: 'b', solverBackend: 'codex', content: 'Answer B' },
    ];
    
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude', 'codex'] },
    ];
    
    const prompt = formatPairwisePrompt(candidates, pairs, 'Original task');
    
    expect(prompt).toContain('Original task');
    expect(prompt).toContain('## Pair 1');
    expect(prompt).toContain('<candidate_a>');
    expect(prompt).toContain('Answer A');
    expect(prompt).toContain('<candidate_b>');
    expect(prompt).toContain('Answer B');
  });
});

describe('parsePairwiseResponse', () => {
  it('should parse valid response', () => {
    const response = `
<comparison pair="1">
<winner>A</winner>
<confidence>high</confidence>
<reasoning>A is better because...</reasoning>
</comparison>
`;
    
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude'] },
    ];
    
    const { votes, repaired } = parsePairwiseResponse(response, pairs, 'claude', 'opus');
    
    expect(repaired).toBe(false);
    expect(votes.length).toBe(1);
    expect(votes[0].pairId).toBe('a:b');
    expect(votes[0].winner).toBe('a');
    expect(votes[0].choice).toBe('A');
    expect(votes[0].confidence).toBe('high');
    expect(votes[0].reasoning).toBe('A is better because...');
  });
  
  it('should parse B winner', () => {
    const response = `
<comparison pair="1">
<winner>B</winner>
<confidence>medium</confidence>
<reasoning>B wins.</reasoning>
</comparison>
`;
    
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude'] },
    ];
    
    const { votes } = parsePairwiseResponse(response, pairs, 'claude', 'opus');
    
    expect(votes[0].winner).toBe('b');
    expect(votes[0].choice).toBe('B');
  });
  
  it('should parse tie', () => {
    const response = `
<comparison pair="1">
<winner>tie</winner>
<confidence>low</confidence>
<reasoning>Both are equal.</reasoning>
</comparison>
`;
    
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude'] },
    ];
    
    const { votes } = parsePairwiseResponse(response, pairs, 'claude', 'opus');
    
    expect(votes[0].winner).toBe(null);
    expect(votes[0].choice).toBe('tie');
  });
  
  it('should repair missing pairs', () => {
    const response = `
<comparison pair="1">
<winner>A</winner>
<confidence>high</confidence>
</comparison>
`;
    
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude'] },
      { id: 'a:c', candidateA: 'a', candidateB: 'c', backendA: 'claude', backendB: 'gemini', isSameBackend: false, eligibleJudges: ['claude'] },
    ];
    
    const { votes, repaired } = parsePairwiseResponse(response, pairs, 'claude', 'opus');
    
    expect(repaired).toBe(true);
    expect(votes.length).toBe(2);
    
    // Second pair should be repaired as tie with low confidence
    const repairedVote = votes.find(v => v.pairId === 'a:c');
    expect(repairedVote?.winner).toBe(null);
    expect(repairedVote?.choice).toBe('tie');
    expect(repairedVote?.confidence).toBe('low');
  });
});

describe('aggregatePairVotes', () => {
  it('should determine consensus winner by majority', () => {
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude', 'codex'] },
    ];
    
    const votes: PairwiseVote[] = [
      { pairId: 'a:b', judgeBackend: 'claude', judgeModel: 'opus', winner: 'a', choice: 'A', confidence: 'high' },
      { pairId: 'a:b', judgeBackend: 'codex', judgeModel: 'gpt', winner: 'a', choice: 'A', confidence: 'high' },
    ];
    
    const results = aggregatePairVotes(pairs, votes);
    
    expect(results.length).toBe(1);
    expect(results[0].consensusWinner).toBe('a');
    expect(results[0].verdict).toBe('A');
    expect(results[0].agreementRate).toBe(1.0);
  });
  
  it('should handle split decisions', () => {
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude', 'codex'] },
    ];
    
    const votes: PairwiseVote[] = [
      { pairId: 'a:b', judgeBackend: 'claude', judgeModel: 'opus', winner: 'a', choice: 'A', confidence: 'high' },
      { pairId: 'a:b', judgeBackend: 'codex', judgeModel: 'gpt', winner: 'b', choice: 'B', confidence: 'high' },
    ];
    
    const results = aggregatePairVotes(pairs, votes);
    
    expect(results[0].consensusWinner).toBe(null);
    expect(results[0].verdict).toBe('split');
    expect(results[0].agreementRate).toBe(0.5);
  });
  
  it('should handle unanimous tie', () => {
    const pairs: CandidatePair[] = [
      { id: 'a:b', candidateA: 'a', candidateB: 'b', backendA: 'claude', backendB: 'codex', isSameBackend: false, eligibleJudges: ['claude', 'codex'] },
    ];
    
    const votes: PairwiseVote[] = [
      { pairId: 'a:b', judgeBackend: 'claude', judgeModel: 'opus', winner: null, choice: 'tie', confidence: 'medium' },
      { pairId: 'a:b', judgeBackend: 'codex', judgeModel: 'gpt', winner: null, choice: 'tie', confidence: 'medium' },
    ];
    
    const results = aggregatePairVotes(pairs, votes);
    
    expect(results[0].consensusWinner).toBe(null);
    expect(results[0].verdict).toBe('tie');
    expect(results[0].agreementRate).toBe(1.0);
  });
});

describe('computeCopelandScores', () => {
  it('should compute Copeland scores correctly', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
      { id: 'c', solverBackend: 'gemini', content: 'C' },
    ];
    
    // a beats b, a beats c, b beats c
    const pairResults = [
      { pairId: 'a:b', candidateA: 'a', candidateB: 'b', votes: [], consensusWinner: 'a', verdict: 'A' as const, agreementRate: 1 },
      { pairId: 'a:c', candidateA: 'a', candidateB: 'c', votes: [], consensusWinner: 'a', verdict: 'A' as const, agreementRate: 1 },
      { pairId: 'b:c', candidateA: 'b', candidateB: 'c', votes: [], consensusWinner: 'b', verdict: 'A' as const, agreementRate: 1 },
    ];
    
    const scores = computeCopelandScores(candidates, pairResults);
    
    // a: 2 wins, 0 losses → Copeland = 2
    // b: 1 win, 1 loss → Copeland = 0
    // c: 0 wins, 2 losses → Copeland = -2
    expect(scores[0].candidateId).toBe('a');
    expect(scores[0].copelandScore).toBe(2);
    expect(scores[0].wins).toBe(2);
    expect(scores[0].losses).toBe(0);
    
    expect(scores[1].candidateId).toBe('b');
    expect(scores[1].copelandScore).toBe(0);
    
    expect(scores[2].candidateId).toBe('c');
    expect(scores[2].copelandScore).toBe(-2);
  });
  
  it('should handle ties', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairResults = [
      { pairId: 'a:b', candidateA: 'a', candidateB: 'b', votes: [], consensusWinner: null, verdict: 'tie' as const, agreementRate: 1 },
    ];
    
    const scores = computeCopelandScores(candidates, pairResults);
    
    // Both have 0 wins, 0 losses, 1 tie
    expect(scores[0].copelandScore).toBe(0);
    expect(scores[0].ties).toBe(1);
    expect(scores[1].copelandScore).toBe(0);
    expect(scores[1].ties).toBe(1);
  });
  
  it('should use tiebreakers: wins then losses then ID', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
      { id: 'c', solverBackend: 'gemini', content: 'C' },
    ];
    
    // a beats b, c beats a, b beats c → cycle, all Copeland = 0
    const pairResults = [
      { pairId: 'a:b', candidateA: 'a', candidateB: 'b', votes: [], consensusWinner: 'a', verdict: 'A' as const, agreementRate: 1 },
      { pairId: 'a:c', candidateA: 'a', candidateB: 'c', votes: [], consensusWinner: 'c', verdict: 'B' as const, agreementRate: 1 },
      { pairId: 'b:c', candidateA: 'b', candidateB: 'c', votes: [], consensusWinner: 'b', verdict: 'A' as const, agreementRate: 1 },
    ];
    
    const scores = computeCopelandScores(candidates, pairResults);
    
    // All have Copeland = 0 (1 win, 1 loss)
    // Tiebreaker: same wins (1), same losses (1), so ID order: a, b, c
    expect(scores.map(s => s.candidateId)).toEqual(['a', 'b', 'c']);
  });
});

describe('computePairwiseConfidence', () => {
  it('should return high confidence for clear winner', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairResults = [
      { pairId: 'a:b', candidateA: 'a', candidateB: 'b', votes: [], consensusWinner: 'a', verdict: 'A' as const, agreementRate: 1.0 },
    ];
    
    const scores = computeCopelandScores(candidates, pairResults);
    const { level, score, winMargin } = computePairwiseConfidence(scores, pairResults);
    
    expect(winMargin).toBeGreaterThan(0);
    expect(score).toBeGreaterThan(0.5);
  });
  
  it('should return low confidence for many splits', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairResults = [
      { pairId: 'a:b', candidateA: 'a', candidateB: 'b', votes: [], consensusWinner: null, verdict: 'split' as const, agreementRate: 0.5 },
    ];
    
    const scores = computeCopelandScores(candidates, pairResults);
    const { level, score } = computePairwiseConfidence(scores, pairResults);
    
    expect(score).toBeLessThan(0.75); // Not high confidence
  });
  
  it('should return high confidence for single candidate', () => {
    const scores = [{
      candidateId: 'a',
      solverBackend: 'claude',
      wins: 0,
      losses: 0,
      ties: 0,
      copelandScore: 0,
      totalPairs: 0,
      headToHead: new Map(),
    }];
    
    const { level, score, winMargin } = computePairwiseConfidence(scores, []);
    
    expect(level).toBe('high');
    expect(score).toBe(0.9);
    expect(winMargin).toBe(1.0);
  });
});

describe('2-backend scenario (the key fix)', () => {
  it('should correctly compare cross-backend candidates', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // Both judges vote on the cross-backend pair
    expect(pairs.length).toBe(1);
    expect(pairs[0].eligibleJudges.sort()).toEqual(['claude', 'codex']);
    
    // Simulate both judges agreeing A wins
    const votes: PairwiseVote[] = [
      { pairId: 'a:b', judgeBackend: 'claude', judgeModel: 'opus', winner: 'a', choice: 'A', confidence: 'high' },
      { pairId: 'a:b', judgeBackend: 'codex', judgeModel: 'gpt', winner: 'a', choice: 'A', confidence: 'high' },
    ];
    
    const pairResults = aggregatePairVotes(pairs, votes);
    expect(pairResults[0].consensusWinner).toBe('a');
    expect(pairResults[0].agreementRate).toBe(1.0);
    
    const scores = computeCopelandScores(candidates, pairResults);
    expect(scores[0].candidateId).toBe('a');
    expect(scores[0].copelandScore).toBe(1);
  });
  
  it('should detect disagreement when judges conflict', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // Claude prefers its own (A), Codex prefers its own (B) - split!
    const votes: PairwiseVote[] = [
      { pairId: 'a:b', judgeBackend: 'claude', judgeModel: 'opus', winner: 'a', choice: 'A', confidence: 'high' },
      { pairId: 'a:b', judgeBackend: 'codex', judgeModel: 'gpt', winner: 'b', choice: 'B', confidence: 'high' },
    ];
    
    const pairResults = aggregatePairVotes(pairs, votes);
    
    // Should be a split - no consensus
    expect(pairResults[0].verdict).toBe('split');
    expect(pairResults[0].consensusWinner).toBe(null);
    expect(pairResults[0].agreementRate).toBe(0.5);
    
    const scores = computeCopelandScores(candidates, pairResults);
    // Both have 0 wins, 0 losses (tie/split doesn't count as win)
    expect(scores[0].copelandScore).toBe(0);
    expect(scores[1].copelandScore).toBe(0);
  });
});

describe('multi-candidate scenario', () => {
  it('should correctly rank 4 candidates across 2 backends', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a1', solverBackend: 'claude', content: 'A1' },
      { id: 'a2', solverBackend: 'claude', content: 'A2' },
      { id: 'b1', solverBackend: 'codex', content: 'B1' },
      { id: 'b2', solverBackend: 'codex', content: 'B2' },
    ];
    
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    // C(4,2) = 6 pairs
    expect(pairs.length).toBe(6);
    
    // Same-backend pairs: only other backend judges
    const a1a2 = pairs.find(p => p.id === 'a1:a2');
    expect(a1a2?.eligibleJudges).toEqual(['codex']);
    
    const b1b2 = pairs.find(p => p.id === 'b1:b2');
    expect(b1b2?.eligibleJudges).toEqual(['claude']);
    
    // Cross-backend pairs: both judges
    const a1b1 = pairs.find(p => p.id === 'a1:b1');
    expect(a1b1?.eligibleJudges.sort()).toEqual(['claude', 'codex']);
  });
});

describe('edge cases', () => {
  it('should handle empty candidates', () => {
    const pairs = generatePairs([], []);
    expect(pairs.length).toBe(0);
  });
  
  it('should handle single candidate (no pairs)', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
    ];
    const pairs = generatePairs(candidates, ['claude']);
    expect(pairs.length).toBe(0);
  });
  
  it('should default to tie verdict when no votes', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a', solverBackend: 'claude', content: 'A' },
      { id: 'b', solverBackend: 'codex', content: 'B' },
    ];
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    const results = aggregatePairVotes(pairs, []);
    
    expect(results[0].verdict).toBe('tie');
    expect(results[0].agreementRate).toBe(1);
  });
  
  it('should detect coverage failure for same-backend without external judge', () => {
    const candidates: CandidateInfo[] = [
      { id: 'a1', solverBackend: 'claude', content: 'A1' },
      { id: 'a2', solverBackend: 'claude', content: 'A2' },
    ];
    const pairs = generatePairs(candidates, ['claude']);
    const coverage = validatePairCoverage(pairs);
    
    expect(coverage.valid).toBe(false);
    expect(coverage.uncoveredPairs).toContain('a1:a2');
  });
  
  it('should order pair IDs lexically regardless of input order', () => {
    const candidates: CandidateInfo[] = [
      { id: 'z', solverBackend: 'claude', content: 'Z' },
      { id: 'a', solverBackend: 'codex', content: 'A' },
    ];
    const pairs = generatePairs(candidates, ['claude', 'codex']);
    
    expect(pairs[0].id).toBe('a:z');
    expect(pairs[0].candidateA).toBe('a');
    expect(pairs[0].candidateB).toBe('z');
  });
});
