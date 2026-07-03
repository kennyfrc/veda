import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextStore } from '../../src/context/store';

const TEST_SESSION = 'test-session';

async function withTestStore<T>(fn: (store: ContextStore) => Promise<T>): Promise<T> {
  const testBase = join(
    tmpdir(),
    `veda-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const testFilesDir = join(testBase, 'files');
  const testConfigDir = join(testBase, 'config');

  await mkdir(testFilesDir, { recursive: true });
  await mkdir(testConfigDir, { recursive: true });

  await writeFile(join(testFilesDir, 'a.ts'), 'line1\nline2\nline3\nline4\nline5');
  await writeFile(join(testFilesDir, 'b.ts'), 'content of b');
  await writeFile(join(testFilesDir, 'c.ts'), 'content of c');
  await mkdir(join(testFilesDir, 'sub'), { recursive: true });
  await writeFile(join(testFilesDir, 'sub', 'd.ts'), 'content of d');
  // Binary file with null bytes (PNG header)
  await writeFile(join(testFilesDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]));

  const store = new ContextStore({
    sessionId: TEST_SESSION,
    cwd: testFilesDir,
    baseDir: testConfigDir,
  });

  try {
    return await fn(store);
  } finally {
    await rm(testBase, { recursive: true, force: true });
  }
}

describe('ContextStore', () => {

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
    await withTestStore(async store => {
      const result = await store.add(['a.ts']);
      
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.notFound).toEqual([]);
      
      const entries = await store.list();
      expect(entries.length).toBe(1);
      expect(entries[0].absolutePath).toContain('a.ts');
    });
  });

  test('add multiple files', async () => {
    await withTestStore(async store => {
      const result = await store.add(['a.ts', 'b.ts', 'c.ts']);
      
      expect(result.added).toBe(3);
      
      const entries = await store.list();
      expect(entries.length).toBe(3);
    });
  });

  test('add skips duplicates', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts']);
      const result = await store.add(['a.ts', 'b.ts']);
      
      expect(result.added).toBe(1); // Only b.ts
      expect(result.skipped).toBe(1); // a.ts was duplicate
      
      const entries = await store.list();
      expect(entries.length).toBe(2);
    });
  });

  test('add reports not found files', async () => {
    await withTestStore(async store => {
      const result = await store.add(['a.ts', 'nonexistent.ts']);
      
      expect(result.added).toBe(1);
      expect(result.notFound.length).toBe(1);
      expect(result.notFound[0]).toContain('nonexistent.ts');
    });
  });

  test('add with slice', async () => {
    await withTestStore(async store => {
      const result = await store.add(['a.ts:1-3']);

      expect(result.added).toBe(1);

      const entries = await store.list();
      expect(entries.length).toBe(1);
      expect(entries[0].slice.sliceType).toBe('range');
      expect(entries[0].slice.startLine).toBe(1);
      expect(entries[0].slice.endLine).toBe(3);
    });
  });

  test('add same file with different slices', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts:1-3']);
      const result = await store.add(['a.ts:4-5']);
      
      expect(result.added).toBe(1); // Different slice, should add
      
      const entries = await store.list();
      expect(entries.length).toBe(2);
    });
  });

  test('remove file', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts', 'b.ts']);
      const result = await store.remove(['a.ts']);
      
      expect(result.removed).toBe(1);
      
      const entries = await store.list();
      expect(entries.length).toBe(1);
      expect(entries[0].absolutePath).toContain('b.ts');
    });
  });

  test('remove file also removes its slices', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts:1-3', 'a.ts:4-5', 'b.ts']);
      const result = await store.remove(['a.ts']);
      
      expect(result.removed).toBe(2); // Both slices removed
      
      const entries = await store.list();
      expect(entries.length).toBe(1);
      expect(entries[0].absolutePath).toContain('b.ts');
    });
  });

  test('remove specific slice only', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts:1-3', 'a.ts:4-5']);
      const result = await store.remove(['a.ts:1-3']);

      expect(result.removed).toBe(1); // Only the specific slice

      const entries = await store.list();
      expect(entries.length).toBe(1);
      expect(entries[0].slice.startLine).toBe(4);
    });
  });

  test('clear removes all', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts', 'b.ts', 'c.ts']);
      await store.clear();
      
      const entries = await store.list();
      expect(entries.length).toBe(0);
    });
  });

  test('tokens returns estimate', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts']); // 'line1\nline2\nline3\nline4\nline5' = 29 chars
      const tokens = await store.tokens();
      
      // ~4 chars per token, so 29/4 = 8 tokens (rounded up)
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });
  });

  test('tokens with slice', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts:1-2']); // 'line1\nline2' = 11 chars → ~3 tokens
      const tokens = await store.tokens();
      
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(10);
    });
  });

  test('tokenDetails returns per-file info', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts', 'b.ts']);
      const details = await store.tokenDetails();
      
      expect(details.length).toBe(2);
      expect(details[0].lines).toBeGreaterThan(0);
      expect(details[0].tokens).toBeGreaterThan(0);
    });
  });

  test('serialize skips binary files with null bytes', async () => {
    await withTestStore(async store => {
      await store.add(['a.ts', 'image.png', 'b.ts']);
      const serialized = await store.serialize();

      // Text files should be included
      expect(serialized).toContain('line1');
      expect(serialized).toContain('content of b');
      // Binary file should be skipped (no null bytes in output)
      expect(serialized).not.toContain('\0');
      expect(serialized).not.toContain('image.png');
    });
  });
});
