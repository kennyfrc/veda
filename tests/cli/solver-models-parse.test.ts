import { describe, expect, test } from 'bun:test';
import {
  tokenizeArgv,
  classifyCommand,
  validateApplicability,
  detectConflicts,
  CliValidationError,
} from '../../src/cli/index';

/** Tokenize argv for a deep-mode invocation. */
function parseDeep(argvRest: string[]) {
  const { flags, positionals } = tokenizeArgv(['node', 'veda', ...argvRest]);
  const parsed = classifyCommand(positionals, flags);
  return { flags, parsed, positionals };
}

describe('--solver-models parsing', () => {
  test('parses comma-separated model list with trimming', () => {
    const { flags } = parseDeep(['deep', '--solver-models', ' sol, k3 ,fable ', 'task']);
    expect(flags.solverModels).toEqual(['sol', 'k3', 'fable']);
  });

  test('classifies as deep mode with prompt', () => {
    const { parsed } = parseDeep(['deep', '--solver-models', 'sol,k3', 'task']);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBe('deep');
    expect(parsed.prompt).toBe('task');
  });

  test('rejects empty list', () => {
    expect(() => parseDeep(['deep', '--solver-models', ' , ,', 'task'])).toThrow(/at least one model entry/);
  });

  test('requires deep mode', () => {
    const { flags, parsed, positionals } = parseDeep(['--solver-models', 'sol,k3', 'task']);
    try {
      validateApplicability(parsed, flags, positionals);
      throw new Error('expected CliValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(CliValidationError);
      expect((e as CliValidationError).code).toBe('FLAG_NOT_APPLICABLE');
      expect((e as Error).message).toContain('--solver-models requires deep mode');
    }
  });
});

describe('--solver-models conflict guards', () => {
  function expectConflict(argvRest: string[], match: RegExp, code?: string) {
    const { flags } = parseDeep(argvRest);
    try {
      detectConflicts(flags);
      throw new Error('expected CliValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(CliValidationError);
      expect((e as Error).message).toMatch(match);
      if (code) expect((e as CliValidationError).code).toBe(code);
    }
  }

  test('rejects -m', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '-m', 'opus', 't'], /--solver-models with -m\/--model/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --solver-model', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--solver-model', 'opus', 't'], /--solver-models with --solver-model/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --solver-backend', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--solver-backend', 'codex', 't'], /--solver-models with --solver-backend/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --distribute-solvers alone', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--distribute-solvers', 't'], /--solver-models with --distribute-solvers/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --solver-backends', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--solver-backends', 'codex,pi', 't'], /--solver-models with --solver-backends/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --categories (no deterministic pairing)', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--categories', 'analytical', 't'], /--solver-models with --categories/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects --modules with mismatched length', () => {
    expectConflict(
      ['deep', '--solver-models', 'sol,k3,fable', '--modules', 'analytical/causal_analysis,systematic/systems_thinking', 't'],
      /--modules count \(2\) must match --solver-models count \(3\)/,
      'MUTUALLY_EXCLUSIVE_FLAGS',
    );
  });

  test('rejects --uniform and --low-count-modules (no sampling in listed mode)', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3', '--uniform', 't'], /--solver-models with --uniform/, 'MUTUALLY_EXCLUSIVE_FLAGS');
    expectConflict(['deep', '--solver-models', 'sol,k3', '--low-count-modules', 't'], /--solver-models with --low-count-modules/, 'MUTUALLY_EXCLUSIVE_FLAGS');
  });

  test('rejects -k that disagrees with list length', () => {
    expectConflict(['deep', '--solver-models', 'sol,k3,fable', '-k', '4', 't'], /-k 4 conflicts with --solver-models \(3 models listed\)/, 'INVALID_K_VALUE');
  });

  test('rejects more than 12 entries', () => {
    const many = Array.from({ length: 13 }, (_, i) => `m${i}`).join(',');
    expectConflict(['deep', '--solver-models', many, 't'], /at most 12 entries/, 'INVALID_K_VALUE');
  });

  test('accepts zip with equal-length --modules', () => {
    const { flags } = parseDeep(['deep', '--solver-models', 'sol,k3', '--modules', 'analytical/causal_analysis,systematic/systems_thinking', 't']);
    expect(() => detectConflicts(flags)).not.toThrow();
  });

  test('accepts -k equal to list length', () => {
    const { flags } = parseDeep(['deep', '--solver-models', 'sol,k3', '-k', '2', 't']);
    expect(() => detectConflicts(flags)).not.toThrow();
  });

  test('accepts plain listed mode', () => {
    const { flags } = parseDeep(['deep', '--solver-models', 'sol,k3,fable', 't']);
    expect(() => detectConflicts(flags)).not.toThrow();
  });
});
