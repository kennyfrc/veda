import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { CheckpointStore, computeRunIdentityHash, type DeepThinkCheckpoint } from '../../src/checkpoint';

describe('CheckpointStore', () => {
  let tempDir: string;
  let store: CheckpointStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'veda-checkpoint-test-'));
    store = new CheckpointStore({ sessionId: 'test-session', baseDir: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createTestCheckpoint(overrides: Partial<DeepThinkCheckpoint> = {}): DeepThinkCheckpoint {
    return {
      checkpoint_version: 1,
      runIdentityHash: 'abc123def456789',
      trace: {
        trace_version: 2,
        prompt: 'test prompt',
        options: {
          backend: 'codex',
          k: 3,
          verify: true,
        },
        solve: {
          candidates: [
            { id: 'solver-0-codex-gpt-5.2-analytical/test', module: { id: 'test', category: 'analytical', name: 'Test' }, response: 'answer 1' },
            { id: 'solver-1-codex-gpt-5.2-creative/test2', module: { id: 'test2', category: 'creative', name: 'Test2' }, response: 'answer 2' },
          ],
        },
        judge: {
          selectedIndex: 0,
          selectedDisplayIndex: 1,
          confidence: 0.8,
        },
      },
      status: 'partial',
      completedStage: 'judge',
      failedStage: 'verify',
      error: 'API rate limit exceeded',
      timestamp: new Date().toISOString(),
      successfulCandidateIds: [
        'solver-0-codex-gpt-5.2-analytical/test',
        'solver-1-codex-gpt-5.2-creative/test2',
      ],
      judgeSeed: 'test-seed-123',
      judgeIndexMapping: [1, 0],
      judgeSelectedIndex: 0,
      judgeSelectedDisplayIndex: 2,
      selectedCandidateId: 'solver-0-codex-gpt-5.2-analytical/test',
      usageAtCheckpoint: {
        inputTokens: 10000,
        outputTokens: 2000,
      },
      ...overrides,
    };
  }

  test('exists returns false when no checkpoint', async () => {
    expect(await store.exists()).toBe(false);
  });

  test('save and load roundtrip', async () => {
    const checkpoint = createTestCheckpoint();
    
    await store.save(checkpoint);
    expect(await store.exists()).toBe(true);
    
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.checkpoint_version).toBe(1);
    expect(loaded!.runIdentityHash).toBe(checkpoint.runIdentityHash);
    expect(loaded!.status).toBe('partial');
    expect(loaded!.completedStage).toBe('judge');
    expect(loaded!.failedStage).toBe('verify');
    expect(loaded!.successfulCandidateIds).toEqual(checkpoint.successfulCandidateIds);
    expect(loaded!.trace.prompt).toBe('test prompt');
  });

  test('clear removes checkpoint', async () => {
    await store.save(createTestCheckpoint());
    expect(await store.exists()).toBe(true);
    
    await store.clear();
    expect(await store.exists()).toBe(false);
    expect(await store.load()).toBeNull();
  });

  test('getSummary returns summary without full load', async () => {
    await store.save(createTestCheckpoint({
      completedStage: 'solve',
      failedStage: 'judge',
    }));
    
    const summary = await store.getSummary();
    expect(summary).not.toBeNull();
    expect(summary!.completedStage).toBe('solve');
    expect(summary!.failedStage).toBe('judge');
    expect(summary!.candidateCount).toBe(2);
  });

  test('getSummary returns null when no checkpoint', async () => {
    const summary = await store.getSummary();
    expect(summary).toBeNull();
  });

  test('save updates timestamp', async () => {
    const checkpoint = createTestCheckpoint();
    const originalTimestamp = checkpoint.timestamp;
    
    // Wait a bit to ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    
    await store.save(checkpoint);
    const loaded = await store.load();
    
    expect(loaded!.timestamp).not.toBe(originalTimestamp);
  });

  test('load returns null for invalid checkpoint version', async () => {
    // Write invalid checkpoint directly
    const invalidCheckpoint = { checkpoint_version: 99, foo: 'bar' };
    const yaml = require('yaml').stringify(invalidCheckpoint);
    await Bun.write(join(tempDir, 'sessions', 'test-session', 'checkpoint.yaml'), yaml);
    
    // Recreate store to pick up the file
    store = new CheckpointStore({ sessionId: 'test-session', baseDir: tempDir });
    
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });
});

describe('computeRunIdentityHash', () => {
  test('produces consistent hash for same inputs', () => {
    const inputs = {
      prompt: 'test prompt',
      context: 'test context',
      options: { k: 3, verify: true },
    };
    
    const hash1 = computeRunIdentityHash(inputs);
    const hash2 = computeRunIdentityHash(inputs);
    
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  test('produces different hash for different inputs', () => {
    const hash1 = computeRunIdentityHash({
      prompt: 'prompt 1',
      options: { k: 3 },
    });
    
    const hash2 = computeRunIdentityHash({
      prompt: 'prompt 2',
      options: { k: 3 },
    });
    
    expect(hash1).not.toBe(hash2);
  });

  test('context affects hash', () => {
    const hash1 = computeRunIdentityHash({
      prompt: 'test',
      context: 'context A',
      options: {},
    });
    
    const hash2 = computeRunIdentityHash({
      prompt: 'test',
      context: 'context B',
      options: {},
    });
    
    expect(hash1).not.toBe(hash2);
  });

  test('options affect hash', () => {
    const hash1 = computeRunIdentityHash({
      prompt: 'test',
      options: { k: 3 },
    });
    
    const hash2 = computeRunIdentityHash({
      prompt: 'test',
      options: { k: 5 },
    });
    
    expect(hash1).not.toBe(hash2);
  });
});
