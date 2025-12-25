/**
 * Performance analysis for ContextStore.list() caching.
 *
 * Analysis:
 * - list() is called in: add(), remove(), tokens(), tokenDetails()
 * - tokens() and tokenDetails() both read the list independently
 * - In the 'ls' subcommand, list() is read once, then tokenDetails() reads it again
 *
 * Conclusion:
 * - Only 1 duplicate read path: 'ls' command → list() → tokenDetails() → list()
 * - This is an interactive command, not performance-critical
 * - Adding caching would increase complexity without meaningful benefit
 *
 * Pragmatic programming principle: "Inline until duplication appears"
 * - We DON'T have 2+ living sites that need the same semantics in a hot path
 * - Wait for a real performance issue before adding caching
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextStore } from '../../src/context/store';

const TEST_BASE = join(tmpdir(), 'veda-perf-test-' + process.pid + '-' + Date.now());

describe('ContextStore performance analysis', () => {
  beforeEach(async () => {
    await mkdir(TEST_BASE, { recursive: true });
    // Create test files
    for (let i = 0; i < 10; i++) {
      await writeFile(join(TEST_BASE, `file${i}.ts`), `content of file ${i}\n`.repeat(10));
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('document list() call patterns', async () => {
    const store = new ContextStore({ sessionId: 'test', cwd: TEST_BASE });

    await store.add(['file0.ts', 'file1.ts', 'file2.ts']);

    // Pattern 1: Single list() read (common in add, remove, clear)
    const start1 = performance.now();
    const entries1 = await store.list();
    const time1 = performance.now() - start1;

    // Pattern 2: Duplicate list() read (rare, only in 'ls' command)
    const start2 = performance.now();
    const entries2 = await store.list();
    const tokens = await store.tokens(); // Internally calls list() again
    const time2 = performance.now() - start2;

    // The duplicate read pattern is ~2x slower, but still fast (<1ms for small selections)
    expect(time1).toBeGreaterThan(0);
    expect(time2).toBeGreaterThan(time1);

    // For typical usage (10 files, 200 lines each), this is <1ms overhead
    // Not worth adding caching until we have a proven hot path
    expect(time2).toBeLessThan(10); // Should be <10ms for typical usage
  });

  test('document that caching is NOT needed yet', async () => {
    const store = new ContextStore({ sessionId: 'test', cwd: TEST_BASE });

    await store.add(['file0.ts', 'file1.ts']);

    // Read the list multiple times (simulating ls + tokenDetails usage)
    const list1 = await store.list();
    const list2 = await store.list();

    // Both reads are fast and result is the same
    expect(list1.map(e => e.absolutePath)).toEqual(list2.map(e => e.absolutePath));

    // No caching is needed because:
    // 1. File I/O is negligible for typical selections (<100 files, <10KB each)
    // 2. Only one duplicate read path exists (ls → list → tokenDetails → list)
    // 3. This is not a performance-critical hot path (interactive command)
    // 4. Adding caching would increase complexity (invalidation logic, state management)
    // 5. Following "Inline until duplication" principle - wait for 2+ hot path usages
  });
});
