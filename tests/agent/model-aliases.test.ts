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
    expect(MODEL_ALIASES['gpt']).toEqual({ backend: 'codex', model: 'gpt-5.3-codex' });
  });

  test('contains Droid models', () => {
    expect(MODEL_ALIASES['glm-5.2']).toEqual({ backend: 'droid', model: 'glm-5.2' });
    expect(MODEL_ALIASES['makora']).toEqual({ backend: 'droid', model: 'custom:Makora-GLM-5.2-NVFP4-9' });
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
    expect(normalizeModelName(' GLM-5.2 ')).toBe('glm-5.2');
  });
});

describe('resolveModelAlias', () => {
  test('resolves Claude aliases', () => {
    expect(resolveModelAlias('opus')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias('sonnet')).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(resolveModelAlias('haiku')).toEqual({ backend: 'claude-code', model: 'haiku' });
  });

  test('resolves OpenAI aliases', () => {
    expect(resolveModelAlias('gpt')).toEqual({ backend: 'codex', model: 'gpt-5.3-codex' });
  });

  test('resolves Droid aliases', () => {
    expect(resolveModelAlias('glm-5.2')).toEqual({ backend: 'droid', model: 'glm-5.2' });
    expect(resolveModelAlias('makora')).toEqual({ backend: 'droid', model: 'custom:Makora-GLM-5.2-NVFP4-9' });
  });

  test('handles case-insensitive lookup', () => {
    expect(resolveModelAlias('OPUS')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias('Sonnet')).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(resolveModelAlias('GPT')).toEqual({ backend: 'codex', model: 'gpt-5.3-codex' });
    expect(resolveModelAlias('GLM-5.2')).toEqual({ backend: 'droid', model: 'glm-5.2' });
  });

  test('handles whitespace', () => {
    expect(resolveModelAlias('  opus  ')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias(' haiku\n')).toEqual({ backend: 'claude-code', model: 'haiku' });
  });

  test('returns undefined for unknown models', () => {
    expect(resolveModelAlias('unknown-model')).toBeUndefined();
    expect(resolveModelAlias('')).toBeUndefined();
  });
});

describe('isModelAlias', () => {
  test('returns true for known aliases', () => {
    expect(isModelAlias('opus')).toBe(true);
    expect(isModelAlias('sonnet')).toBe(true);
    expect(isModelAlias('haiku')).toBe(true);
    expect(isModelAlias('gpt')).toBe(true);
    expect(isModelAlias('glm-5.2')).toBe(true);
    expect(isModelAlias('makora')).toBe(true);
  });

  test('returns false for unknown models', () => {
    expect(isModelAlias('unknown-model')).toBe(false);
    expect(isModelAlias('')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isModelAlias('OPUS')).toBe(true);
    expect(isModelAlias('Sonnet')).toBe(true);
    expect(isModelAlias('GLM-5.2')).toBe(true);
  });
});

describe('listModelAliases', () => {
  test('returns all alias names', () => {
    const aliases = listModelAliases();
    expect(aliases).toContain('opus');
    expect(aliases).toContain('sonnet');
    expect(aliases).toContain('haiku');
    expect(aliases).toContain('gpt');
    expect(aliases).toContain('glm-5.2');
    expect(aliases).toContain('makora');
  });

  test('returns expected count', () => {
    expect(listModelAliases().length).toBe(6);
  });
});
