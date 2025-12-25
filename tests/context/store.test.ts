import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextStore } from '../../src/context/store';

// Use a temp directory for tests - unique per test file run
const TEST_BASE = join(tmpdir(), 'veda-test-' + process.pid + '-' + Date.now());
const TEST_FILES_DIR = join(TEST_BASE, 'files');
const TEST_CONFIG_DIR = join(TEST_BASE, 'config');
const TEST_SESSION = 'test-session';

/** Create a test store with isolated config directory */
function createTestStore(sessionId: string = TEST_SESSION): ContextStore {
  return new ContextStore({
    sessionId,
    cwd: TEST_FILES_DIR,
    baseDir: TEST_CONFIG_DIR,
  });
}

describe('ContextStore', () => {
  beforeEach(async () => {
    await mkdir(TEST_FILES_DIR, { recursive: true });
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    
    // Create some test files
    await writeFile(join(TEST_FILES_DIR, 'a.ts'), 'line1\nline2\nline3\nline4\nline5');
    await writeFile(join(TEST_FILES_DIR, 'b.ts'), 'content of b');
    await writeFile(join(TEST_FILES_DIR, 'c.ts'), 'content of c');
    await mkdir(join(TEST_FILES_DIR, 'sub'), { recursive: true });
    await writeFile(join(TEST_FILES_DIR, 'sub', 'd.ts'), 'content of d');
  });

  afterEach(async () => {
    try {
      await rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('validates session ID', () => {
    expect(() => new ContextStore({ sessionId: '' })).toThrow('Invalid session ID');
    expect(() => new ContextStore({ sessionId: 'has space' })).toThrow('Invalid session ID');
    expect(() => new ContextStore({ sessionId: 'a'.repeat(65) })).toThrow('Invalid session ID');
  });

  test('accepts valid session IDs', () => {
    expect(() => new ContextStore({ sessionId: 'valid-session' })).not.toThrow();
    expect(() => new ContextStore({ sessionId: 'agent-12345' })).not.toThrow();
    expect(() => new ContextStore({ sessionId: 'test.session:1' })).not.toThrow();
  });

  test('add single file', async () => {
    const store = createTestStore();
    const result = await store.add(['a.ts']);
    
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.notFound).toEqual([]);
    
    const entries = await store.list();
    expect(entries.length).toBe(1);
    expect(entries[0].absolutePath).toContain('a.ts');
  });

  test('add multiple files', async () => {
    const store = createTestStore();
    const result = await store.add(['a.ts', 'b.ts', 'c.ts']);
    
    expect(result.added).toBe(3);
    
    const entries = await store.list();
    expect(entries.length).toBe(3);
  });

  test('add skips duplicates', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts']);
    const result = await store.add(['a.ts', 'b.ts']);
    
    expect(result.added).toBe(1); // Only b.ts
    expect(result.skipped).toBe(1); // a.ts was duplicate
    
    const entries = await store.list();
    expect(entries.length).toBe(2);
  });

  test('add reports not found files', async () => {
    const store = createTestStore();
    const result = await store.add(['a.ts', 'nonexistent.ts']);
    
    expect(result.added).toBe(1);
    expect(result.notFound.length).toBe(1);
    expect(result.notFound[0]).toContain('nonexistent.ts');
  });

  test('add with slice', async () => {
    const store = createTestStore();
    const result = await store.add(['a.ts:1-3']);

    expect(result.added).toBe(1);

    const entries = await store.list();
    expect(entries.length).toBe(1);
    expect(entries[0].slice.sliceType).toBe('range');
    expect(entries[0].slice.startLine).toBe(1);
    expect(entries[0].slice.endLine).toBe(3);
  });

  test('add same file with different slices', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts:1-3']);
    const result = await store.add(['a.ts:4-5']);
    
    expect(result.added).toBe(1); // Different slice, should add
    
    const entries = await store.list();
    expect(entries.length).toBe(2);
  });

  test('remove file', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts', 'b.ts']);
    const result = await store.remove(['a.ts']);
    
    expect(result.removed).toBe(1);
    
    const entries = await store.list();
    expect(entries.length).toBe(1);
    expect(entries[0].absolutePath).toContain('b.ts');
  });

  test('remove file also removes its slices', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts:1-3', 'a.ts:4-5', 'b.ts']);
    const result = await store.remove(['a.ts']);
    
    expect(result.removed).toBe(2); // Both slices removed
    
    const entries = await store.list();
    expect(entries.length).toBe(1);
    expect(entries[0].absolutePath).toContain('b.ts');
  });

  test('remove specific slice only', async () => {
    const store = createTestStore();

    await store.add(['a.ts:1-3', 'a.ts:4-5']);
    const result = await store.remove(['a.ts:1-3']);

    expect(result.removed).toBe(1); // Only the specific slice

    const entries = await store.list();
    expect(entries.length).toBe(1);
    expect(entries[0].slice.startLine).toBe(4);
  });

  test('clear removes all', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts', 'b.ts', 'c.ts']);
    await store.clear();
    
    const entries = await store.list();
    expect(entries.length).toBe(0);
  });

  test('tokens returns estimate', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts']); // 'line1\nline2\nline3\nline4\nline5' = 29 chars
    const tokens = await store.tokens();
    
    // ~4 chars per token, so 29/4 = 8 tokens (rounded up)
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(20);
  });

  test('tokens with slice', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts:1-2']); // 'line1\nline2' = 11 chars → ~3 tokens
    const tokens = await store.tokens();
    
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  test('tokenDetails returns per-file info', async () => {
    const store = createTestStore();
    
    await store.add(['a.ts', 'b.ts']);
    const details = await store.tokenDetails();
    
    expect(details.length).toBe(2);
    expect(details[0].lines).toBeGreaterThan(0);
    expect(details[0].tokens).toBeGreaterThan(0);
  });
});
