import { describe, it, expect } from 'bun:test';
import {
  buildJudgeAssignments,
  validateAssignments,
  formatRankingPrompt,
  parseRankingResponse,
  processJudgeResults,
  aggregateJudgeResults,
  CONFIDENCE_PENALTY,
  type CandidateInfo,
  type JudgePoolResult,
  type JudgePoolExecutionResult,
} from '../../src/core/multi-judge';

describe('buildJudgeAssignments', () => {
  it('should create cross-provider assignments with 3 backends', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer A1' },
      { id: 'solver-1', solverBackend: 'claude-code', content: 'Answer A2' },
      { id: 'solver-2', solverBackend: 'codex', content: 'Answer B1' },
      { id: 'solver-3', solverBackend: 'codex', content: 'Answer B2' },
      { id: 'solver-4', solverBackend: 'droid', content: 'Answer C1' },
      { id: 'solver-5', solverBackend: 'droid', content: 'Answer C2' },
    ];
    
    const assignments = buildJudgeAssignments(candidates, 'test-hash');
    
    // Should have 3 judges (one per unique backend)
    expect(assignments.length).toBe(3);
    
    // claude-code judge should evaluate codex and droid candidates
    const claudeJudge = assignments.find(a => a.judgeBackend === 'claude-code');
    expect(claudeJudge).toBeDefined();
    expect(claudeJudge!.candidateIds).toHaveLength(4);
    expect(claudeJudge!.candidateIds).not.toContain('solver-0');
    expect(claudeJudge!.candidateIds).not.toContain('solver-1');
    
    // codex judge should evaluate claude and droid candidates
    const codexJudge = assignments.find(a => a.judgeBackend === 'codex');
    expect(codexJudge).toBeDefined();
    expect(codexJudge!.candidateIds).toHaveLength(4);
    expect(codexJudge!.candidateIds).not.toContain('solver-2');
    expect(codexJudge!.candidateIds).not.toContain('solver-3');
    
    // droid judge should evaluate claude and codex candidates
    const droidJudge = assignments.find(a => a.judgeBackend === 'droid');
    expect(droidJudge).toBeDefined();
    expect(droidJudge!.candidateIds).toHaveLength(4);
    expect(droidJudge!.candidateIds).not.toContain('solver-4');
    expect(droidJudge!.candidateIds).not.toContain('solver-5');
  });
  
  it('should create cross-provider assignments with 2 backends', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'Answer B' },
    ];
    
    const assignments = buildJudgeAssignments(candidates, 'test-hash');
    
    // Should have 2 judges
    expect(assignments.length).toBe(2);
    
    // Each judge evaluates exactly 1 candidate (the other backend's)
    const claudeJudge = assignments.find(a => a.judgeBackend === 'claude-code');
    expect(claudeJudge!.candidateIds).toEqual(['solver-1']);
    
    const codexJudge = assignments.find(a => a.judgeBackend === 'codex');
    expect(codexJudge!.candidateIds).toEqual(['solver-0']);
  });
  
  it('should handle single backend (no cross-provider possible)', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer A' },
      { id: 'solver-1', solverBackend: 'claude-code', content: 'Answer B' },
    ];
    
    const assignments = buildJudgeAssignments(candidates, 'test-hash');
    
    // No assignments possible (judge can't evaluate same backend)
    expect(assignments.length).toBe(0);
  });
  
  it('should respect judgeBackendOverride', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'Answer B' },
      { id: 'solver-2', solverBackend: 'droid', content: 'Answer C' },
    ];
    
    // Only use codex and droid as judges
    const assignments = buildJudgeAssignments(candidates, 'test-hash', ['codex', 'droid']);
    
    expect(assignments.length).toBe(2);
    expect(assignments.map(a => a.judgeBackend)).toContain('codex');
    expect(assignments.map(a => a.judgeBackend)).toContain('droid');
    expect(assignments.map(a => a.judgeBackend)).not.toContain('claude-code');
  });
  
  it('should produce deterministic shuffles with same seed', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'Answer B' },
      { id: 'solver-2', solverBackend: 'droid', content: 'Answer C' },
    ];
    
    const assignments1 = buildJudgeAssignments(candidates, 'same-hash');
    const assignments2 = buildJudgeAssignments(candidates, 'same-hash');
    
    // Same seed should produce identical assignments
    expect(assignments1).toEqual(assignments2);
    
    // Different seed should potentially produce different order
    const assignments3 = buildJudgeAssignments(candidates, 'different-hash');
    // At least the structure should be the same
    expect(assignments3.length).toBe(assignments1.length);
  });
});

describe('validateAssignments', () => {
  it('should validate correct coverage', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'B' },
      { id: 'solver-2', solverBackend: 'droid', content: 'C' },
    ];
    
    const assignments = buildJudgeAssignments(candidates, 'test');
    const result = validateAssignments(candidates, assignments);
    
    expect(result.valid).toBe(true);
  });
  
  it('should detect incomplete coverage', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'B' },
      { id: 'solver-2', solverBackend: 'droid', content: 'C' },
    ];
    
    // Manually create incomplete assignments
    const incompleteAssignments = [
      { judgeBackend: 'codex', candidateIds: ['solver-0'], indexMapping: ['solver-0'], seed: 'x' },
    ];
    
    const result = validateAssignments(candidates, incompleteAssignments);
    
    expect(result.valid).toBe(false);
    expect(result.error).toContain('solver-0');
  });
  
  it('should validate single backend expects 0 judges', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'claude-code', content: 'B' },
    ];
    
    // With single backend, empty assignments is correct
    const emptyAssignments: any[] = [];
    const result = validateAssignments(candidates, emptyAssignments);
    
    expect(result.valid).toBe(true);
  });
});

describe('formatRankingPrompt', () => {
  it('should format candidates in display order', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'Answer Zero' },
      { id: 'solver-1', solverBackend: 'codex', content: 'Answer One' },
      { id: 'solver-2', solverBackend: 'droid', content: 'Answer Two' },
    ];
    
    // Shuffle order: 2, 0, 1
    const indexMapping = ['solver-2', 'solver-0', 'solver-1'];
    
    const prompt = formatRankingPrompt(candidates, indexMapping, 'Original task');
    
    expect(prompt).toContain('Original task');
    expect(prompt).toContain('## Candidate 1');
    expect(prompt).toContain('Answer Two'); // solver-2 is first in display order
    expect(prompt).toContain('## Candidate 2');
    expect(prompt).toContain('Answer Zero');
    expect(prompt).toContain('## Candidate 3');
    expect(prompt).toContain('Answer One');
  });
});

describe('parseRankingResponse', () => {
  it('should parse valid rankings', () => {
    const response = `
<consensus_analysis>
Candidates cluster into two approaches.
</consensus_analysis>

<rankings>
<rank position="1" confidence="high">
<candidate>2</candidate>
<reasoning>Best solution.</reasoning>
</rank>
<rank position="2" confidence="medium">
<candidate>1</candidate>
<reasoning>Good but not as complete.</reasoning>
</rank>
<rank position="3" confidence="low">
<candidate>3</candidate>
<reasoning>Has issues.</reasoning>
</rank>
</rankings>
`;
    
    const indexMapping = ['solver-a', 'solver-b', 'solver-c'];
    const { rankings, consensusAnalysis, repaired } = parseRankingResponse(response, indexMapping);
    
    expect(repaired).toBe(false);
    expect(consensusAnalysis).toContain('two approaches');
    expect(rankings).toHaveLength(3);
    
    expect(rankings[0].candidateId).toBe('solver-b'); // Display index 2 → solver-b
    expect(rankings[0].rank).toBe(1);
    expect(rankings[0].confidence).toBe('high');
    
    expect(rankings[1].candidateId).toBe('solver-a'); // Display index 1 → solver-a
    expect(rankings[1].rank).toBe(2);
    
    expect(rankings[2].candidateId).toBe('solver-c'); // Display index 3 → solver-c
    expect(rankings[2].rank).toBe(3);
  });
  
  it('should repair missing candidates', () => {
    const response = `
<rankings>
<rank position="1" confidence="high">
<candidate>1</candidate>
<reasoning>Best.</reasoning>
</rank>
</rankings>
`;
    
    const indexMapping = ['solver-a', 'solver-b', 'solver-c'];
    const { rankings, repaired } = parseRankingResponse(response, indexMapping);
    
    expect(repaired).toBe(true);
    expect(rankings).toHaveLength(3);
    
    // First one is as parsed
    expect(rankings[0].candidateId).toBe('solver-a');
    expect(rankings[0].rank).toBe(1);
    expect(rankings[0].confidence).toBe('high');
    
    // Missing ones added at bottom with low confidence
    expect(rankings[1].confidence).toBe('low');
    expect(rankings[2].confidence).toBe('low');
  });
  
  it('should handle duplicate candidates (first wins)', () => {
    const response = `
<rankings>
<rank position="1" confidence="high">
<candidate>1</candidate>
<reasoning>First.</reasoning>
</rank>
<rank position="2" confidence="medium">
<candidate>1</candidate>
<reasoning>Duplicate.</reasoning>
</rank>
<rank position="3" confidence="low">
<candidate>2</candidate>
<reasoning>Second.</reasoning>
</rank>
</rankings>
`;
    
    const indexMapping = ['solver-a', 'solver-b'];
    const { rankings, repaired } = parseRankingResponse(response, indexMapping);
    
    expect(repaired).toBe(true);
    expect(rankings).toHaveLength(2);
    expect(rankings[0].candidateId).toBe('solver-a');
    expect(rankings[1].candidateId).toBe('solver-b');
  });
});

describe('processJudgeResults', () => {
  it('should identify no failures', () => {
    const results: JudgePoolExecutionResult[] = [
      { success: true, value: mockJudgePoolResult('codex'), judgeBackend: 'codex' },
      { success: true, value: mockJudgePoolResult('droid'), judgeBackend: 'droid' },
    ];
    
    const { validResults, penalty, failureCount } = processJudgeResults(results);
    
    expect(validResults).toHaveLength(2);
    expect(penalty).toBe(CONFIDENCE_PENALTY.NONE);
    expect(failureCount).toBe(0);
  });
  
  it('should apply some failures penalty', () => {
    const results: JudgePoolExecutionResult[] = [
      { success: true, value: mockJudgePoolResult('codex'), judgeBackend: 'codex' },
      { success: false, error: 'Timeout', judgeBackend: 'droid' },
      { success: true, value: mockJudgePoolResult('claude-code'), judgeBackend: 'claude-code' },
    ];
    
    const { validResults, penalty, failureCount } = processJudgeResults(results);
    
    expect(validResults).toHaveLength(2);
    expect(penalty).toBe(CONFIDENCE_PENALTY.SOME_FAILURES);
    expect(failureCount).toBe(1);
  });
  
  it('should apply most failures penalty', () => {
    const results: JudgePoolExecutionResult[] = [
      { success: false, error: 'Error 1', judgeBackend: 'codex' },
      { success: false, error: 'Error 2', judgeBackend: 'droid' },
      { success: true, value: mockJudgePoolResult('claude-code'), judgeBackend: 'claude-code' },
    ];
    
    const { validResults, penalty, failureCount } = processJudgeResults(results);
    
    expect(validResults).toHaveLength(1);
    expect(penalty).toBe(CONFIDENCE_PENALTY.MOST_FAILURES);
    expect(failureCount).toBe(2);
  });
});

describe('aggregateJudgeResults', () => {
  it('should select winner with lowest average normalized rank', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'B' },
      { id: 'solver-2', solverBackend: 'droid', content: 'C' },
    ];
    
    // Judge 1 (codex) ranks: solver-0=#1, solver-2=#2
    // Judge 2 (droid) ranks: solver-0=#1, solver-1=#2
    // solver-0 should win (always #1)
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high' },
          { candidateId: 'solver-2', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-2'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'droid',
        judgeModel: 'glm-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high' },
          { candidateId: 'solver-1', rank: 2, confidence: 'medium' },
        ],
        poolSize: 2,
        indexMapping: ['solver-0', 'solver-1'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];
    
    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);
    
    expect(result.winnerCandidateId).toBe('solver-0');
    expect(result.confidence).toBe('high');
    expect(result.scores[0].avgNormalizedRank).toBe(0); // Both ranks are 1 → normalized 0
    expect(result.totalUsage.inputTokens).toBe(200);
    expect(result.totalUsage.outputTokens).toBe(100);
  });
  
  it('should apply confidence penalty', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'B' },
    ];
    
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'high' },
        ],
        poolSize: 1,
        indexMapping: ['solver-0'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];
    
    const resultWithPenalty = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.SOME_FAILURES);
    
    // High confidence (0.9) * 0.85 = 0.765 → still high
    expect(resultWithPenalty.confidenceScore).toBeLessThan(0.9);
    expect(resultWithPenalty.confidenceScore).toBeGreaterThan(0.7);
  });
  
  it('should use tiebreakers when ranks are equal', () => {
    const candidates: CandidateInfo[] = [
      { id: 'solver-0', solverBackend: 'claude-code', content: 'A' },
      { id: 'solver-1', solverBackend: 'codex', content: 'B' },
    ];
    
    // Both candidates ranked #1 by their respective judge
    // solver-1 has higher confidence → should win tiebreaker
    const judgeResults: JudgePoolResult[] = [
      {
        judgeBackend: 'codex',
        judgeModel: 'gpt-5.2',
        rankings: [
          { candidateId: 'solver-0', rank: 1, confidence: 'medium' },
        ],
        poolSize: 1,
        indexMapping: ['solver-0'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      {
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        rankings: [
          { candidateId: 'solver-1', rank: 1, confidence: 'high' },
        ],
        poolSize: 1,
        indexMapping: ['solver-1'],
        usage: { inputTokens: 100, outputTokens: 50 },
      },
    ];
    
    const result = aggregateJudgeResults(judgeResults, candidates, CONFIDENCE_PENALTY.NONE);
    
    // Both have avgNormalizedRank = 0, both have judgeCount = 1
    // solver-1 has higher confidence → wins
    expect(result.winnerCandidateId).toBe('solver-1');
  });
});

// Helper to create mock JudgePoolResult
function mockJudgePoolResult(backend: string): JudgePoolResult {
  return {
    judgeBackend: backend,
    judgeModel: 'test-model',
    rankings: [
      { candidateId: 'solver-0', rank: 1, confidence: 'high' },
    ],
    poolSize: 1,
    indexMapping: ['solver-0'],
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}
