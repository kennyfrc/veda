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
DROID_MODEL=glm-5.2
`;
    const config = parseConfigFile(content);
    expect(config.backendModels).toEqual({
      'claude-code': 'opus',
      'codex': 'gpt-4o',
      'droid': 'glm-5.2',
    });
  });

  test('parses per-backend reasoning keys', () => {
    const content = `
CLAUDE_CODE_REASONING=high
CODEX_REASONING=medium
DROID_REASONING=low
`;
    const config = parseConfigFile(content);
    expect(config.backendReasoning).toEqual({
      'claude-code': 'high',
      'codex': 'medium',
      'droid': 'low',
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

  test('parses deep mode config', () => {
    const content = `
DEEP_DISTRIBUTE_SOLVERS=true
DEEP_SOLVER_BACKENDS=codex,claude-code
DEEP_JUDGE_BACKEND=codex
DEEP_JUDGE_MODEL=gpt-5.2
DEEP_JUDGE_REASONING=medium
DEEP_VERIFIER_BACKEND=claude-code
DEEP_VERIFIER_MODEL=claude-sonnet-4-20250514
DEEP_VERIFIER_REASONING=high
DEEP_REVISION_BACKEND=codex
DEEP_REVISION_MODEL=gpt-5.2
DEEP_REVISION_REASONING=high
`;
    const config = parseConfigFile(content);
    expect(config.deep).toBeDefined();
    expect(config.deep?.distributeSolvers).toBe(true);
    expect(config.deep?.solverBackends).toEqual(['codex', 'claude-code']);
    expect(config.deep?.judgeBackend).toBe('codex');
    expect(config.deep?.judgeModel).toBe('gpt-5.2');
    expect(config.deep?.judgeReasoning).toBe('medium');
    expect(config.deep?.verifierBackend).toBe('claude-code');
    expect(config.deep?.verifierModel).toBe('claude-sonnet-4-20250514');
    expect(config.deep?.verifierReasoning).toBe('high');
    expect(config.deep?.revisionBackend).toBe('codex');
    expect(config.deep?.revisionModel).toBe('gpt-5.2');
    expect(config.deep?.revisionReasoning).toBe('high');
  });

  test('parses deep mode with false distribute', () => {
    const content = `
DEEP_DISTRIBUTE_SOLVERS=false
`;
    const config = parseConfigFile(content);
    expect(config.deep?.distributeSolvers).toBe(false);
  });

  test('ignores invalid reasoning in deep config', () => {
    const content = `
DEEP_JUDGE_REASONING=invalid
DEEP_VERIFIER_REASONING=medium
`;
    const config = parseConfigFile(content);
    expect(config.deep?.judgeReasoning).toBeUndefined();
    expect(config.deep?.verifierReasoning).toBe('medium');
  });

  test('handles empty solver backends list', () => {
    const content = `
DEEP_SOLVER_BACKENDS=
`;
    const config = parseConfigFile(content);
    // Empty value doesn't match the regex, so solverBackends won't be set
    expect(config.deep?.solverBackends).toBeUndefined();
  });

  test('trims whitespace from solver backends', () => {
    const content = `
DEEP_SOLVER_BACKENDS=" codex , claude-code , droid "
`;
    const config = parseConfigFile(content);
    expect(config.deep?.solverBackends).toEqual(['codex', 'claude-code', 'droid']);
  });

  test('parses DEFAULT_SANDBOX', () => {
    const config = parseConfigFile(`
DEFAULT_SANDBOX="workspace-write"
`);
    expect(config.defaultSandbox).toBe('workspace-write');
  });

  test('ignores invalid DEFAULT_SANDBOX value', () => {
    const config = parseConfigFile(`
DEFAULT_SANDBOX="every-file"
`);
    expect(config.defaultSandbox).toBeUndefined();
  });

  test('parses MODEL_ALIASES into user aliases', () => {
    const config = parseConfigFile(`
MODEL_ALIASES="flash=pi/neuralwatt/deepseek-v4-flash"
`);
    expect(config.modelAliases).toEqual({
      flash: { backend: 'pi', model: 'pi/neuralwatt/deepseek-v4-flash' },
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

  test('returns built-in default for droid', () => {
    expect(resolveModel({ backend: 'droid' })).toBe('custom:Makora-GLM-5.2-NVFP4-9');
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
      expect(result.model).toBe('gpt-5.3-codex');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'gpt' });
    });

    test('resolves glm alias to pi backend with reasoning', () => {
      const result = resolveBackendModel({
        explicitModel: 'glm',
      });
      expect(result.backend).toBe('pi');
      expect(result.model).toBe('pi/makora/zai-org/GLM-5.2-NVFP4');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'glm' });
      expect(result.aliasReasoning).toBe('xhigh');
    });

    test('resolves sol alias to codex backend with reasoning', () => {
      const result = resolveBackendModel({
        explicitModel: 'sol',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5.6-sol');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'sol' });
      expect(result.aliasReasoning).toBe('max');
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
        explicitBackend: 'droid',
        explicitModel: 'sonnet',
      });
      expect(result.backend).toBe('droid');
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
      expect(result.source).toEqual({ kind: 'prefix' });
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
        explicitBackend: 'droid',
      });
      expect(result.backend).toBe('droid');
      expect(result.model).toBe('custom:Makora-GLM-5.2-NVFP4-9');
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
        explicitModel: '  glm  ',
      });
      expect(result.backend).toBe('pi');
      expect(result.model).toBe('pi/makora/zai-org/GLM-5.2-NVFP4');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'glm' });
    });

    test('handles alias with internal whitespace in mixed case', () => {
      const result = resolveBackendModel({
        explicitModel: '  SOL  ',
      });
      expect(result.backend).toBe('codex');
      expect(result.model).toBe('gpt-5.6-sol');
      expect(result.source).toEqual({ kind: 'alias', aliasName: 'sol' });
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
    test('explicit codex backend with glm alias treats as literal model', () => {
      // This documents the current behavior: when backend is explicit and
      // differs from alias backend, the model is treated as literal
      const result = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'glm', // Alias for pi
      });

      expect(result.backend).toBe('codex');
      expect(result.model).toBe('glm'); // NOT resolved to pi model
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
