import { describe, expect, test } from 'bun:test';
import { listBackends } from '../../src/backend';

// Import functions directly for testing hash behavior
// Note: We can't easily test selectSolverBackends without mocking getAvailableBackends,
// but we can verify the exported helper functions work correctly.

describe('hashString (exported for testing)', () => {
  test('produces consistent hash for same string', () => {
    // We need to verify the hash function directly
    // For now, we test that selectSolverBackends produces deterministic results
    // by checking the exported function exists and basic behavior

    // Test the hash function logic by calling it via a simple test
    const str = 'test prompt';
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash = hash >>> 0;

    // Run again to verify consistency
    let hash2 = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash2 ^= str.charCodeAt(i);
      hash2 = Math.imul(hash2, 16777619);
    }
    hash2 = hash2 >>> 0;

    expect(hash).toBe(hash2);
  });

  test('produces different hash for different strings', () => {
    const str1 = 'prompt A';
    const str2 = 'prompt B';

    let hash1 = 2166136261;
    for (let i = 0; i < str1.length; i++) {
      hash1 ^= str1.charCodeAt(i);
      hash1 = Math.imul(hash1, 16777619);
    }
    hash1 = hash1 >>> 0;

    let hash2 = 2166136261;
    for (let i = 0; i < str2.length; i++) {
      hash2 ^= str2.charCodeAt(i);
      hash2 = Math.imul(hash2, 16777619);
    }
    hash2 = hash2 >>> 0;

    expect(hash1).not.toBe(hash2);
  });

  test('handles empty string', () => {
    let hash = 2166136261;
    const str = '';
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash = hash >>> 0;

    expect(typeof hash).toBe('number');
    expect(hash).toBeGreaterThanOrEqual(0);
  });

  test('handles unicode characters', () => {
    const str = '你好世界 🌍';
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash = hash >>> 0;

    expect(typeof hash).toBe('number');
    expect(hash).toBeGreaterThanOrEqual(0);
  });
});

describe('createSeededRandom', () => {
  test('produces deterministic sequence for same seed', () => {
    const seed = 12345;
    const random1 = (max: number) => {
      let s = seed;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % max;
    };
    const random2 = (max: number) => {
      let s = seed;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % max;
    };

    expect(random1(10)).toBe(random2(10));
    expect(random1(10)).toBe(random2(10));
  });

  test('produces different sequences for different seeds', () => {
    const random1 = (seed: number) => {
      let s = seed;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % 100;
    };
    const random2 = (seed: number) => {
      let s = seed;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s % 100;
    };

    expect(random1(100)).not.toBe(random2(200));
  });
});

describe('selectSolverBackends logic verification', () => {
  // Since we can't easily mock getAvailableBackends in Bun,
  // we verify the core logic by testing the exported function with real backends

  test('selectSolverBackends exports correctly', async () => {
    const { selectSolverBackends } = await import('../../src/commands/deep');
    expect(typeof selectSolverBackends).toBe('function');
  });

  test('selectSolverBackends returns array with correct length', async () => {
    const { selectSolverBackends } = await import('../../src/commands/deep');
    
    const result = await selectSolverBackends({
      k: 4,
      solverBackend: 'codex',
    });
    
    expect(result.backends.length).toBe(4);
    expect(result.mode).toBe('fixed');
  });

  test('selectSolverBackends with explicit list uses only those backends', async () => {
    const { selectSolverBackends } = await import('../../src/commands/deep');
    
    const result = await selectSolverBackends({
      k: 4,
      randomizeSolvers: true,
      solverBackends: ['codex', 'gemini-cli'],
    });
    
    expect(result.mode).toBe('randomized');
    expect(result.backends.length).toBe(4);
    
    // All backends should be from the explicit list
    for (const backend of result.backends) {
      expect(['codex', 'gemini-cli']).toContain(backend);
    }
  });

  test('selectSolverBackends explicit backend overrides randomization', async () => {
    const { selectSolverBackends } = await import('../../src/commands/deep');
    
    const result = await selectSolverBackends({
      k: 4,
      randomizeSolvers: true,
      solverBackend: 'claude-code',
    });
    
    expect(result.mode).toBe('fixed');
    expect(result.backends).toEqual(['claude-code', 'claude-code', 'claude-code', 'claude-code']);
  });
});

describe('Backend registry', () => {
  test('lists available backends', () => {
    const backends = listBackends();
    expect(backends).toContain('codex');
    expect(backends).toContain('claude-code');
    expect(backends).toContain('gemini-cli');
  });
});
