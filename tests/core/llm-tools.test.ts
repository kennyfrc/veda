/**
 * Regression test for the tool-policy pass-through in buildBackendConfig.
 *
 * The worker persona resolves to `tools: undefined` ("backend full toolset").
 * A long-gone `tools: req.tools ?? []` normalization flattened that back to []
 * — silently downgrading the worker to no tools (pi received --no-tools and the
 * worker could not act). undefined must reach the backend intact; [] must stay
 * "no tools" for the advisory personas. Pure test — no backend or mocks.
 */
import { describe, expect, test } from 'bun:test';
import { buildBackendConfig } from '../../src/core/llm';

const base = {
  backend: 'any',
  prompt: 'hi',
  systemPrompt: 'sp',
};

describe('buildBackendConfig tool pass-through', () => {
  test('undefined tools reach the backend as undefined (worker full toolset)', () => {
    const config = buildBackendConfig({ ...base, tools: undefined });
    expect(config.tools).toBeUndefined();
  });

  test('empty tools reach the backend as [] (advisory personas)', () => {
    const config = buildBackendConfig({ ...base, tools: [] });
    expect(config.tools).toEqual([]);
  });

  test('an allowlist reaches the backend as-is', () => {
    const config = buildBackendConfig({ ...base, tools: ['read'] });
    expect(config.tools).toEqual(['read']);
  });

  test('does not coerce missing tools to [] (the regression)', () => {
    // The old `req.tools ?? []` masked the worker's intentional `undefined`.
    const config = buildBackendConfig({ ...base });
    expect(config.tools).toBeUndefined();
    expect(config.tools).not.toEqual([]);
  });

  test('carries sandbox and reasoning defaults', () => {
    const config = buildBackendConfig({ ...base });
    expect(config.sandbox).toBe('read-only');
    expect(config.reasoning).toBe('medium');
  });
});
