import { describe, expect, test } from 'bun:test';
import { getBackend, hasBackend, listBackends } from '../../src/backend';

describe('Backend Registry', () => {
  test('has codex backend registered', () => {
    expect(hasBackend('codex')).toBe(true);
    const backend = getBackend('codex');
    expect(backend.name).toBe('codex');
    expect(backend.command).toBe('codex');
  });

  test('has claude backend registered', () => {
    expect(hasBackend('claude')).toBe(true);
    const backend = getBackend('claude');
    expect(backend.name).toBe('claude');
    expect(backend.command).toBe('claude');
  });

  test('has gemini backend registered', () => {
    expect(hasBackend('gemini')).toBe(true);
    const backend = getBackend('gemini');
    expect(backend.name).toBe('gemini');
    expect(backend.command).toBe('gemini');
  });

  test('lists all backends', () => {
    const backends = listBackends();
    expect(backends).toContain('codex');
    expect(backends).toContain('claude');
    expect(backends).toContain('gemini');
  });

  test('throws for unknown backend', () => {
    expect(() => getBackend('unknown')).toThrow('Unknown backend');
  });
});
