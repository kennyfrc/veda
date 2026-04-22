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

  test('has mu backend registered', () => {
    expect(hasBackend('mu')).toBe(true);
    const backend = getBackend('mu');
    expect(backend.name).toBe('mu');
    expect(backend.command).toBe('mu');
  });

  test('lists all backends', () => {
    const backends = listBackends();
    expect(backends).toContain('codex');
    expect(backends).toContain('claude-code');
    expect(backends).toContain('gemini-cli');
    expect(backends).toContain('mu');
  });

  test('mu default model', () => {
    expect(getBackendDefaultModel('mu')).toBe('mu/fireworks/accounts/fireworks/routers/kimi-k2p6');
  });

  test('mu default reasoning', () => {
    expect(getBackendDefaultReasoning('mu')).toBe('medium');
  });

  test('throws for unknown backend', () => {
    expect(() => getBackend('unknown')).toThrow('Unknown backend');
  });

  test('throws for old backend names (no aliases)', () => {
    expect(() => getBackend('claude')).toThrow('Unknown backend');
    expect(() => getBackend('gemini')).toThrow('Unknown backend');
  });
});
