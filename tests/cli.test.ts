import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { parseArgs } from '../src/cli';

describe('parseArgs', () => {
  const originalEnv = process.env.VEDA_SESSION;
  
  beforeEach(() => {
    delete process.env.VEDA_SESSION;
  });
  
  afterEach(() => {
    if (originalEnv) {
      process.env.VEDA_SESSION = originalEnv;
    }
  });

  describe('basic parsing', () => {
    test('parses simple prompt', () => {
      const result = parseArgs(['bun', 'script', 'hello world']);
      expect(result.command).toBe('hello world');
      expect(result.prompt).toBe('hello world');
    });

    test('rejects multi-word unquoted prompt (returns undefined for validation to reject)', () => {
      const result = parseArgs(['bun', 'script', 'explain', 'the', 'code']);
      // Multiple positionals no longer get joined; validation will reject this
      expect(result.prompt).toBeUndefined();
    });

    test('returns undefined prompt when empty', () => {
      const result = parseArgs(['bun', 'script']);
      expect(result.prompt).toBeUndefined();
    });
  });

  describe('flags', () => {
    test('parses -S/--session flag', () => {
      const result = parseArgs(['bun', 'script', '-S', 'my-session', 'hello']);
      expect(result.options.session).toBe('my-session');
      expect(result.prompt).toBe('hello');
    });

    test('parses -b/--backend flag', () => {
      const result = parseArgs(['bun', 'script', '-b', 'claude', 'hello']);
      expect(result.options.backend).toBe('claude');
    });

    test('parses multiple -f flags', () => {
      const result = parseArgs(['bun', 'script', '-f', 'one.ts', '-f', 'two.ts', 'hello']);
      expect(result.options.files).toEqual(['one.ts', 'two.ts']);
    });

    test('parses boolean flags', () => {
      const result = parseArgs(['bun', 'script', '--no-sel', '--json', 'hello']);
      expect(result.options.noSel).toBe(true);
      expect(result.options.json).toBe(true);
    });

    test('parses --deep flag', () => {
      const result = parseArgs(['bun', 'script', '--deep', 'hello']);
      expect(result.options.deep).toBe(true);
    });
  });

  describe('-- separator', () => {
    test('treats everything after -- as literal prompt', () => {
      const result = parseArgs(['bun', 'script', '--', '-S', 'not-a-flag', 'prompt']);
      expect(result.command).toBe('prompt');
      expect(result.prompt).toBe('-S not-a-flag prompt');
      expect(result.options.session).toBe('default');
    });

    test('options before -- are still parsed', () => {
      const result = parseArgs(['bun', 'script', '-S', 'my-session', '--', '--explain', 'this']);
      expect(result.options.session).toBe('my-session');
      expect(result.prompt).toBe('--explain this');
    });

    test('empty after -- returns undefined prompt', () => {
      const result = parseArgs(['bun', 'script', '-S', 'test', '--']);
      expect(result.prompt).toBeUndefined();
    });

    test('preserves resume command with -- separator', () => {
      const result = parseArgs(['bun', 'script', 'resume', '--', '-S', 'not-a-flag']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBe('-S not-a-flag');
    });

    test('preserves deep command with -- separator', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--', '--explain', 'this']);
      expect(result.command).toBe('deep');
      expect(result.prompt).toBe('--explain this');
    });
  });

  describe('commands', () => {
    test('parses sel command', () => {
      const result = parseArgs(['bun', 'script', 'sel', 'add', 'file.ts']);
      expect(result.command).toBe('sel');
      expect(result.subcommand).toBe('add');
      expect(result.args).toEqual(['file.ts']);
    });

    test('parses selection alias', () => {
      const result = parseArgs(['bun', 'script', 'selection', 'ls']);
      expect(result.command).toBe('selection');
      expect(result.subcommand).toBe('ls');
    });

    test('parses resume command with quoted prompt', () => {
      const result = parseArgs(['bun', 'script', 'resume', 'follow up']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBe('follow up');
    });

    test('rejects resume command with unquoted multi-word prompt (returns undefined)', () => {
      const result = parseArgs(['bun', 'script', 'resume', 'follow', 'up']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBeUndefined();
    });

    test('parses resume without prompt', () => {
      const result = parseArgs(['bun', 'script', 'resume']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBeUndefined();
    });

    test('parses deep command with quoted prompt', () => {
      const result = parseArgs(['bun', 'script', 'deep', 'solve this']);
      expect(result.command).toBe('deep');
      expect(result.prompt).toBe('solve this');
    });

    test('rejects deep command with unquoted multi-word prompt (returns undefined)', () => {
      const result = parseArgs(['bun', 'script', 'deep', 'solve', 'this']);
      expect(result.command).toBe('deep');
      expect(result.prompt).toBeUndefined();
    });
  });

  describe('environment variables', () => {
    test('uses VEDA_SESSION env if set', () => {
      process.env.VEDA_SESSION = 'env-session';
      const result = parseArgs(['bun', 'script', 'hello']);
      expect(result.options.session).toBe('env-session');
    });

    test('CLI flag overrides VEDA_SESSION env', () => {
      process.env.VEDA_SESSION = 'env-session';
      const result = parseArgs(['bun', 'script', '-S', 'cli-session', 'hello']);
      expect(result.options.session).toBe('cli-session');
    });
  });

  describe('validation', () => {
    test('throws on invalid session ID', () => {
      expect(() => parseArgs(['bun', 'script', '-S', '../invalid', 'hello'])).toThrow();
    });

    test('throws on flag without value', () => {
      expect(() => parseArgs(['bun', 'script', '-S'])).toThrow('requires a value');
    });
  });

  describe('per-stage deep mode flags', () => {
    test('parses --solver-backend flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--solver-backend', 'claude-code', 'hello']);
      expect(result.options.solverBackend).toBe('claude-code');
    });

    test('parses --solver-model flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--solver-model', 'opus', 'hello']);
      expect(result.options.solverModel).toBe('opus');
    });

    test('parses --judge-backend flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--judge-backend', 'codex', 'hello']);
      expect(result.options.judgeBackend).toBe('codex');
    });

    test('parses --judge-model flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--judge-model', 'gpt', 'hello']);
      expect(result.options.judgeModel).toBe('gpt');
    });

    test('parses --verifier-backend flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--verifier-backend', 'droid', 'hello']);
      expect(result.options.verifierBackend).toBe('droid');
    });

    test('parses --verifier-model flag', () => {
      const result = parseArgs(['bun', 'script', 'deep', '--verifier-model', 'glm-5.2', 'hello']);
      expect(result.options.verifierModel).toBe('glm-5.2');
    });

    test('parses all per-stage flags together', () => {
      const result = parseArgs([
        'bun', 'script', 'deep',
        '--solver-backend', 'claude-code',
        '--solver-model', 'sonnet',
        '--judge-backend', 'codex',
        '--judge-model', 'gpt',
        '--verifier-backend', 'droid',
        '--verifier-model', 'glm-5.2',
        'solve this problem',
      ]);
      expect(result.options.solverBackend).toBe('claude-code');
      expect(result.options.solverModel).toBe('sonnet');
      expect(result.options.judgeBackend).toBe('codex');
      expect(result.options.judgeModel).toBe('gpt');
      expect(result.options.verifierBackend).toBe('droid');
      expect(result.options.verifierModel).toBe('glm-5.2');
      expect(result.prompt).toBe('solve this problem');
    });

    test('per-stage flags work with global -b and -m', () => {
      const result = parseArgs([
        'bun', 'script', 'deep',
        '-b', 'codex',
        '-m', 'gpt',
        '--judge-model', 'opus',
        'hello',
      ]);
      expect(result.options.backend).toBe('codex');
      expect(result.options.model).toBe('gpt');
      expect(result.options.judgeModel).toBe('opus');
    });

    test('throws on per-stage flag without value', () => {
      expect(() => parseArgs(['bun', 'script', 'deep', '--solver-model'])).toThrow('requires a value');
      expect(() => parseArgs(['bun', 'script', 'deep', '--judge-backend'])).toThrow('requires a value');
      expect(() => parseArgs(['bun', 'script', 'deep', '--verifier-model'])).toThrow('requires a value');
    });
  });
});
