import type { Backend, Message } from '../backend';
import { getBackend } from '../backend';
import type { Solver, SolverConfig } from './types';

export interface CreateSolverOptions {
  id?: string;
  backend: Backend | string;
  systemPrompt: string;
  config?: SolverConfig;
}

export function createSolver(options: CreateSolverOptions): Solver {
  const backend = typeof options.backend === 'string'
    ? getBackend(options.backend)
    : options.backend;
  
  const id = options.id ?? `${backend.name}-${Date.now()}`;
  
  return {
    id,
    backend,
    systemPrompt: options.systemPrompt,
    config: options.config ?? {},
    
    async *run(prompt: string, context?: string): AsyncIterable<Message> {
      yield* backend.run({
        prompt,
        context,
        config: {
          model: options.config?.model ?? '',
          reasoning: options.config?.reasoning ?? 'medium',
          sandbox: options.config?.sandbox ?? 'read-only',
          systemPrompt: options.systemPrompt,
        },
        cwd: options.config?.cwd,
      });
    },
  };
}

export interface CreateSolverPoolOptions {
  backends: (Backend | string)[];
  systemPrompt: string;
  config?: SolverConfig;
  promptVariants?: string[];
}

export function createSolverPool(options: CreateSolverPoolOptions): Solver[] {
  const { backends, systemPrompt, config, promptVariants } = options;
  
  return backends.map((backend, i) => {
    const backendInstance = typeof backend === 'string' ? getBackend(backend) : backend;
    const variant = promptVariants?.[i] ?? systemPrompt;
    
    return createSolver({
      id: `pool-${backendInstance.name}-${i}`,
      backend: backendInstance,
      systemPrompt: variant,
      config,
    });
  });
}
