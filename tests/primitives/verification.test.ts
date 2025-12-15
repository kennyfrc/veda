import { describe, expect, test, mock } from 'bun:test';
import { createVerification } from '../../src/primitives/verification';
import type { Backend, Message, RunOptions } from '../../src/backend';
import type { Solver, StepContext } from '../../src/primitives';

// Create a mock solver that returns specified content
function createMockSolver(responses: string[]): Solver {
  let callIndex = 0;
  
  const mockBackend: Backend = {
    name: 'mock',
    command: 'mock',
    systemPromptFile: undefined,
    run: mock(async function* (options: RunOptions): AsyncIterable<Message> {
      const response = responses[callIndex++] || 'default response';
      yield { type: 'init', sessionId: 'test' };
      yield { type: 'text', content: response };
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
    }),
    resume: mock(async function* () {}),
    isAvailable: mock(async () => true),
  };

  return {
    id: 'mock-solver',
    backend: mockBackend,
    systemPrompt: 'test',
    config: {},
    run: mockBackend.run,
  };
}

describe('createVerification', () => {
  describe('generateChecks', () => {
    test('parses valid XML checks', async () => {
      const solver = createMockSolver([`
<checks>
<check id="1">
<question>Is the calculation correct?</question>
<claim>2+2=4</claim>
</check>
<check id="2">
<question>Is the logic sound?</question>
</check>
</checks>
      `]);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
      });
      
      const context: StepContext = {
        originalTask: 'test task',
        priorSteps: [],
      };
      
      const result = await verification.generateChecks('test draft', context);
      
      expect(result.checks.length).toBe(2);
      expect(result.checks[0].id).toBe('1');
      expect(result.checks[0].question).toBe('Is the calculation correct?');
      expect(result.checks[0].targetClaim).toBe('2+2=4');
      expect(result.checks[1].id).toBe('2');
      expect(result.checks[1].targetClaim).toBeUndefined();
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
    });

    test('returns empty array for invalid XML', async () => {
      const solver = createMockSolver(['No valid checks here']);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
      });
      
      const result = await verification.generateChecks('draft', {
        originalTask: 'task',
        priorSteps: [],
      });
      
      expect(result.checks.length).toBe(0);
    });
  });

  describe('answerChecks', () => {
    test('parses verdict correctly', async () => {
      const solver = createMockSolver([
        '<answer>Yes, correct</answer><verdict>supports</verdict><confidence>high</confidence>',
        '<answer>No, wrong</answer><verdict>contradicts</verdict><confidence>low</confidence>',
      ]);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
        independent: true,  // Each check gets its own solver call
      });
      
      const result = await verification.answerChecks([
        { id: '1', question: 'Q1' },
        { id: '2', question: 'Q2' },
      ]);
      
      expect(result.results.length).toBe(2);
      expect(result.results[0].contradictsDraft).toBe(false);
      expect(result.results[0].confidence).toBe(0.9);
      expect(result.results[1].contradictsDraft).toBe(true);
      expect(result.results[1].confidence).toBe(0.5);
      expect(result.usage.inputTokens).toBe(20); // 2 calls × 10
      expect(result.usage.outputTokens).toBe(10); // 2 calls × 5
    });

    test('handles uncertain verdict', async () => {
      const solver = createMockSolver([
        '<answer>Maybe</answer><verdict>uncertain</verdict><confidence>medium</confidence>',
      ]);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
        independent: true,  // Each check gets its own solver call
      });
      
      const result = await verification.answerChecks([
        { id: '1', question: 'Q1' },
      ]);
      
      expect(result.results[0].contradictsDraft).toBe(false);
      expect(result.results[0].confidence).toBe(0.7);
    });
  });

  describe('revise', () => {
    test('returns unchanged when no contradictions', async () => {
      const solver = createMockSolver([]);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
      });
      
      const result = await verification.revise('original', [
        { checkId: '1', answer: 'ok', contradictsDraft: false, confidence: 0.9 },
      ]);
      
      expect(result.unchanged).toBe(true);
      expect(result.revised).toBe('original');
    });

    test('parses revision result correctly', async () => {
      const solver = createMockSolver([`
<revised>
Fixed content here
</revised>
<changes>
- Fixed typo
- Added clarification
</changes>
<conflicts>none</conflicts>
      `]);
      
      const verification = createVerification({
        type: 'reasoning',
        solver,
      });
      
      const result = await verification.revise('original', [
        { checkId: '1', answer: 'wrong', contradictsDraft: true, confidence: 0.9 },
      ]);
      
      expect(result.unchanged).toBe(false);
      expect(result.revised).toBe('Fixed content here');
      expect(result.changes).toContain('Fixed typo');
      expect(result.changes).toContain('Added clarification');
      expect(result.conflicts.length).toBe(0);
    });
  });
});
