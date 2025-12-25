import { describe, expect, test } from 'bun:test';
import {
  resolveModelAliasNormalized,
  tryResolveAliasTarget,
} from '../../src/agent/config-extract';

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
      const input = 'gemini-pro';
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
      expect(gpt?.model).toBe('gpt-5.2');

      const geminiPro = tryResolveAliasTarget('gemini-pro');
      expect(geminiPro?.backend).toBe('gemini-cli');
      expect(geminiPro?.model).toBe('gemini-3-pro-preview');
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
