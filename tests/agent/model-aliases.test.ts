import { describe, expect, test } from 'bun:test';
import {
  MODEL_ALIASES,
  normalizeModelName,
  resolveModelAlias,
  isModelAlias,
  listModelAliases,
} from '../../src/agent/model-aliases';

describe('MODEL_ALIASES', () => {
  test('contains Claude models', () => {
    expect(MODEL_ALIASES['opus']).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(MODEL_ALIASES['sonnet']).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(MODEL_ALIASES['haiku']).toEqual({ backend: 'claude-code', model: 'haiku' });
  });

  test('contains OpenAI models', () => {
    expect(MODEL_ALIASES['gpt']).toEqual({ backend: 'codex', model: 'gpt-5.2' });
  });

  test('contains Gemini models', () => {
    expect(MODEL_ALIASES['gemini-pro']).toEqual({ backend: 'gemini-cli', model: 'gemini-3-pro-preview' });
    expect(MODEL_ALIASES['gemini-flash']).toEqual({ backend: 'gemini-cli', model: 'gemini-3-flash-preview' });
  });
});

describe('normalizeModelName', () => {
  test('lowercases input', () => {
    expect(normalizeModelName('OPUS')).toBe('opus');
    expect(normalizeModelName('Sonnet')).toBe('sonnet');
  });

  test('trims whitespace', () => {
    expect(normalizeModelName('  opus  ')).toBe('opus');
    expect(normalizeModelName('\thaiku\n')).toBe('haiku');
  });

  test('handles combined normalization', () => {
    expect(normalizeModelName('  OpUs  ')).toBe('opus');
    expect(normalizeModelName(' GEMINI-PRO ')).toBe('gemini-pro');
  });
});

describe('resolveModelAlias', () => {
  test('resolves Claude aliases', () => {
    expect(resolveModelAlias('opus')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias('sonnet')).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(resolveModelAlias('haiku')).toEqual({ backend: 'claude-code', model: 'haiku' });
  });

  test('resolves OpenAI aliases', () => {
    expect(resolveModelAlias('gpt')).toEqual({ backend: 'codex', model: 'gpt-5.2' });
  });

  test('resolves Gemini aliases', () => {
    expect(resolveModelAlias('gemini-pro')).toEqual({ backend: 'gemini-cli', model: 'gemini-3-pro-preview' });
    expect(resolveModelAlias('gemini-flash')).toEqual({ backend: 'gemini-cli', model: 'gemini-3-flash-preview' });
  });

  test('handles case-insensitive lookup', () => {
    expect(resolveModelAlias('OPUS')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias('Sonnet')).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(resolveModelAlias('GPT')).toEqual({ backend: 'codex', model: 'gpt-5.2' });
  });

  test('handles whitespace', () => {
    expect(resolveModelAlias('  opus  ')).toEqual({ backend: 'claude-code', model: 'opus' });
  });

  test('returns undefined for unknown models', () => {
    expect(resolveModelAlias('unknown-model')).toBeUndefined();
    expect(resolveModelAlias('gpt-4o')).toBeUndefined();
    expect(resolveModelAlias('claude-3-opus')).toBeUndefined();
    expect(resolveModelAlias('')).toBeUndefined();
  });
});

describe('isModelAlias', () => {
  test('returns true for known aliases', () => {
    expect(isModelAlias('opus')).toBe(true);
    expect(isModelAlias('sonnet')).toBe(true);
    expect(isModelAlias('gpt')).toBe(true);
    expect(isModelAlias('gemini-pro')).toBe(true);
  });

  test('returns false for unknown models', () => {
    expect(isModelAlias('unknown')).toBe(false);
    expect(isModelAlias('gpt-4')).toBe(false);
    expect(isModelAlias('')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isModelAlias('OPUS')).toBe(true);
    expect(isModelAlias('Haiku')).toBe(true);
  });
});

describe('listModelAliases', () => {
  test('returns all alias names', () => {
    const aliases = listModelAliases();
    expect(aliases).toContain('opus');
    expect(aliases).toContain('sonnet');
    expect(aliases).toContain('haiku');
    expect(aliases).toContain('gpt');
    expect(aliases).toContain('gemini-pro');
    expect(aliases).toContain('gemini-flash');
  });

  test('returns expected count', () => {
    expect(listModelAliases().length).toBe(6);
  });
});
