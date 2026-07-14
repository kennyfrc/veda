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
    expect(MODEL_ALIASES['fable']).toEqual({ backend: 'droid', model: 'claude-fable-5' });
  });

  test('contains jdc models with reasoning', () => {
    expect(MODEL_ALIASES['glm']).toEqual({ backend: 'jdc', model: 'jdc/makora/zai-org/GLM-5.2-NVFP4', reasoning: 'high' });
    expect(MODEL_ALIASES['sol']).toEqual({ backend: 'jdc', model: 'jdc/openai-codex/gpt-5.6-sol', reasoning: 'high' });
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
    expect(normalizeModelName(' GLM ')).toBe('glm');
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
    expect(resolveModelAlias('fable')).toEqual({ backend: 'droid', model: 'claude-fable-5' });
  });

  test('resolves jdc aliases with reasoning', () => {
    expect(resolveModelAlias('glm')).toEqual({ backend: 'jdc', model: 'jdc/makora/zai-org/GLM-5.2-NVFP4', reasoning: 'high' });
    expect(resolveModelAlias('sol')).toEqual({ backend: 'jdc', model: 'jdc/openai-codex/gpt-5.6-sol', reasoning: 'high' });
  });

  test('handles case-insensitive lookup', () => {
    expect(resolveModelAlias('OPUS')).toEqual({ backend: 'claude-code', model: 'opus' });
    expect(resolveModelAlias('Sonnet')).toEqual({ backend: 'claude-code', model: 'sonnet' });
    expect(resolveModelAlias('GPT')).toEqual({ backend: 'codex', model: 'gpt-5.3-codex' });
    expect(resolveModelAlias('GLM')).toEqual({ backend: 'jdc', model: 'jdc/makora/zai-org/GLM-5.2-NVFP4', reasoning: 'high' });
    expect(resolveModelAlias('SOL')).toEqual({ backend: 'jdc', model: 'jdc/openai-codex/gpt-5.6-sol', reasoning: 'high' });
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
    expect(isModelAlias('fable')).toBe(true);
    expect(isModelAlias('glm')).toBe(true);
    expect(isModelAlias('sol')).toBe(true);
  });

  test('returns false for unknown models', () => {
    expect(isModelAlias('unknown-model')).toBe(false);
    expect(isModelAlias('')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isModelAlias('OPUS')).toBe(true);
    expect(isModelAlias('Sonnet')).toBe(true);
    expect(isModelAlias('GLM')).toBe(true);
    expect(isModelAlias('SOL')).toBe(true);
  });
});

describe('listModelAliases', () => {
  test('returns all alias names', () => {
    const aliases = listModelAliases();
    expect(aliases).toContain('opus');
    expect(aliases).toContain('sonnet');
    expect(aliases).toContain('haiku');
    expect(aliases).toContain('gpt');
    expect(aliases).toContain('fable');
    expect(aliases).toContain('glm');
    expect(aliases).toContain('sol');
  });

  test('returns expected count', () => {
    expect(listModelAliases().length).toBe(7);
  });
});
