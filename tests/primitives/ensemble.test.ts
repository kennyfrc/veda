import { describe, expect, test, mock } from 'bun:test';
import { createEnsemble, createStringEnsemble } from '../../src/primitives/ensemble';
import { MajorityVote, FirstSuccess } from '../../src/primitives/aggregators';
import type { Backend, Message, RunOptions } from '../../src/backend';
import type { Solver } from '../../src/primitives';

// Create a mock solver that returns a fixed response
function createMockSolver(id: string, response: string, shouldFail = false): Solver {
  const mockBackend: Backend = {
    name: id,
    command: id,
    systemPromptFile: undefined,
    run: mock(async function* (options: RunOptions): AsyncIterable<Message> {
      if (shouldFail) {
        throw new Error('Solver failed');
      }
      yield { type: 'init', sessionId: `session-${id}` };
      yield { type: 'text', content: response };
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
    }),
    resume: mock(async function* () {}),
    isAvailable: mock(async () => true),
  };

  return {
    id,
    backend: mockBackend,
    systemPrompt: 'test',
    config: {},
    run: mockBackend.run,
  };
}

describe('createEnsemble', () => {
  test('runs all solvers in parallel', async () => {
    const solvers = [
      createMockSolver('s1', 'yes'),
      createMockSolver('s2', 'yes'),
      createMockSolver('s3', 'no'),
    ];

    const ensemble = createStringEnsemble({
      name: 'test-ensemble',
      solvers,
      aggregator: MajorityVote,
    });

    const result = await ensemble.run('What is the answer?');
    
    expect(result.candidates.length).toBe(3);
    expect(result.selected).toBe('yes');
    expect(result.confidence).toBeCloseTo(2/3);
  });

  test('handles solver errors gracefully', async () => {
    const solvers = [
      createMockSolver('s1', 'answer'),
      createMockSolver('s2', '', true), // This one fails
      createMockSolver('s3', 'answer'),
    ];

    const ensemble = createStringEnsemble({
      name: 'test-ensemble',
      solvers,
      aggregator: MajorityVote,
    });

    const result = await ensemble.run('Test prompt');
    
    // Only 2 successful candidates
    expect(result.candidates.length).toBe(2);
    expect(result.selected).toBe('answer');
    expect(result.confidence).toBe(1);
  });

  test('returns empty when all solvers fail', async () => {
    const solvers = [
      createMockSolver('s1', '', true),
      createMockSolver('s2', '', true),
    ];

    const ensemble = createStringEnsemble({
      name: 'test-ensemble',
      solvers,
      aggregator: FirstSuccess,
    });

    const result = await ensemble.run('Test prompt');
    
    expect(result.candidates.length).toBe(0);
    expect(result.selected).toBe('');
    expect(result.confidence).toBe(0);
  });

  test('combines usage stats from all solvers', async () => {
    const solvers = [
      createMockSolver('s1', 'a'),
      createMockSolver('s2', 'b'),
      createMockSolver('s3', 'c'),
    ];

    const ensemble = createStringEnsemble({
      name: 'test-ensemble',
      solvers,
      aggregator: FirstSuccess,
    });

    const result = await ensemble.run('Test');
    
    // Each solver uses 10 input, 5 output
    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.outputTokens).toBe(15);
  });
});
