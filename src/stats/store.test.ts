/**
 * Tests for single-judge stats (v3 entries).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { StatsStore } from './store';
import type { StatEntryV3 } from './types';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('StatsStore v3 (single-judge)', () => {
  const testDir = join(tmpdir(), `veda-test-${Date.now()}`);
  let store: StatsStore;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    store = new StatsStore({ baseDir: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('appends and reads v3 entries', async () => {
    const entry: StatEntryV3 = {
      version: 3,
      timestamp: new Date().toISOString(),
      promptHash: 'abcd1234abcd1234',
      runId: 'test-run-1',
      judgeMode: 'single',
      judge: { backend: 'claude-code', model: 'opus' },
      winner: { category: 'strategic', moduleId: 'contradiction_resolution' },
      participants: [
        { category: 'strategic', moduleId: 'contradiction_resolution' },
        { category: 'analytical', moduleId: 'edge_case_analysis' },
        { category: 'debugging', moduleId: 'print_debugging' },
      ],
      confidence: { level: 'high', score: 0.9 },
    };

    await store.append(entry);

    const entries = await store.readAll();
    expect(entries.length).toBe(1);
    expect(entries[0].version).toBe(3);
    expect((entries[0] as StatEntryV3).winner.moduleId).toBe('contradiction_resolution');
  });

  it('computes module win rates correctly', async () => {
    // Run 1: strategic/contradiction_resolution wins (3 participants)
    await store.append({
      version: 3,
      timestamp: '2026-01-01T00:00:00Z',
      promptHash: 'hash1',
      runId: 'run-1',
      judgeMode: 'single',
      judge: { backend: 'claude', model: 'opus' },
      winner: { category: 'strategic', moduleId: 'contradiction_resolution' },
      participants: [
        { category: 'strategic', moduleId: 'contradiction_resolution' },
        { category: 'analytical', moduleId: 'edge_case_analysis' },
        { category: 'debugging', moduleId: 'print_debugging' },
      ],
      confidence: { level: 'high', score: 0.9 },
    });

    // Run 2: analytical/edge_case_analysis wins (3 participants)
    await store.append({
      version: 3,
      timestamp: '2026-01-02T00:00:00Z',
      promptHash: 'hash2',
      runId: 'run-2',
      judgeMode: 'single',
      judge: { backend: 'claude', model: 'opus' },
      winner: { category: 'analytical', moduleId: 'edge_case_analysis' },
      participants: [
        { category: 'strategic', moduleId: 'contradiction_resolution' },
        { category: 'analytical', moduleId: 'edge_case_analysis' },
        { category: 'debugging', moduleId: 'print_debugging' },
      ],
      confidence: { level: 'medium', score: 0.6 },
    });

    // Run 3: strategic/contradiction_resolution wins again (different participants)
    await store.append({
      version: 3,
      timestamp: '2026-01-03T00:00:00Z',
      promptHash: 'hash3',
      runId: 'run-3',
      judgeMode: 'single',
      judge: { backend: 'claude', model: 'opus' },
      winner: { category: 'strategic', moduleId: 'contradiction_resolution' },
      participants: [
        { category: 'strategic', moduleId: 'contradiction_resolution' },
        { category: 'creative', moduleId: 'novel_solution' },
      ],
      confidence: { level: 'high', score: 0.85 },
    });

    const winRates = await store.getModuleWinRates();

    // strategic/contradiction_resolution: 2 wins / 3 appearances = 0.667
    const strategic = winRates.get('strategic/contradiction_resolution');
    expect(strategic).toBeDefined();
    expect(strategic!.wins).toBe(2);
    expect(strategic!.appearances).toBe(3);
    expect(strategic!.winRate).toBeCloseTo(2 / 3, 3);
    expect(strategic!.avgConfidence).toBeCloseTo((0.9 + 0.85) / 2, 3);

    // analytical/edge_case_analysis: 1 win / 2 appearances = 0.5
    const analytical = winRates.get('analytical/edge_case_analysis');
    expect(analytical).toBeDefined();
    expect(analytical!.wins).toBe(1);
    expect(analytical!.appearances).toBe(2);
    expect(analytical!.winRate).toBe(0.5);

    // debugging/print_debugging: 0 wins / 2 appearances = 0
    const debugging = winRates.get('debugging/print_debugging');
    expect(debugging).toBeDefined();
    expect(debugging!.wins).toBe(0);
    expect(debugging!.appearances).toBe(2);
    expect(debugging!.winRate).toBe(0);

    // creative/novel_solution: 0 wins / 1 appearance = 0
    const creative = winRates.get('creative/novel_solution');
    expect(creative).toBeDefined();
    expect(creative!.wins).toBe(0);
    expect(creative!.appearances).toBe(1);
    expect(creative!.winRate).toBe(0);
  });

  it('returns runIds for deduplication', async () => {
    await store.append({
      version: 3,
      timestamp: new Date().toISOString(),
      promptHash: 'hash1',
      runId: 'unique-run-id-1',
      judgeMode: 'single',
      judge: { backend: 'claude', model: 'opus' },
      winner: { category: 'strategic', moduleId: 'test' },
      participants: [{ category: 'strategic', moduleId: 'test' }],
      confidence: { level: 'high', score: 0.9 },
    });

    await store.append({
      version: 3,
      timestamp: new Date().toISOString(),
      promptHash: 'hash2',
      runId: 'unique-run-id-2',
      judgeMode: 'single',
      judge: { backend: 'claude', model: 'opus' },
      winner: { category: 'analytical', moduleId: 'test2' },
      participants: [{ category: 'analytical', moduleId: 'test2' }],
      confidence: { level: 'medium', score: 0.5 },
    });

    const runIds = await store.getRunIds();
    expect(runIds.size).toBe(2);
    expect(runIds.has('unique-run-id-1')).toBe(true);
    expect(runIds.has('unique-run-id-2')).toBe(true);
  });
});
