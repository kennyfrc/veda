import { describe, expect, test } from 'bun:test';

import {
  detectModelGeneration,
  mapReasoningToGeminiConfig,
  ModelGeneration,
  type ReasoningLevel,
} from '../../src/backend/gemini-config-types';

describe('Gemini Model Generation Detection', () => {
  test('detects GEN_3 models', () => {
    expect(detectModelGeneration('gemini-3-pro-preview')).toBe(ModelGeneration.GEN_3);
    expect(detectModelGeneration('gemini-3-flash-preview')).toBe(ModelGeneration.GEN_3);
    expect(detectModelGeneration('gemini-3-something-else')).toBe(ModelGeneration.GEN_3);
  });

  test('detects GEN_2_5 models', () => {
    expect(detectModelGeneration('gemini-2.5-pro')).toBe(ModelGeneration.GEN_2_5);
    expect(detectModelGeneration('gemini-2.5-flash')).toBe(ModelGeneration.GEN_2_5);
    expect(detectModelGeneration('gemini-2.5-pro-exp')).toBe(ModelGeneration.GEN_2_5);
    expect(detectModelGeneration('gemini-2-pro')).toBe(ModelGeneration.GEN_2_5); // Future-proof
  });

  test('detects UNKNOWN models', () => {
    expect(detectModelGeneration('gemini-3-ultra')).toBe(ModelGeneration.GEN_3); // Starts with gemini-3-
    expect(detectModelGeneration('gemini-4-ultra')).toBe(ModelGeneration.UNKNOWN); // Future
    expect(detectModelGeneration('gemini-2-ultra')).toBe(ModelGeneration.GEN_2_5); // gemini-2- matches
    expect(detectModelGeneration('gpt-4')).toBe(ModelGeneration.UNKNOWN);
    expect(detectModelGeneration('claude-opus')).toBe(ModelGeneration.UNKNOWN);
    expect(detectModelGeneration('unknown-model')).toBe(ModelGeneration.UNKNOWN);
  });
});

describe('Reasoning Level Mapping to Gemini 3.x', () => {
  const gen3 = ModelGeneration.GEN_3;

  test('maps minimal to LOW', () => {
    const config = mapReasoningToGeminiConfig('minimal', gen3);
    expect(config?.gen).toBe('GEN_3');
    expect(config?.thinkingLevel).toBe('LOW');
  });

  test('maps low to LOW', () => {
    const config = mapReasoningToGeminiConfig('low', gen3);
    expect(config?.gen).toBe('GEN_3');
    expect(config?.thinkingLevel).toBe('LOW');
  });

  test('maps medium to MEDIUM', () => {
    const config = mapReasoningToGeminiConfig('medium', gen3);
    expect(config?.gen).toBe('GEN_3');
    expect(config?.thinkingLevel).toBe('MEDIUM');
  });

  test('maps high to HIGH', () => {
    const config = mapReasoningToGeminiConfig('high', gen3);
    expect(config?.gen).toBe('GEN_3');
    expect(config?.thinkingLevel).toBe('HIGH');
  });

  test('maps xhigh to HIGH', () => {
    const config = mapReasoningToGeminiConfig('xhigh', gen3);
    expect(config?.gen).toBe('GEN_3');
    expect(config?.thinkingLevel).toBe('HIGH');
  });
});

describe('Reasoning Level Mapping to Gemini 2.x', () => {
  const gen25 = ModelGeneration.GEN_2_5;

  test('maps minimal to 8192', () => {
    const config = mapReasoningToGeminiConfig('minimal', gen25);
    expect(config?.gen).toBe('GEN_2_5');
    expect(config?.thinkingBudget).toBe(8192);
  });

  test('maps low to 8192', () => {
    const config = mapReasoningToGeminiConfig('low', gen25);
    expect(config?.gen).toBe('GEN_2_5');
    expect(config?.thinkingBudget).toBe(8192);
  });

  test('maps medium to 16000', () => {
    const config = mapReasoningToGeminiConfig('medium', gen25);
    expect(config?.gen).toBe('GEN_2_5');
    expect(config?.thinkingBudget).toBe(16000);
  });

  test('maps high to 32000', () => {
    const config = mapReasoningToGeminiConfig('high', gen25);
    expect(config?.gen).toBe('GEN_2_5');
    expect(config?.thinkingBudget).toBe(32000);
  });

  test('maps xhigh to 32000', () => {
    const config = mapReasoningToGeminiConfig('xhigh', gen25);
    expect(config?.gen).toBe('GEN_2_5');
    expect(config?.thinkingBudget).toBe(32000);
  });
});

describe('Mapping for Unknown Model Generation', () => {
  test('returns null for UNKNOWN generation', () => {
    const config = mapReasoningToGeminiConfig('high', ModelGeneration.UNKNOWN);
    expect(config).toBeNull();
  });
});

describe('Mapping Edge Cases', () => {
  test('minimal and low map to same level (Gen3 LOW)', () => {
    const minimalConfig = mapReasoningToGeminiConfig('minimal', ModelGeneration.GEN_3);
    const lowConfig = mapReasoningToGeminiConfig('low', ModelGeneration.GEN_3);
    expect(minimalConfig?.thinkingLevel).toBe(lowConfig?.thinkingLevel);
    expect(minimalConfig?.thinkingLevel).toBe('LOW');
  });

  test('high and xhigh map to same level (Gen3 HIGH)', () => {
    const highConfig = mapReasoningToGeminiConfig('high', ModelGeneration.GEN_3);
    const xhighConfig = mapReasoningToGeminiConfig('xhigh', ModelGeneration.GEN_3);
    expect(highConfig?.thinkingLevel).toBe(xhighConfig?.thinkingLevel);
    expect(highConfig?.thinkingLevel).toBe('HIGH');
  });

  test('minimal and low map to same budget (Gen2 8192)', () => {
    const minimalConfig = mapReasoningToGeminiConfig('minimal', ModelGeneration.GEN_2_5);
    const lowConfig = mapReasoningToGeminiConfig('low', ModelGeneration.GEN_2_5);
    expect(minimalConfig?.thinkingBudget).toBe(lowConfig?.thinkingBudget);
    expect(minimalConfig?.thinkingBudget).toBe(8192);
  });

  test('high and xhigh map to same budget (Gen2 32000)', () => {
    const highConfig = mapReasoningToGeminiConfig('high', ModelGeneration.GEN_2_5);
    const xhighConfig = mapReasoningToGeminiConfig('xhigh', ModelGeneration.GEN_2_5);
    expect(highConfig?.thinkingBudget).toBe(xhighConfig?.thinkingBudget);
    expect(highConfig?.thinkingBudget).toBe(32000);
  });
});
