import { describe, expect, test } from 'bun:test';
import { parseConfigFile, isValidReasoning, isValidSandbox, toCodexSandbox, parseSandboxMode, resolveModel } from '../../src/agent/config';

describe('parseConfigFile', () => {
  test('parses empty file', () => {
    const config = parseConfigFile('');
    expect(config).toEqual({});
  });

  test('parses basic config', () => {
    const content = `
MODEL="gpt-5.2"
REASONING="high"
PERSONA="navigator-plan"
BACKEND="claude"
`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-5.2');
    expect(config.reasoning).toBe('high');
    expect(config.persona).toBe('navigator-plan');
    expect(config.backend).toBe('claude');
  });

  test('handles DEFAULT_ prefix', () => {
    const content = `
DEFAULT_MODEL="gpt-4"
DEFAULT_REASONING="low"
`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-4');
    expect(config.reasoning).toBe('low');
  });

  test('ignores comments', () => {
    const content = `
# This is a comment
MODEL="gpt-5.2"
# Another comment
`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-5.2');
  });

  test('handles unquoted values', () => {
    const content = `MODEL=gpt-5.2`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-5.2');
  });

  test('handles single quotes', () => {
    const content = `MODEL='gpt-5.2'`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-5.2');
  });

  test('parses per-backend model keys', () => {
    const content = `
CLAUDE_CODE_MODEL=opus
CODEX_MODEL=gpt-4o
GEMINI_CLI_MODEL=gemini-2.5-pro
`;
    const config = parseConfigFile(content);
    expect(config.backendModels).toEqual({
      'claude-code': 'opus',
      'codex': 'gpt-4o',
      'gemini-cli': 'gemini-2.5-pro',
    });
  });

  test('separates global MODEL from per-backend models', () => {
    const content = `
MODEL=gpt-5.2
CLAUDE_CODE_MODEL=opus
`;
    const config = parseConfigFile(content);
    expect(config.model).toBe('gpt-5.2');
    expect(config.backendModels).toEqual({
      'claude-code': 'opus',
    });
  });
});

describe('isValidReasoning', () => {
  test('accepts valid levels', () => {
    expect(isValidReasoning('minimal')).toBe(true);
    expect(isValidReasoning('low')).toBe(true);
    expect(isValidReasoning('medium')).toBe(true);
    expect(isValidReasoning('high')).toBe(true);
    expect(isValidReasoning('xhigh')).toBe(true);
  });

  test('rejects invalid levels', () => {
    expect(isValidReasoning('invalid')).toBe(false);
    expect(isValidReasoning('maximum')).toBe(false);
    expect(isValidReasoning('')).toBe(false);
  });
});

describe('isValidSandbox', () => {
  test('accepts valid modes', () => {
    expect(isValidSandbox('read-only')).toBe(true);
    expect(isValidSandbox('workspace-write')).toBe(true);
    expect(isValidSandbox('full')).toBe(true);
  });

  test('rejects invalid modes', () => {
    expect(isValidSandbox('invalid')).toBe(false);
    expect(isValidSandbox('none')).toBe(false);
    expect(isValidSandbox('')).toBe(false);
  });
});

describe('toCodexSandbox', () => {
  test('maps read-only correctly', () => {
    expect(toCodexSandbox('read-only')).toBe('read-only');
  });

  test('maps workspace-write correctly', () => {
    expect(toCodexSandbox('workspace-write')).toBe('workspace-write');
  });

  test('maps full to danger-full-access', () => {
    expect(toCodexSandbox('full')).toBe('danger-full-access');
  });
});

describe('parseSandboxMode', () => {
  test('parses standard modes', () => {
    expect(parseSandboxMode('read-only')).toBe('read-only');
    expect(parseSandboxMode('workspace-write')).toBe('workspace-write');
    expect(parseSandboxMode('full')).toBe('full');
  });

  test('parses aliases', () => {
    expect(parseSandboxMode('readonly')).toBe('read-only');
    expect(parseSandboxMode('write')).toBe('workspace-write');
    expect(parseSandboxMode('danger-full-access')).toBe('full');
  });

  test('is case insensitive', () => {
    expect(parseSandboxMode('READ-ONLY')).toBe('read-only');
    expect(parseSandboxMode('Full')).toBe('full');
  });

  test('returns undefined for invalid input', () => {
    expect(parseSandboxMode('invalid')).toBeUndefined();
    expect(parseSandboxMode('')).toBeUndefined();
  });
});

describe('resolveModel', () => {
  test('returns explicit model when provided', () => {
    expect(resolveModel({
      backend: 'claude-code',
      explicitModel: 'opus',
    })).toBe('opus');
  });

  test('returns per-backend config override', () => {
    expect(resolveModel({
      backend: 'claude-code',
      globalConfig: {
        backendModels: { 'claude-code': 'haiku' },
      },
    })).toBe('haiku');
  });

  test('returns built-in default for claude-code', () => {
    expect(resolveModel({ backend: 'claude-code' })).toBe('opus');
  });

  test('returns built-in default for codex', () => {
    expect(resolveModel({ backend: 'codex' })).toBe('gpt-5.2');
  });

  test('returns built-in default for gemini-cli', () => {
    expect(resolveModel({ backend: 'gemini-cli' })).toBe('gemini-3-pro-preview');
  });

  test('explicit model takes precedence over config', () => {
    expect(resolveModel({
      backend: 'claude-code',
      explicitModel: 'opus',
      globalConfig: {
        backendModels: { 'claude-code': 'haiku' },
      },
    })).toBe('opus');
  });

  test('config takes precedence over built-in default', () => {
    expect(resolveModel({
      backend: 'codex',
      globalConfig: {
        backendModels: { 'codex': 'gpt-4o' },
      },
    })).toBe('gpt-4o');
  });

  test('returns undefined for unknown backend without global config', () => {
    expect(resolveModel({ backend: 'unknown' })).toBeUndefined();
  });

  test('falls back to global MODEL for unknown backend', () => {
    expect(resolveModel({
      backend: 'unknown',
      globalConfig: {
        model: 'fallback-model',
      },
    })).toBe('fallback-model');
  });

  test('built-in default takes precedence over global MODEL', () => {
    // For known backends, built-in default wins over global MODEL
    expect(resolveModel({
      backend: 'claude-code',
      globalConfig: {
        model: 'global-model',
      },
    })).toBe('opus');
  });
});
