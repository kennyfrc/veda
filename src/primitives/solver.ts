/**
 * Solver implementation - A configured LLM endpoint with a role.
 */

import type { Backend, Message } from '../backend';
import { getBackend } from '../backend';
import type { Solver, SolverConfig } from './types';

export interface CreateSolverOptions {
  /** Unique identifier for this solver */
  id?: string;
  /** Backend instance or name */
  backend: Backend | string;
  /** System prompt for this solver's role */
  systemPrompt: string;
  /** Additional configuration */
  config?: SolverConfig;
}

/**
 * Create a solver instance.
 */
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
          // Let backend use its default model if none specified
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
  /** Backend instances or names */
  backends: (Backend | string)[];
  /** System prompt for all solvers */
  systemPrompt: string;
  /** Additional configuration */
  config?: SolverConfig;
  /** Optional prompt variants for diversity */
  promptVariants?: string[];
}

/**
 * Create a pool of solvers for ensemble use.
 * Each solver uses a different backend for model diversity.
 */
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
