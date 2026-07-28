import { describe, expect, test } from 'bun:test';
import {
  tokenizeArgv,
  resolveDeepStages,
  CliValidationError,
} from '../../src/cli/index';
import { resolveBackendModel } from '../../src/cli/resolve';
import type { GlobalConfig } from '../../src/agent/config';
import type { RawFlags } from '../../src/cli/types';

function flagsFrom(argvRest: string[]): RawFlags {
  return tokenizeArgv(['node', 'veda', ...argvRest]).flags;
}

function resolveSolver(flags: RawFlags, globalConfig?: GlobalConfig) {
  const baseResolved = resolveBackendModel({ globalConfig });
  const stages = resolveDeepStages({ flags, baseResolved, globalConfig });
  return stages.solver;
}

describe('resolveSolverConfig — listed mode', () => {
  test('aliases resolve to per-slot backend, model, and reasoning', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'sol,k3,fable', 't']);
    const solver = resolveSolver(flags);

    expect(solver.mode).toBe('listed');
    if (solver.mode !== 'listed') return;

    expect(solver.slots).toEqual([
      { backend: 'codex', model: 'gpt-5.6-sol', reasoning: 'max' },
      { backend: 'pi', model: 'pi/neuralwatt/kimi-k3', reasoning: 'high' },
      { backend: 'droid', model: 'claude-fable-5', reasoning: 'medium' },
    ]);
  });

  test('prefix-based model IDs resolve without an alias', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'claude-opus-4-5,gpt-5.3-codex', 't']);
    const solver = resolveSolver(flags);

    expect(solver.mode).toBe('listed');
    if (solver.mode !== 'listed') return;
    expect(solver.slots[0]).toMatchObject({ backend: 'claude-code', model: 'claude-opus-4-5' });
    expect(solver.slots[1]).toMatchObject({ backend: 'codex', model: 'gpt-5.3-codex' });
  });

  test('--solver-reasoning overrides per-slot alias hints', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'sol,k3', '--solver-reasoning', 'low', 't']);
    const solver = resolveSolver(flags);

    if (solver.mode !== 'listed') throw new Error('expected listed mode');
    expect(solver.slots.map(s => s.reasoning)).toEqual(['low', 'low']);
  });

  test('base -r overrides per-slot alias hints', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'sol,k3', '-r', 'high', 't']);
    const solver = resolveSolver(flags);

    if (solver.mode !== 'listed') throw new Error('expected listed mode');
    expect(solver.slots.map(s => s.reasoning)).toEqual(['high', 'high']);
  });

  test('unknown model entry fails loudly', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'sol,definitely-not-a-model', 't']);
    expect(() => resolveSolver(flags)).toThrow(CliValidationError);
    try {
      resolveSolver(flags);
    } catch (e) {
      expect((e as CliValidationError).code).toBe('UNKNOWN_MODEL');
    }
  });

  test('config DEEP_SOLVER_MODELS activates listed mode', () => {
    const flags = flagsFrom(['deep', 't']);
    const globalConfig = { deep: { solverModels: ['sol', 'k3'] } } as GlobalConfig;
    const solver = resolveSolver(flags, globalConfig);

    expect(solver.mode).toBe('listed');
    if (solver.mode !== 'listed') return;
    expect(solver.slots).toHaveLength(2);
    expect(solver.slots[0].backend).toBe('codex');
    expect(solver.slots[1].backend).toBe('pi');
  });

  test('explicit CLI distribution suppresses config solverModels', () => {
    const flags = flagsFrom(['deep', '--distribute-solvers', '--solver-backends', 'codex', 't']);
    const globalConfig = { deep: { solverModels: ['sol', 'k3'] } } as GlobalConfig;
    const solver = resolveSolver(flags, globalConfig);

    expect(solver.mode).toBe('distributed');
  });

  test('-k must match config-provided list length', () => {
    const flags = flagsFrom(['deep', '-k', '4', 't']);
    const globalConfig = { deep: { solverModels: ['sol', 'k3'] } } as GlobalConfig;
    try {
      resolveSolver(flags, globalConfig);
      throw new Error('expected CliValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(CliValidationError);
      expect((e as CliValidationError).code).toBe('INVALID_K_VALUE');
      expect((e as Error).message).toContain('(2 models listed)');
    }
  });

  test('repeating an entry yields duplicate slots (explicit duplication)', () => {
    const flags = flagsFrom(['deep', '--solver-models', 'sol,sol,k3', 't']);
    const solver = resolveSolver(flags);

    if (solver.mode !== 'listed') throw new Error('expected listed mode');
    expect(solver.slots.map(s => s.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol', 'pi/neuralwatt/kimi-k3']);
  });
});
