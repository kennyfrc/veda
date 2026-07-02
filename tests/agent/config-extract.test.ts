import { describe, expect, test } from 'bun:test';
import {
  resolveModelAliasNormalized,
  tryResolveAliasTarget,
} from '../../src/agent/config-extract';
import { resolveBackendModel } from '../../src/agent/config';

describe('BackendModelResolver helpers', () => {
  describe('resolveModelAliasNormalized', () => {
    test('trims and lowercases input', () => {
      expect(resolveModelAliasNormalized('  OPUS  ')).toBe('opus');
      expect(resolveModelAliasNormalized('Sonnet')).toBe('sonnet');
    });

    test('handles empty and whitespace strings', () => {
      expect(resolveModelAliasNormalized('')).toBe('');
      expect(resolveModelAliasNormalized('   ')).toBe('');
    });

    test('is idempotent', () => {
      const input = 'glm-5.2';
      expect(resolveModelAliasNormalized(input)).toBe(input);
    });
  });

  describe('tryResolveAliasTarget', () => {
    test('returns undefined for empty input', () => {
      expect(tryResolveAliasTarget('')).toBeUndefined();
      expect(tryResolveAliasTarget('   ')).toBeUndefined();
    });

    test('returns undefined for unknown alias', () => {
      expect(tryResolveAliasTarget('unknown-model')).toBeUndefined();
      expect(tryResolveAliasTarget('gpt-100')).toBeUndefined();
    });

    test('resolves known aliases', () => {
      const opus = tryResolveAliasTarget('opus');
      expect(opus?.backend).toBe('claude-code');
      expect(opus?.model).toBe('opus');

      const gpt = tryResolveAliasTarget('gpt');
      expect(gpt?.backend).toBe('codex');
      expect(gpt?.model).toBe('gpt-5.3-codex');

      const glm = tryResolveAliasTarget('glm-5.2');
      expect(glm?.backend).toBe('droid');
      expect(glm?.model).toBe('glm-5.2');
    });

    test('is case insensitive', () => {
      expect(tryResolveAliasTarget('OPUS')).toEqual(tryResolveAliasTarget('opus'));
      expect(tryResolveAliasTarget('GPT')).toEqual(tryResolveAliasTarget('gpt'));
    });

    test('trims whitespace', () => {
      expect(tryResolveAliasTarget('  sonnet  ')).toEqual(tryResolveAliasTarget('sonnet'));
    });
  });
});

describe('inferBackendFromModel', () => {
  // Test via resolveBackendModel since inferBackendFromModel is private

  test('infers codex from gpt- prefix', () => {
    const result = resolveBackendModel({
      explicitModel: 'gpt-5.2',
      fallbackBackend: 'droid',
    });
    expect(result.backend).toBe('codex');
    expect(result.model).toBe('gpt-5.2');
  });

  test('infers codex from o1- prefix', () => {
    const result = resolveBackendModel({
      explicitModel: 'o1-preview',
      fallbackBackend: 'droid',
    });
    expect(result.backend).toBe('codex');
  });

  test('infers codex from o3- prefix', () => {
    const result = resolveBackendModel({
      explicitModel: 'o3-mini',
      fallbackBackend: 'droid',
    });
    expect(result.backend).toBe('codex');
  });

  test('infers jdc from jdc/ prefix', () => {
    const result = resolveBackendModel({
      explicitModel: 'jdc/crof/glm-5.2',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('jdc');
  });

  test('infers claude-code from claude- prefix', () => {
    const result = resolveBackendModel({
      explicitModel: 'claude-sonnet-4',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('claude-code');
  });

  test('explicit backend overrides inference', () => {
    const result = resolveBackendModel({
      explicitBackend: 'droid',
      explicitModel: 'gpt-5.2',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('droid');
  });

  test('alias takes precedence over inference', () => {
    const result = resolveBackendModel({
      explicitModel: 'opus',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('claude-code');
    expect(result.source.kind).toBe('alias');
  });

  test('infers jdc from jdc/ prefix (wafer model)', () => {
    const result = resolveBackendModel({
      explicitModel: 'jdc/wafer/glm-5.1',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('jdc');
    expect(result.model).toBe('jdc/wafer/glm-5.1');
    expect(result.source.kind).toBe('prefix');
  });

  test('infers jdc from jdc/ prefix (long fireworks model path)', () => {
    const result = resolveBackendModel({
      explicitModel: 'jdc/fireworks/accounts/fireworks/routers/kimi-k2p6',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('jdc');
    expect(result.model).toBe('jdc/fireworks/accounts/fireworks/routers/kimi-k2p6');
    expect(result.source.kind).toBe('prefix');
  });

  test('explicit backend overrides jdc/ prefix inference', () => {
    const result = resolveBackendModel({
      explicitBackend: 'codex',
      explicitModel: 'jdc/wafer/glm-5.1',
      fallbackBackend: 'codex',
    });
    expect(result.backend).toBe('codex');
    expect(result.model).toBe('jdc/wafer/glm-5.1');
  });

  test('throws error for unknown model', () => {
    expect(() => resolveBackendModel({
      explicitModel: 'unknown-model-xyz',
      fallbackBackend: 'codex',
    })).toThrow(/Unknown model: 'unknown-model-xyz'/);
  });

  test('case insensitive prefix matching', () => {
    const result = resolveBackendModel({
      explicitModel: 'GPT-5.2',
      fallbackBackend: 'droid',
    });
    expect(result.backend).toBe('codex');
  });
});
