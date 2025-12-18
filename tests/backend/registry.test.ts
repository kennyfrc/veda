import { describe, expect, test } from 'bun:test';
import { getBackend, hasBackend, listBackends } from '../../src/backend';

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

  test('lists all backends', () => {
    const backends = listBackends();
    expect(backends).toContain('codex');
    expect(backends).toContain('claude-code');
    expect(backends).toContain('gemini-cli');
  });

  test('throws for unknown backend', () => {
    expect(() => getBackend('unknown')).toThrow('Unknown backend');
  });
  
  test('throws for old backend names (no aliases)', () => {
    expect(() => getBackend('claude')).toThrow('Unknown backend');
    expect(() => getBackend('gemini')).toThrow('Unknown backend');
  });
});
