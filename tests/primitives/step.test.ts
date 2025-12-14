import { describe, expect, test, mock } from 'bun:test';
import { createStep, createTextStep, combineUsage } from '../../src/primitives/step';
import type { Backend, Message, RunOptions } from '../../src/backend';
import type { Solver } from '../../src/primitives';

// Create a mock solver
function createMockSolver(response: string): Solver {
  const mockBackend: Backend = {
    name: 'mock',
    command: 'mock',
    systemPromptFile: undefined,
    run: mock(async function* (options: RunOptions): AsyncIterable<Message> {
      yield { type: 'init', sessionId: 'test-session-123' };
      yield { type: 'text', content: response };
      yield { type: 'done', usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 20 } };
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

describe('createStep', () => {
  test('executes solver and returns result', async () => {
    const solver = createMockSolver('The answer is 42');
    
    const step = createStep<string, number>({
      name: 'extract-number',
      solver,
      formatPrompt: (input) => `Extract number from: ${input}`,
      parseOutput: (messages) => {
        const text = messages.find(m => m.type === 'text')?.content ?? '';
        const match = text.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      },
    });

    const result = await step.run('some input');
    
    expect(result.output).toBe(42);
    expect(result.sessionId).toBe('test-session-123');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  test('passes context to formatPrompt', async () => {
    const solver = createMockSolver('result');
    
    let receivedInput: string | undefined;
    let receivedContext: unknown;
    
    const step = createStep<string, string>({
      name: 'test-step',
      solver,
      formatPrompt: (input, ctx) => {
        receivedInput = input;
        receivedContext = ctx;
        return input;
      },
      parseOutput: (messages) => messages.find(m => m.type === 'text')?.content ?? '',
    });

    await step.run('test input', { 
      originalTask: 'original', 
      priorSteps: [{ name: 'prev', output: 'data' }],
      additionalContext: 'extra'
    });
    
    expect(receivedInput).toBe('test input');
    expect(receivedContext).toEqual({
      originalTask: 'original',
      priorSteps: [{ name: 'prev', output: 'data' }],
      additionalContext: 'extra'
    });
  });
});

describe('createTextStep', () => {
  test('returns raw text output', async () => {
    const solver = createMockSolver('Hello, World!');
    
    const step = createTextStep({
      name: 'text-step',
      solver,
    });

    const result = await step.run('say hello');
    
    expect(result.output).toBe('Hello, World!');
  });
});

describe('combineUsage', () => {
  test('sums all usage fields', () => {
    const result = combineUsage([
      { inputTokens: 100, outputTokens: 50 },
      { inputTokens: 200, outputTokens: 100, cachedTokens: 30 },
      { inputTokens: 150, outputTokens: 75, costUsd: 0.05 },
    ]);
    
    expect(result.inputTokens).toBe(450);
    expect(result.outputTokens).toBe(225);
    expect(result.cachedTokens).toBe(30);
    expect(result.costUsd).toBe(0.05);
  });

  test('handles empty array', () => {
    const result = combineUsage([]);
    
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  test('handles all undefined optional fields', () => {
    const result = combineUsage([
      { inputTokens: 100, outputTokens: 50 },
      { inputTokens: 200, outputTokens: 100 },
    ]);
    
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(150);
    expect(result.cachedTokens).toBeUndefined();
    expect(result.costUsd).toBeUndefined();
  });
});
