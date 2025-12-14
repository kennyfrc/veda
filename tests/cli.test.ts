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

    test('parses multi-word prompt', () => {
      const result = parseArgs(['bun', 'script', 'explain', 'the', 'code']);
      expect(result.prompt).toBe('explain the code');
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

    test('parses resume command', () => {
      const result = parseArgs(['bun', 'script', 'resume', 'follow', 'up']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBe('follow up');
    });

    test('parses resume without prompt', () => {
      const result = parseArgs(['bun', 'script', 'resume']);
      expect(result.command).toBe('resume');
      expect(result.prompt).toBeUndefined();
    });

    test('parses deep command', () => {
      const result = parseArgs(['bun', 'script', 'deep', 'solve', 'this']);
      expect(result.command).toBe('deep');
      expect(result.prompt).toBe('solve this');
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
});
