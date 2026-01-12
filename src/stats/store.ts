/**
 * StatsStore: Append-only JSONL storage for judge statistics.
 * 
 * Follows CheckpointStore pattern with file locking for concurrency safety.
 * Designed to never fail the caller on append (best-effort recording).
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { withLock } from '../util/lock';
import { getJudgeStatsPath } from '../util/paths';
import type { StatEntry, StatEntryV3, AnyStatEntry, ModuleWinRate } from './types';

export interface StatsStoreOptions {
  baseDir?: string;
}

export class StatsStore {
  private readonly path: string;

  constructor(options: StatsStoreOptions = {}) {
    this.path = getJudgeStatsPath(options.baseDir);
  }

  /**
   * Append a stat entry to the log.
   * Uses file locking for concurrency safety.
   */
  async append(entry: AnyStatEntry): Promise<void> {
    await withLock(this.path, async () => {
      await mkdir(dirname(this.path), { recursive: true });
      
      const line = JSON.stringify(entry) + '\n';
      const file = Bun.file(this.path);
      const existing = await file.exists() ? await file.text() : '';
      await Bun.write(this.path, existing + line);
    });
  }

  /**
   * Read all valid entries from the log.
   * Skips malformed lines and unknown versions gracefully.
   * Normalizes v1 entries to include judgeMode for uniform handling.
   */
  async readAll(): Promise<AnyStatEntry[]> {
    const file = Bun.file(this.path);
    if (!await file.exists()) return [];

    const content = await file.text();
    const entries: AnyStatEntry[] = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        // Accept version 1, 2, and 3
        if (parsed.version === 1 || parsed.version === 2) {
          // Normalize v1 to include judgeMode
          if (parsed.version === 1 && !parsed.judgeMode) {
            parsed.judgeMode = 'single';
          }
          entries.push(parsed as StatEntry);
        } else if (parsed.version === 3) {
          entries.push(parsed as StatEntryV3);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  }

  /**
   * Get the count of entries without loading all data.
   */
  async count(): Promise<number> {
    const file = Bun.file(this.path);
    if (!await file.exists()) return 0;

    const content = await file.text();
    return content.split('\n').filter(line => line.trim()).length;
  }

  /**
   * Get existing runIds for deduplication (v3 entries only).
   */
  async getRunIds(): Promise<Set<string>> {
    const entries = await this.readAll();
    const runIds = new Set<string>();
    for (const entry of entries) {
      if (entry.version === 3 && 'runId' in entry) {
        runIds.add(entry.runId);
      }
    }
    return runIds;
  }

  /**
   * Compute module win rates from v3 entries.
   * Returns map of moduleKey -> ModuleWinRate.
   */
  async getModuleWinRates(): Promise<Map<string, ModuleWinRate>> {
    const entries = await this.readAll();
    const stats = new Map<string, {
      wins: number;
      appearances: number;
      totalConfidence: number;
      lastSeen: string;
    }>();

    for (const entry of entries) {
      if (entry.version !== 3) continue;
      const v3 = entry as StatEntryV3;

      const winnerKey = `${v3.winner.category}/${v3.winner.moduleId}`;

      // Track appearances for all participants
      for (const p of v3.participants) {
        const key = `${p.category}/${p.moduleId}`;
        const existing = stats.get(key) ?? {
          wins: 0,
          appearances: 0,
          totalConfidence: 0,
          lastSeen: '',
        };
        existing.appearances++;
        if (key === winnerKey) {
          existing.wins++;
          existing.totalConfidence += v3.confidence.score;
        }
        if (v3.timestamp > existing.lastSeen) {
          existing.lastSeen = v3.timestamp;
        }
        stats.set(key, existing);
      }
    }

    // Convert to ModuleWinRate
    const result = new Map<string, ModuleWinRate>();
    for (const [key, s] of stats) {
      result.set(key, {
        moduleKey: key,
        wins: s.wins,
        appearances: s.appearances,
        winRate: s.appearances > 0 ? s.wins / s.appearances : 0,
        avgConfidence: s.wins > 0 ? s.totalConfidence / s.wins : 0,
        lastSeen: s.lastSeen,
      });
    }
    return result;
  }
}
