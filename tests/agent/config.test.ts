import { describe, expect, test } from 'bun:test';
import { parseConfigFile, isValidReasoning, isValidSandbox, toCodexSandbox, parseSandboxMode, resolveModel, resolveBackendModel } from '../../src/agent/config';

describe('parseConfigFile', () => {
  test('parses empty file', () => {
    const config = parseConfigFile('');
    expect(config).toEqual({});
  });

  test('parses basic config', () => {
    const content = `
PERSONA="navigator-plan"
BACKEND="claude-code"
`;
    const config = parseConfigFile(content);
    expect(config.persona).toBe('navigator-plan');
    expect(config.backend).toBe('claude-code');
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

  test('parses per-backend reasoning keys', () => {
    const content = `
CLAUDE_CODE_REASONING=high
CODEX_REASONING=medium
GEMINI_CLI_REASONING=low
`;
    const config = parseConfigFile(content);
    expect(config.backendReasoning).toEqual({
      'claude-code': 'high',
      'codex': 'medium',
      'gemini-cli': 'low',
    });
  });

  test('parses mixed backend config', () => {
    const content = `
BACKEND=codex
CODEX_MODEL=gpt-5.2
CODEX_REASONING=high
CLAUDE_CODE_MODEL=opus
`;
    const config = parseConfigFile(content);
    expect(config.backend).toBe('codex');
    expect(config.backendModels).toEqual({
      'codex': 'gpt-5.2',
      'claude-code': 'opus',
    });
    expect(config.backendReasoning).toEqual({
      'codex': 'high',
    });
  });

  test('ignores comments', () => {
    const content = `
# This is a comment
BACKEND=codex
# Another comment
CODEX_MODEL=gpt-5.2
`;
    const config = parseConfigFile(content);
    expect(config.backend).toBe('codex');
    expect(config.backendModels?.['codex']).toBe('gpt-5.2');
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

  test('returns undefined for unknown backend', () => {
    expect(resolveModel({ backend: 'unknown' })).toBeUndefined();
  });

  test('uses per-backend config for unknown backend', () => {
    expect(resolveModel({
      backend: 'custom-backend',
      globalConfig: {
        backendModels: { 'custom-backend': 'custom-model' },
      },
    })).toBe('custom-model');
  });

  test('built-in default is used when no config', () => {
    // For known backends, built-in default is used
    expect(resolveModel({
      backend: 'claude-code',
    })).toBe('opus');
  });
});

describe('resolveBackendModel', () => {
  describe('alias resolution without explicit backend', () => {
    test('resolves opus alias to claude-code backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'opus',
        fallbackBackend: 'codex',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'opus' });
    });

    test('resolves sonnet alias to claude-code backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'sonnet',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'sonnet' });
    });

    test('resolves gpt alias to codex backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gpt',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5.2');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gpt' });
    });

    test('resolves gemini-pro alias to gemini-cli backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gemini-pro',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gemini-pro' });
    });

    test('resolves gemini-flash alias to gemini-cli backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gemini-flash',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-flash-preview');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gemini-flash' });
    });
  });

  describe('explicit backend disables alias mapping', () => {
    test('treats opus as literal model when backend is explicit', () => {
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'opus',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'explicit' });
    });

    test('treats sonnet as literal model when backend is explicit', () => {
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
        explicitModel: 'sonnet',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('sonnet');
      expect(result.source).toEqual({ kind: 'explicit' });
    });
  });

  describe('non-alias models use fallback backend', () => {
    test('uses fallback backend for unknown model', () => {
      const result = resolveBackendModel({
        explicitModel: 'gpt-4o',
        fallbackBackend: 'codex',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-4o');
      expect(result.source).toEqual({ kind: 'explicit' });
    });

    test('throws error for unknown model without explicit backend', () => {
      expect(() => resolveBackendModel({
        explicitModel: 'some-custom-model',
      })).toThrow(/Unknown model: 'some-custom-model'/);
    });
  });

  describe('fallback model behavior', () => {
    test('uses fallback model when no explicit model', () => {
      const result = resolveBackendModel({
        fallbackBackend: 'claude-code',
        fallbackModel: 'haiku',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('haiku');
      expect(result.source).toEqual({ kind: 'fallback' });
    });

    test('resolves fallback model alias when no backend specified', () => {
      const result = resolveBackendModel({
        fallbackModel: 'opus',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'opus' });
    });

    test('does not resolve fallback model alias when backend is specified', () => {
      const result = resolveBackendModel({
        fallbackBackend: 'codex',
        fallbackModel: 'opus',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'fallback' });
    });
  });

  describe('no model specified', () => {
    test('uses backend default model', () => {
      const result = resolveBackendModel({
        fallbackBackend: 'claude-code',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'default' });
    });

    test('uses explicit backend default model', () => {
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.source).toEqual({ kind: 'explicit' });
    });
  });

  describe('config overrides', () => {
    test('config per-backend overrides built-in default', () => {
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        globalConfig: {
          backendModels: { 'codex': 'gpt-4o' },
        },
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-4o');
    });

    test('explicit model takes precedence over config', () => {
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'gpt-5',
        globalConfig: {
          backendModels: { 'codex': 'gpt-4o' },
        },
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5');
    });

    test('alias model takes precedence over config on resolved backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'opus',
        globalConfig: {
          backendModels: { 'claude-code': 'haiku' },
        },
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'opus' });
    });
  });

  describe('unknown backend handling', () => {
    test('uses per-backend config for unknown backend', () => {
      const result = resolveBackendModel({
        explicitBackend: 'custom-backend',
        globalConfig: {
          backendModels: { 'custom-backend': 'custom-model' },
        },
      });
      expect(result.backend).toBe('custom-backend');
      expect(result.model).toBe('custom-model');
    });

    test('returns undefined model for unknown backend without config', () => {
      const result = resolveBackendModel({
        explicitBackend: 'unknown-backend',
      });
      expect(result.backend).toBe('unknown-backend');
      expect(result.model).toBeUndefined();
    });
  });

  describe('case insensitivity', () => {
    test('handles uppercase alias', () => {
      const result = resolveBackendModel({
        explicitModel: 'OPUS',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'opus' });
    });

    test('handles mixed case alias', () => {
      const result = resolveBackendModel({
        explicitModel: 'Sonnet',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'sonnet' });
    });
  });

  describe('edge cases', () => {
    test('handles alias with leading/trailing whitespace', () => {
      const result = resolveBackendModel({
        explicitModel: '  gemini-pro  ',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gemini-pro' });
    });

    test('handles alias with internal whitespace in mixed case', () => {
      const result = resolveBackendModel({
        explicitModel: '  GEMINI-PRO  ',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gemini-pro' });
    });

    test('handles empty string model - uses backend default', () => {
      const result = resolveBackendModel({
        explicitModel: '',
        fallbackBackend: 'codex',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5.2'); // Backend default
    });

    test('throws error for unknown model alias', () => {
      expect(() => resolveBackendModel({
        explicitModel: 'unknown-model',
      })).toThrow(/Unknown model: 'unknown-model'/);
    });

    test('allows unknown model when explicit backend is provided', () => {
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'unknown-model',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('unknown-model');
      expect(result.source).toEqual({ kind: 'explicit' });
    });
  });

  describe('CRITICAL: mismatched backend and alias', () => {
    test('explicit codex backend with gemini-pro alias treats as literal model', () => {
      // This documents the current behavior: when backend is explicit and
      // differs from alias backend, the model is treated as literal
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'gemini-pro', // Alias for gemini-cli
      });

      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gemini-pro'); // NOT gemini-3-pro-preview
      expect(result.source).toEqual({ kind: 'explicit' });
    });

    test('explicit claude-code backend with gpt alias treats as literal model', () => {
      const result = resolveBackendModel({
        explicitBackend: 'claude-code',
        explicitModel: 'gpt', // Alias for codex
      });

      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('gpt'); // NOT gpt-5.2
      expect(result.source).toEqual({ kind: 'explicit' });
    });
  });
});
