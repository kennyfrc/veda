import { describe, expect, test, mock } from 'bun:test';
import { createSolver, createSolverPool } from '../../src/primitives/solver';
import type { Backend, RunOptions } from '../../src/backend';

// Mock backend
function createMockBackend(name: string): Backend {
  return {
    name,
    command: name,
    systemPromptFile: undefined,
    run: mock(async function* (options: RunOptions) {
      yield { type: 'init', sessionId: 'test-session' };
      yield { type: 'text', content: 'test response' };
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } };
    }),
    resume: mock(async function* () {}),
    isAvailable: mock(async () => true),
  };
}

describe('createSolver', () => {
  test('uses empty model by default (lets backend use its default)', async () => {
    const backend = createMockBackend('test');
    const solver = createSolver({
      backend,
      systemPrompt: 'You are a test assistant.',
    });
    
    // Consume the generator
    const messages = [];
    for await (const msg of solver.run('hello')) {
      messages.push(msg);
    }
    
    // Check that run was called with empty model
    expect(backend.run).toHaveBeenCalled();
    const callArgs = (backend.run as any).mock.calls[0][0] as RunOptions;
    expect(callArgs.config.model).toBe('');
  });

  test('uses provided model if specified', async () => {
    const backend = createMockBackend('test');
    const solver = createSolver({
      backend,
      systemPrompt: 'You are a test assistant.',
      config: { model: 'custom-model' },
    });
    
    const messages = [];
    for await (const msg of solver.run('hello')) {
      messages.push(msg);
    }
    
    const callArgs = (backend.run as any).mock.calls[0][0] as RunOptions;
    expect(callArgs.config.model).toBe('custom-model');
  });

  test('passes system prompt to backend', async () => {
    const backend = createMockBackend('test');
    const solver = createSolver({
      backend,
      systemPrompt: 'Custom system prompt',
    });
    
    const messages = [];
    for await (const msg of solver.run('hello')) {
      messages.push(msg);
    }
    
    const callArgs = (backend.run as any).mock.calls[0][0] as RunOptions;
    expect(callArgs.config.systemPrompt).toBe('Custom system prompt');
  });
});

describe('createSolverPool', () => {
  test('creates solvers for each backend', () => {
    const backends = [
      createMockBackend('backend1'),
      createMockBackend('backend2'),
    ];
    
    const pool = createSolverPool({
      backends,
      systemPrompt: 'Shared prompt',
    });
    
    expect(pool.length).toBe(2);
    expect(pool[0].id).toBe('pool-backend1-0');
    expect(pool[1].id).toBe('pool-backend2-1');
  });

  test('uses prompt variants if provided', () => {
    const backends = [
      createMockBackend('backend1'),
      createMockBackend('backend2'),
    ];
    
    const pool = createSolverPool({
      backends,
      systemPrompt: 'Default prompt',
      promptVariants: ['Variant 1', 'Variant 2'],
    });
    
    expect(pool[0].systemPrompt).toBe('Variant 1');
    expect(pool[1].systemPrompt).toBe('Variant 2');
  });
});
