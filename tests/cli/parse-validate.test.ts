import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { 
  tokenizeArgv, 
  classifyCommand,
  validateApplicability,
  detectConflicts,
  detectConfigConflicts,
  resolveBackendModel,
  CliValidationError,
  parseAndValidate,
} from '../../src/cli/index';

describe('tokenizeArgv', () => {
  const originalEnv = process.env.VEDA_SESSION;
  
  beforeEach(() => {
    delete process.env.VEDA_SESSION;
  });
  
  afterEach(() => {
    if (originalEnv) {
      process.env.VEDA_SESSION = originalEnv;
    }
  });
  
  test('parses flags with values', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '-S', 'my-session', '-b', 'codex', 'hello']);
    expect(flags.session).toBe('my-session');
    expect(flags.backend).toBe('codex');
  });
  
  test('parses boolean flags', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--json', '--no-verify', 'hello']);
    expect(flags.deep).toBe(true);
    expect(flags.json).toBe(true);
    expect(flags.noVerify).toBe(true);
  });
  
  test('parses multiple -f flags', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '-f', 'a.ts', '-f', 'b.ts', 'hello']);
    expect(flags.files).toEqual(['a.ts', 'b.ts']);
  });
  
  test('handles -- separator', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '-S', 'test', '--', '-b', 'not-a-flag']);
    expect(flags.session).toBe('test');
    expect(positionals).toEqual(['-b', 'not-a-flag']);
  });
  
  test('throws on flag without value', () => {
    expect(() => tokenizeArgv(['node', 'veda', '-S'])).toThrow(CliValidationError);
  });
  
  test('throws on invalid session ID', () => {
    expect(() => tokenizeArgv(['node', 'veda', '-S', '../invalid', 'hello'])).toThrow(CliValidationError);
  });
  
  test('parses --dry-run flag', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--dry-run', 'hello']);
    expect(flags.dryRun).toBe(true);
  });
  
  test('throws on unknown flag', () => {
    expect(() => tokenizeArgv(['node', 'veda', '--unknown-flag', 'hello'])).toThrow(CliValidationError);
    expect(() => tokenizeArgv(['node', 'veda', '--unknown-flag', 'hello'])).toThrow('Unknown flag: --unknown-flag');
  });
  
  test('suggests similar flag for typos', () => {
    // --solver-backend instead of --solver-backends
    try {
      tokenizeArgv(['node', 'veda', '--solver-backnd', 'codex', 'hello']);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliValidationError);
      expect((e as CliValidationError).suggestion).toBe('Did you mean --solver-backend?');
    }
  });
  
  test('throws on single-dash unknown flags', () => {
    expect(() => tokenizeArgv(['node', 'veda', '-x', 'hello'])).toThrow('Unknown flag: -x');
  });
  
  test('allows unknown-looking positionals after --', () => {
    const { positionals } = tokenizeArgv(['node', 'veda', '--', '--not-a-flag', 'hello']);
    expect(positionals).toEqual(['--not-a-flag', 'hello']);
  });
});

describe('classifyCommand', () => {
  test('classifies explicit deep command with single quoted prompt', () => {
    const { flags } = tokenizeArgv(['node', 'veda', 'deep', 'solve this']);
    const parsed = classifyCommand(['deep', 'solve this'], flags);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBe('deep');
    expect(parsed.prompt).toBe('solve this');
  });
  
  test('leaves deep prompt undefined for multiple positionals (validation will reject)', () => {
    const { flags } = tokenizeArgv(['node', 'veda', 'deep', 'solve', 'this']);
    const parsed = classifyCommand(['deep', 'solve', 'this'], flags);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBe('deep');
    expect(parsed.prompt).toBeUndefined();
  });
  
  test('classifies --deep flag as deep mode', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '--deep', 'solve', 'this']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBe('deep');
  });
  
  test('classifies sel command', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'sel', 'add', 'file.ts']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('sel');
    expect(parsed.subcommand).toBe('add');
    expect(parsed.args).toEqual(['file.ts']);
  });
  
  test('classifies resume command with single quoted prompt', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'resume', 'follow up']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('resume');
    expect(parsed.prompt).toBe('follow up');
  });
  
  test('leaves resume prompt undefined for multiple positionals (validation will reject)', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'resume', 'follow', 'up']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('resume');
    expect(parsed.prompt).toBeUndefined();
  });
  
  test('defaults to simple prompt with single positional', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'hello']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.prompt).toBe('hello');
  });
  
  test('leaves prompt undefined for multiple positionals (validation will reject)', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'hello', 'world']);
    const parsed = classifyCommand(positionals, flags);
    expect(parsed.command).toBe('prompt');
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.prompt).toBeUndefined();
  });
});

describe('validateApplicability', () => {
  test('allows deep-only flags in deep mode', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '--deep', '-k', '4', '--trace', 'out.yaml', 'solve']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).not.toThrow();
  });
  
  test('rejects deep-only flags in simple mode', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '-k', '4', 'hello']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(CliValidationError);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/requires deep mode/);
  });
  
  test('rejects --trace without deep mode', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '--trace', 'out.yaml', 'hello']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/requires deep mode/);
  });
  
  test('rejects --persona in deep mode', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '--deep', '-p', 'navigator-plan', 'solve']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/not used in deep mode/);
  });
  
  test('validates -k range', () => {
    const { flags: flags1, positionals: pos1 } = tokenizeArgv(['node', 'veda', '--deep', '-k', '0', 'solve']);
    const parsed1 = classifyCommand(pos1, flags1);
    expect(() => validateApplicability(parsed1, flags1, pos1)).toThrow(/must be an integer between 1 and 8/);
    
    const { flags: flags2, positionals: pos2 } = tokenizeArgv(['node', 'veda', '--deep', '-k', '9', 'solve']);
    const parsed2 = classifyCommand(pos2, flags2);
    expect(() => validateApplicability(parsed2, flags2, pos2)).toThrow(/must be an integer between 1 and 8/);
  });
  
  test('rejects missing prompt', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', '-b', 'codex']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/No prompt provided/);
  });
  
  test('rejects 2+ positionals for implicit prompt (AMBIGUOUS_PROMPT)', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'websearch', 'query']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(CliValidationError);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/Ambiguous prompt/);
  });
  
  test('AMBIGUOUS_PROMPT suggestion mentions quoting', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'explain', 'the', 'code']);
    const parsed = classifyCommand(positionals, flags);
    try {
      validateApplicability(parsed, flags, positionals);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliValidationError);
      expect((e as CliValidationError).code).toBe('AMBIGUOUS_PROMPT');
      expect((e as CliValidationError).suggestion).toContain('veda "your prompt here"');
    }
  });
  
  test('allows single positional for implicit prompt', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'hello']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).not.toThrow();
  });
  
  test('AMBIGUOUS_PROMPT applies to deep command with multiple unquoted words', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'deep', 'solve', 'this', 'problem']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/Ambiguous prompt/);
  });
  
  test('deep command with single quoted prompt is allowed', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'deep', 'solve this problem']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).not.toThrow();
  });
  
  test('AMBIGUOUS_PROMPT applies to resume command with multiple unquoted words', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'resume', 'follow', 'up']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).toThrow(/Ambiguous prompt/);
  });
  
  test('resume command with single quoted prompt is allowed', () => {
    const { flags, positionals } = tokenizeArgv(['node', 'veda', 'resume', 'follow up']);
    const parsed = classifyCommand(positionals, flags);
    expect(() => validateApplicability(parsed, flags, positionals)).not.toThrow();
  });
});

describe('detectConflicts', () => {
  test('rejects --no-verify with --force-verify', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--no-verify', '--force-verify', 'solve']);
    expect(() => detectConflicts(flags)).toThrow(CliValidationError);
    expect(() => detectConflicts(flags)).toThrow(/Cannot use --no-verify and --force-verify together/);
  });
  
  test('rejects --solver-backend with --distribute-solvers', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--solver-backend', 'codex', '--distribute-solvers', 'solve']);
    expect(() => detectConflicts(flags)).toThrow(/Cannot use --solver-backend and --distribute-solvers together/);
  });
  
  test('allows --no-verify alone', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--no-verify', 'solve']);
    expect(() => detectConflicts(flags)).not.toThrow();
  });
  
  test('rejects --solver-backends without --distribute-solvers', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--solver-backends', 'gemini-cli,codex', 'solve']);
    expect(() => detectConflicts(flags)).toThrow(/--solver-backends requires --distribute-solvers/);
  });
  
  test('allows --solver-backends with --distribute-solvers', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--distribute-solvers', '--solver-backends', 'gemini-cli,codex', 'solve']);
    expect(() => detectConflicts(flags)).not.toThrow();
  });
});

describe('detectConfigConflicts', () => {
  test('rejects --solver-backend when config enables distributeSolvers', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--solver-backend', 'codex', 'solve']);
    const config = { deep: { distributeSolvers: true } };
    expect(() => detectConfigConflicts(flags, config)).toThrow(CliValidationError);
    expect(() => detectConfigConflicts(flags, config)).toThrow(/--solver-backend is ignored when distributeSolvers is enabled in config/);
  });
  
  test('allows --solver-backend when config does not enable distributeSolvers', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--solver-backend', 'codex', 'solve']);
    const config = { deep: { distributeSolvers: false } };
    expect(() => detectConfigConflicts(flags, config)).not.toThrow();
  });
  
  test('allows --solver-backend when no deep config exists', () => {
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--solver-backend', 'codex', 'solve']);
    expect(() => detectConfigConflicts(flags, {})).not.toThrow();
    expect(() => detectConfigConflicts(flags, undefined)).not.toThrow();
  });
  
  test('allows --distribute-solvers flag to override config conflict', () => {
    // If user explicitly passes --distribute-solvers, they are in control
    // The existing detectConflicts will catch --solver-backend + --distribute-solvers
    // detectConfigConflicts only fires when distributeSolvers=undefined (not passed via CLI)
    const { flags } = tokenizeArgv(['node', 'veda', '--deep', '--distribute-solvers', 'solve']);
    const config = { deep: { distributeSolvers: true } };
    // flags.distributeSolvers is true (not undefined), so config conflict doesn't apply
    expect(() => detectConfigConflicts(flags, config)).not.toThrow();
  });
});

describe('resolveBackendModel', () => {
  test('resolves alias to backend', () => {
    const result = resolveBackendModel({ explicitModel: 'opus' });
    expect(result.backend).toBe('claude-code');
    expect(result.model).toBe('opus');
    expect(result.source).toBe('alias');
  });
  
  test('infers backend from model prefix', () => {
    const result = resolveBackendModel({ explicitModel: 'gpt-5.2' });
    expect(result.backend).toBe('codex');
    expect(result.model).toBe('gpt-5.2');
    expect(result.source).toBe('prefix');
  });
  
  test('throws on alias/backend mismatch', () => {
    expect(() => resolveBackendModel({
      explicitBackend: 'codex',
      explicitModel: 'opus',
    })).toThrow(CliValidationError);
    expect(() => resolveBackendModel({
      explicitBackend: 'codex',
      explicitModel: 'opus',
    })).toThrow(/targets claude-code, conflicts with -b codex/);
  });
  
  test('throws on unknown model without backend', () => {
    expect(() => resolveBackendModel({
      explicitModel: 'unknown-model-xyz',
    })).toThrow(CliValidationError);
    expect(() => resolveBackendModel({
      explicitModel: 'unknown-model-xyz',
    })).toThrow(/Unknown model/);
  });
  
  test('uses explicit backend with default model', () => {
    const result = resolveBackendModel({ explicitBackend: 'gemini-cli' });
    expect(result.backend).toBe('gemini-cli');
    expect(result.model).toBe('gemini-3-pro-preview');
    expect(result.source).toBe('explicit');
  });
  
  test('falls back to codex/gpt-5.2', () => {
    const result = resolveBackendModel({});
    expect(result.backend).toBe('codex');
    expect(result.model).toBe('gpt-5.2');
    expect(result.source).toBe('default');
  });
});

describe('integration: parseAndValidate', () => {
  // These tests use the full pipeline
  
  test('parses simple prompt with single positional', async () => {
    const result = await parseAndValidate(['node', 'veda', 'hello world']);
    expect(result.command).toBe('prompt');
    if (result.command === 'prompt') {
      expect(result.mode).toBe('simple');
      if (result.mode === 'simple') {
        expect(result.config.prompt).toBe('hello world');
        expect(result.config.backend).toBe('codex');
      }
    }
  });
  
  test('parses deep mode with quoted prompt', async () => {
    const result = await parseAndValidate(['node', 'veda', 'deep', 'solve this']);
    expect(result.command).toBe('prompt');
    if (result.command === 'prompt') {
      expect(result.mode).toBe('deep');
      if (result.mode === 'deep') {
        expect(result.config.prompt).toBe('solve this');
        expect(result.config.k).toBe(4);  // default
      }
    }
  });
  
  test('rejects deep mode with unquoted multi-word prompt', async () => {
    await expect(parseAndValidate(['node', 'veda', 'deep', 'solve', 'this']))
      .rejects.toThrow(/Ambiguous prompt/);
  });
  
  test('returns dry-run output', async () => {
    const result = await parseAndValidate(['node', 'veda', '--dry-run', '-m', 'opus', 'hello']);
    expect(result.command).toBe('dry-run');
    if (result.command === 'dry-run') {
      expect(result.resolved.backend.backend).toBe('claude-code');
      expect(result.resolved.backend.model).toBe('opus');
    }
  });
  
  test('rejects conflicting flags', async () => {
    await expect(parseAndValidate(['node', 'veda', '--deep', '--no-verify', '--force-verify', 'solve']))
      .rejects.toThrow(/Cannot use --no-verify and --force-verify together/);
  });
  
  test('rejects alias mismatch', async () => {
    await expect(parseAndValidate(['node', 'veda', '-b', 'codex', '-m', 'opus', 'hello']))
      .rejects.toThrow(/targets claude-code, conflicts with -b codex/);
  });
});
