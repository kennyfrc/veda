import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConversationStore } from '../../src/conversation/store';

const TEST_BASE = join(tmpdir(), 'veda-conv-test-' + process.pid + '-' + Date.now());
const TEST_SESSION = 'test-session';

function createTestStore(sessionId: string = TEST_SESSION): ConversationStore {
  return new ConversationStore({
    sessionId,
    baseDir: TEST_BASE,
  });
}

describe('ConversationStore', () => {
  beforeEach(async () => {
    await mkdir(TEST_BASE, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('validates session ID', () => {
    expect(() => new ConversationStore({ sessionId: '' })).toThrow('Invalid session ID');
  });

  test('save and load thread info', async () => {
    const store = createTestStore();
    
    await store.save({
      backend: 'codex',
      threadId: 'abc-123-def',
    });
    
    const loaded = await store.load();
    
    expect(loaded).not.toBeNull();
    expect(loaded?.backend).toBe('codex');
    expect(loaded?.threadId).toBe('abc-123-def');
    expect(loaded?.createdAt).toBeDefined();
    expect(loaded?.lastUsedAt).toBeDefined();
  });

  test('preserves createdAt on update', async () => {
    const store = createTestStore();
    
    await store.save({
      backend: 'codex',
      threadId: 'first-id',
    });
    
    const first = await store.load();
    const createdAt = first?.createdAt;
    
    // Wait a bit to ensure timestamps differ
    await new Promise(r => setTimeout(r, 10));
    
    await store.save({
      backend: 'codex',
      threadId: 'second-id',
    });
    
    const second = await store.load();
    
    expect(second?.createdAt).toBe(createdAt);
    expect(second?.threadId).toBe('second-id');
  });

  test('getThreadId returns thread ID', async () => {
    const store = createTestStore();
    
    await store.save({
      backend: 'codex',
      threadId: 'my-thread-id',
    });
    
    const threadId = await store.getThreadId();
    expect(threadId).toBe('my-thread-id');
  });

  test('getBackend returns backend name', async () => {
    const store = createTestStore();
    
    await store.save({
      backend: 'claude',
      threadId: 'some-id',
    });
    
    const backend = await store.getBackend();
    expect(backend).toBe('claude');
  });

  test('returns null when no thread exists', async () => {
    const store = createTestStore();
    
    const loaded = await store.load();
    expect(loaded).toBeNull();
    
    const threadId = await store.getThreadId();
    expect(threadId).toBeNull();
  });

  test('clear removes thread info', async () => {
    const store = createTestStore();
    
    await store.save({
      backend: 'codex',
      threadId: 'test-id',
    });
    
    expect(await store.exists()).toBe(true);
    
    await store.clear();
    
    expect(await store.exists()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  test('exists returns correct state', async () => {
    const store = createTestStore();
    
    expect(await store.exists()).toBe(false);
    
    await store.save({
      backend: 'codex',
      threadId: 'test-id',
    });
    
    expect(await store.exists()).toBe(true);
  });

  test('migrates from legacy format', async () => {
    // Create legacy format file
    const legacyDir = join(TEST_BASE, 'sessions', TEST_SESSION);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'codex_thread_id'), 'legacy-thread-id\n');
    
    const store = createTestStore();
    
    const loaded = await store.load();
    
    expect(loaded).not.toBeNull();
    expect(loaded?.backend).toBe('codex'); // Legacy was always codex
    expect(loaded?.threadId).toBe('legacy-thread-id');
  });

  test('separate sessions have separate threads', async () => {
    const store1 = createTestStore('session-1');
    const store2 = createTestStore('session-2');
    
    await store1.save({ backend: 'codex', threadId: 'thread-1' });
    await store2.save({ backend: 'claude', threadId: 'thread-2' });
    
    expect(await store1.getThreadId()).toBe('thread-1');
    expect(await store2.getThreadId()).toBe('thread-2');
    expect(await store1.getBackend()).toBe('codex');
    expect(await store2.getBackend()).toBe('claude');
  });
});
