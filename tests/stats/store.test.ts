import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StatsStore, type StatEntry } from '../../src/stats';

describe('StatsStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'veda-stats-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const makeEntry = (overrides: Partial<StatEntry> = {}): StatEntry => ({
    version: 1,
    timestamp: new Date().toISOString(),
    promptHash: 'abc123def456gh78',
    judge: { backend: 'codex', model: 'gpt-5.2' },
    winner: {
      category: 'analytical',
      moduleId: 'so_what_test',
      backend: 'codex',
      model: 'gpt-5.2',
    },
    confidence: { level: 'high', score: 0.9 },
    ...overrides,
  });

  test('readAll returns empty array when no file exists', async () => {
    const store = new StatsStore({ baseDir: tempDir });
    const entries = await store.readAll();
    expect(entries).toEqual([]);
  });

  test('append and readAll roundtrip', async () => {
    const store = new StatsStore({ baseDir: tempDir });
    const entry1 = makeEntry({ promptHash: 'hash1' });
    const entry2 = makeEntry({ promptHash: 'hash2', winner: { ...makeEntry().winner, category: 'creative' } });

    await store.append(entry1);
    await store.append(entry2);

    const entries = await store.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].promptHash).toBe('hash1');
    expect(entries[1].promptHash).toBe('hash2');
    expect(entries[1].winner.category).toBe('creative');
  });

  test('readAll skips malformed lines', async () => {
    const store = new StatsStore({ baseDir: tempDir });
    const validEntry = makeEntry();

    // Write a valid entry first
    await store.append(validEntry);

    // Manually append a malformed line
    const file = Bun.file(join(tempDir, 'judge-stats.jsonl'));
    const content = await file.text();
    await Bun.write(join(tempDir, 'judge-stats.jsonl'), content + '{ invalid json }\n');

    // Append another valid entry
    await store.append(makeEntry({ promptHash: 'hash2' }));

    const entries = await store.readAll();
    expect(entries).toHaveLength(2);  // Should skip the malformed line
  });

  test('readAll skips entries with unknown version', async () => {
    const store = new StatsStore({ baseDir: tempDir });

    // Write entry with version 1
    await store.append(makeEntry());

    // Manually append an entry with version 99
    const file = Bun.file(join(tempDir, 'judge-stats.jsonl'));
    const content = await file.text();
    const futureEntry = { ...makeEntry(), version: 99 };
    await Bun.write(join(tempDir, 'judge-stats.jsonl'), content + JSON.stringify(futureEntry) + '\n');

    const entries = await store.readAll();
    expect(entries).toHaveLength(1);  // Should skip the version 99 entry
    expect(entries[0].version).toBe(1);
  });

  test('count returns correct number of entries', async () => {
    const store = new StatsStore({ baseDir: tempDir });

    expect(await store.count()).toBe(0);

    await store.append(makeEntry());
    expect(await store.count()).toBe(1);

    await store.append(makeEntry());
    await store.append(makeEntry());
    expect(await store.count()).toBe(3);
  });

  test('preserves all fields in roundtrip', async () => {
    const store = new StatsStore({ baseDir: tempDir });
    const entry: StatEntry = {
      version: 1,
      timestamp: '2025-01-02T12:00:00.000Z',
      promptHash: '1234567890abcdef',
      judge: { backend: 'claude-code', model: 'opus' },
      winner: {
        category: 'systematic',
        moduleId: 'mece_decomposition',
        backend: 'gemini-cli',
        model: 'gemini-3-pro-preview',
      },
      confidence: { level: 'medium', score: 0.5 },
    };

    await store.append(entry);
    const [retrieved] = await store.readAll();

    // v1 entries get judgeMode: 'single' added on read (normalization)
    expect(retrieved).toEqual({ ...entry, judgeMode: 'single' });
  });
  
  test('handles v2 entries with multi-judge mode', async () => {
    const store = new StatsStore({ baseDir: tempDir });
    const entry: StatEntry = {
      version: 2,
      timestamp: '2025-01-02T12:00:00.000Z',
      promptHash: '1234567890abcdef',
      judgeMode: 'multi',
      judge: { backend: 'claude-code', model: 'opus' },
      judges: [
        { backend: 'claude-code', model: 'opus' },
        { backend: 'codex', model: 'gpt-5.2' },
      ],
      winner: {
        category: 'systematic',
        moduleId: 'mece_decomposition',
        backend: 'gemini-cli',
        model: 'gemini-3-pro-preview',
      },
      confidence: { level: 'high', score: 0.85 },
      aggregatedConfidence: {
        level: 'high',
        score: 0.85,
        winMargin: 0.15,
        judgeCount: 2,
      },
    };

    await store.append(entry);
    const [retrieved] = await store.readAll();

    expect(retrieved).toEqual(entry);
    expect(retrieved.judgeMode).toBe('multi');
    expect(retrieved.judges).toHaveLength(2);
  });
});
