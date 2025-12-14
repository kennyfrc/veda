import { describe, expect, test } from 'bun:test';
import { parseConfigFile, isValidReasoning, isValidSandbox, toCodexSandbox, parseSandboxMode } from '../../src/agent/config';

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
