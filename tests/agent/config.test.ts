import { describe, expect, test } from 'bun:test';
import { parseConfigFile, isValidReasoning, isValidSandbox, toCodexSandbox, parseSandboxMode, resolveModel, resolveBackendModel } from '../../src/agent/config';

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

describe('resolveBackendModel', () => {
  describe('alias resolution without explicit backend', () => {
    test('resolves opus alias to claude-code backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'opus',
        fallbackBackend: 'codex',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.fromAlias).toBe(true);
    });

    test('resolves sonnet alias to claude-code backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'sonnet',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.fromAlias).toBe(true);
    });

    test('resolves gpt alias to codex backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gpt',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5.2');
      expect(result.fromAlias).toBe(true);
    });

    test('resolves gemini-pro alias to gemini-cli backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gemini-pro',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.fromAlias).toBe(true);
    });

    test('resolves gemini-flash alias to gemini-cli backend', () => {
      const result = resolveBackendModel({
        explicitModel: 'gemini-flash',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-flash-preview');
      expect(result.fromAlias).toBe(true);
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
      expect(result.fromAlias).toBe(false);
    });

    test('treats sonnet as literal model when backend is explicit', () => {
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
        explicitModel: 'sonnet',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('sonnet');
      expect(result.fromAlias).toBe(false);
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
      expect(result.fromAlias).toBe(false);
    });

    test('defaults to codex when no fallback and unknown model', () => {
      const result = resolveBackendModel({
        explicitModel: 'some-custom-model',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('some-custom-model');
      expect(result.fromAlias).toBe(false);
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
    });

    test('resolves fallback model alias when no backend specified', () => {
      const result = resolveBackendModel({
        fallbackModel: 'opus',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.fromAlias).toBe(true);
    });

    test('does not resolve fallback model alias when backend is specified', () => {
      const result = resolveBackendModel({
        fallbackBackend: 'codex',
        fallbackModel: 'opus',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('opus');
      expect(result.fromAlias).toBe(false);
    });
  });

  describe('no model specified', () => {
    test('uses backend default model', () => {
      const result = resolveBackendModel({
        fallbackBackend: 'claude-code',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('opus');
      expect(result.fromAlias).toBe(false);
    });

    test('uses explicit backend default model', () => {
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
      });
      expect(result.backend).toBe('gemini-cli');
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.fromAlias).toBe(false);
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
      expect(result.fromAlias).toBe(true);
    });
  });

  describe('unknown backend handling', () => {
    test('falls back to global MODEL for unknown backend', () => {
      const result = resolveBackendModel({
        explicitBackend: 'unknown-backend',
        globalConfig: {
          model: 'fallback-model',
        },
      });
      expect(result.backend).toBe('unknown-backend');
      expect(result.model).toBe('fallback-model');
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
      expect(result.fromAlias).toBe(true);
    });

    test('handles mixed case alias', () => {
      const result = resolveBackendModel({
        explicitModel: 'Sonnet',
      });
      expect(result.backend).toBe('claude-code');
      expect(result.model).toBe('sonnet');
      expect(result.fromAlias).toBe(true);
    });
  });
});
