import { describe, expect, test } from 'bun:test';
import { getBackend, hasBackend, listBackends, getBackendDefaultModel, getBackendDefaultReasoning } from '../../src/backend';

describe('Backend Registry', () => {
  test('has codex backend registered', () => {
    expect(hasBackend('codex')).toBe(true);
    const backend = getBackend('codex');
    expect(backend.name).toBe('codex');
    expect(backend.command).toBe('codex');
  });

  test('has claude-code backend registered', () => {
    expect(hasBackend('claude-code')).toBe(true);
    const backend = getBackend('claude-code');
    expect(backend.name).toBe('claude-code');
    expect(backend.command).toBe('claude');
  });

  test('has gemini-cli backend registered', () => {
    expect(hasBackend('gemini-cli')).toBe(true);
    const backend = getBackend('gemini-cli');
    expect(backend.name).toBe('gemini-cli');
    expect(backend.command).toBe('gemini');
  });

  test('has jdc backend registered', () => {
    expect(hasBackend('jdc')).toBe(true);
    const backend = getBackend('jdc');
    expect(backend.name).toBe('jdc');
    expect(backend.command).toBe('jdc');
  });

  test('has droid backend registered', () => {
    expect(hasBackend('droid')).toBe(true);
    const backend = getBackend('droid');
    expect(backend.name).toBe('droid');
    expect(backend.command).toBe('droid');
  });

  test('lists all backends', () => {
    const backends = listBackends();
    expect(backends).toContain('codex');
    expect(backends).toContain('claude-code');
    expect(backends).toContain('gemini-cli');
    expect(backends).toContain('jdc');
    expect(backends).toContain('droid');
  });

  test('jdc default model', () => {
    expect(getBackendDefaultModel('jdc')).toBe('jdc/fireworks/accounts/fireworks/routers/kimi-k2p6');
  });

  test('jdc default reasoning', () => {
    expect(getBackendDefaultReasoning('jdc')).toBe('medium');
  });

  test('droid default model', () => {
    expect(getBackendDefaultModel('droid')).toBe('custom:Makora-GLM-5.2-NVFP4-9');
  });

  test('droid default reasoning', () => {
    expect(getBackendDefaultReasoning('droid')).toBe('medium');
  });

  test('throws for unknown backend', () => {
    expect(() => getBackend('unknown')).toThrow('Unknown backend');
  });

  test('throws for old backend names (no aliases)', () => {
    expect(() => getBackend('claude')).toThrow('Unknown backend');
    expect(() => getBackend('gemini')).toThrow('Unknown backend');
  });
});
