import { describe, test, expect } from 'bun:test';
import type { DeepThinkCheckpointData, DeepThinkTrace } from '../../src/pipelines/deep-think';

describe('DeepThink Resume', () => {
  // Helper to create a minimal trace for testing
  function createTestTrace(): DeepThinkTrace {
    return {
      trace_version: 2,
      prompt: 'test prompt',
      options: {
        backend: 'codex',
        k: 3,
        verify: true,
      },
      solve: {
        candidates: [
          {
            id: 'solver-0-codex-gpt-5.2-analytical/test',
            module: { id: 'test', category: 'analytical', name: 'Test Module' },
            response: 'Answer from solver 1',
          },
          {
            id: 'solver-1-codex-gpt-5.2-creative/test2',
            module: { id: 'test2', category: 'creative', name: 'Test Module 2' },
            response: 'Answer from solver 2',
          },
        ],
      },
      judge: {
        selectedIndex: 0,
        selectedDisplayIndex: 1,
        confidence: 0.8,
        reasoning: 'Selected first because...',
      },
    };
  }

  describe('DeepThinkCheckpointData interface', () => {
    test('can represent checkpoint after solve stage', () => {
      const checkpoint: DeepThinkCheckpointData = {
        trace: createTestTrace(),
        status: 'partial',
        completedStage: 'solve',
        successfulCandidateIds: [
          'solver-0-codex-gpt-5.2-analytical/test',
          'solver-1-codex-gpt-5.2-creative/test2',
        ],
        usageAtCheckpoint: { inputTokens: 1000, outputTokens: 500 },
      };

      expect(checkpoint.completedStage).toBe('solve');
      expect(checkpoint.successfulCandidateIds.length).toBe(2);
    });

    test('can represent checkpoint after judge stage', () => {
      const checkpoint: DeepThinkCheckpointData = {
        trace: createTestTrace(),
        status: 'partial',
        completedStage: 'judge',
        failedStage: 'verify',
        error: 'API rate limit exceeded',
        successfulCandidateIds: [
          'solver-0-codex-gpt-5.2-analytical/test',
          'solver-1-codex-gpt-5.2-creative/test2',
        ],
        judgeSeed: 'test-seed-123',
        judgeIndexMapping: [1, 0],
        judgeSelectedIndex: 0,
        judgeSelectedDisplayIndex: 2,
        selectedCandidateId: 'solver-0-codex-gpt-5.2-analytical/test',
        usageAtCheckpoint: { inputTokens: 5000, outputTokens: 1500 },
      };

      expect(checkpoint.completedStage).toBe('judge');
      expect(checkpoint.failedStage).toBe('verify');
      expect(checkpoint.judgeSeed).toBe('test-seed-123');
    });

    test('can represent checkpoint after verify stage', () => {
      const trace = createTestTrace();
      trace.verify = {
        checks: [
          { id: '1', question: 'Is this correct?', targetClaim: 'claim 1' },
        ],
        results: [
          { checkId: '1', answer: 'Yes', verdict: 'supports', confidence: 0.9 },
        ],
      };

      const checkpoint: DeepThinkCheckpointData = {
        trace,
        status: 'partial',
        completedStage: 'verify',
        failedStage: 'revision',
        successfulCandidateIds: ['solver-0-codex-gpt-5.2-analytical/test'],
        judgeSeed: 'seed',
        judgeIndexMapping: [0],
        judgeSelectedIndex: 0,
        judgeSelectedDisplayIndex: 1,
        selectedCandidateId: 'solver-0-codex-gpt-5.2-analytical/test',
        verifyChecks: trace.verify.checks,
        partialVerifyResults: trace.verify.results as any,
        usageAtCheckpoint: { inputTokens: 10000, outputTokens: 3000 },
      };

      expect(checkpoint.completedStage).toBe('verify');
      expect(checkpoint.verifyChecks?.length).toBe(1);
      expect(checkpoint.partialVerifyResults?.length).toBe(1);
    });
  });

  describe('Stage order', () => {
    test('solve < judge < verify for resume logic', () => {
      const stageOrder: Record<string, number> = { solve: 1, judge: 2, verify: 3 };
      
      expect(stageOrder['solve']).toBeLessThan(stageOrder['judge']);
      expect(stageOrder['judge']).toBeLessThan(stageOrder['verify']);
      
      // Resume from solve should skip solve (>= 1)
      const resumeFromSolve = stageOrder['solve'];
      expect(resumeFromSolve >= 1).toBe(true); // skip solve
      expect(resumeFromSolve >= 2).toBe(false); // don't skip judge
      
      // Resume from judge should skip solve and judge (>= 2)
      const resumeFromJudge = stageOrder['judge'];
      expect(resumeFromJudge >= 1).toBe(true); // skip solve
      expect(resumeFromJudge >= 2).toBe(true); // skip judge
      expect(resumeFromJudge >= 3).toBe(false); // don't skip verify
    });
  });

  describe('Successful candidate reconstruction', () => {
    test('filters candidates by ID correctly', () => {
      const trace = createTestTrace();
      const successfulCandidateIds = ['solver-0-codex-gpt-5.2-analytical/test'];
      
      const candidateIdSet = new Set(successfulCandidateIds);
      const successfulCandidates = trace.solve.candidates
        .filter(c => candidateIdSet.has(c.id))
        .map(c => c.response);
      
      expect(successfulCandidates.length).toBe(1);
      expect(successfulCandidates[0]).toBe('Answer from solver 1');
    });

    test('reconstructs successfulToOutputsMap correctly', () => {
      const trace = createTestTrace();
      const successfulCandidateIds = [
        'solver-0-codex-gpt-5.2-analytical/test',
        'solver-1-codex-gpt-5.2-creative/test2',
      ];
      
      const candidateIdSet = new Set(successfulCandidateIds);
      const successfulToOutputsMap = new Map<number, number>();
      let successIdx = 0;
      for (let i = 0; i < trace.solve.candidates.length; i++) {
        if (candidateIdSet.has(trace.solve.candidates[i].id)) {
          successfulToOutputsMap.set(successIdx++, i);
        }
      }
      
      expect(successfulToOutputsMap.size).toBe(2);
      expect(successfulToOutputsMap.get(0)).toBe(0);
      expect(successfulToOutputsMap.get(1)).toBe(1);
    });
  });

  describe('Error checkpoint data', () => {
    test('can represent checkpoint with failure info', () => {
      const checkpoint: DeepThinkCheckpointData = {
        trace: createTestTrace(),
        status: 'partial',
        completedStage: 'judge',
        failedStage: 'verify',
        error: 'API rate limit exceeded',
        successfulCandidateIds: [
          'solver-0-codex-gpt-5.2-analytical/test',
        ],
        judgeSeed: 'test-seed-123',
        judgeIndexMapping: [0],
        judgeSelectedIndex: 0,
        judgeSelectedDisplayIndex: 1,
        selectedCandidateId: 'solver-0-codex-gpt-5.2-analytical/test',
        usageAtCheckpoint: { inputTokens: 5000, outputTokens: 1500 },
      };

      expect(checkpoint.completedStage).toBe('judge');
      expect(checkpoint.failedStage).toBe('verify');
      expect(checkpoint.error).toBe('API rate limit exceeded');
      expect(checkpoint.status).toBe('partial');
    });

    test('failedStage maps to valid stage types', () => {
      // failedStage can only be 'judge' | 'verify' | 'revision'
      // 'solve' failures happen before any checkpoint can be saved
      const validFailedStages: Array<'judge' | 'verify' | 'revision'> = ['judge', 'verify', 'revision'];
      
      for (const stage of validFailedStages) {
        const checkpoint: DeepThinkCheckpointData = {
          trace: createTestTrace(),
          status: 'partial',
          completedStage: stage === 'judge' ? 'solve' : stage === 'verify' ? 'judge' : 'verify',
          failedStage: stage,
          error: 'Test error',
          successfulCandidateIds: ['solver-0-codex-gpt-5.2-analytical/test'],
          usageAtCheckpoint: { inputTokens: 0, outputTokens: 0 },
        };
        
        expect(checkpoint.failedStage).toBe(stage);
      }
    });
  });

  describe('Partial verify resume', () => {
    test('checkpoint can store partial verify results', () => {
      const trace = createTestTrace();
      trace.verify = {
        checks: [
          { id: '1', question: 'Check 1?' },
          { id: '2', question: 'Check 2?' },
          { id: '3', question: 'Check 3?' },
        ],
        results: [
          { checkId: '1', answer: 'Yes', verdict: 'supports', confidence: 0.9 },
        ],
      };

      const checkpoint: DeepThinkCheckpointData = {
        trace,
        status: 'partial',
        completedStage: 'judge', // Last fully completed stage
        failedStage: 'verify',
        error: 'Check 2 failed due to timeout',
        successfulCandidateIds: ['solver-0-codex-gpt-5.2-analytical/test'],
        judgeSeed: 'seed',
        judgeIndexMapping: [0],
        judgeSelectedIndex: 0,
        judgeSelectedDisplayIndex: 1,
        selectedCandidateId: 'solver-0-codex-gpt-5.2-analytical/test',
        verifyChecks: trace.verify.checks,
        partialVerifyResults: trace.verify.results as any,
        usageAtCheckpoint: { inputTokens: 10000, outputTokens: 3000 },
      };

      expect(checkpoint.verifyChecks?.length).toBe(3);
      expect(checkpoint.partialVerifyResults?.length).toBe(1);
      expect(checkpoint.partialVerifyResults?.[0].checkId).toBe('1');
    });

    test('resume can identify remaining checks', () => {
      const verifyChecks = [
        { id: '1', question: 'Check 1?' },
        { id: '2', question: 'Check 2?' },
        { id: '3', question: 'Check 3?' },
      ];
      const partialVerifyResults = [
        { checkId: '1', answer: 'Yes', verdict: 'supports' as const, confidence: 0.9 },
      ];
      
      const completedIds = new Set(partialVerifyResults.map(r => r.checkId));
      const remainingChecks = verifyChecks.filter(c => !completedIds.has(c.id));
      
      expect(remainingChecks.length).toBe(2);
      expect(remainingChecks[0].id).toBe('2');
      expect(remainingChecks[1].id).toBe('3');
    });
  });
});
