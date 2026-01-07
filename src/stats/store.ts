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
import type { StatEntry } from './types';

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
  async append(entry: StatEntry): Promise<void> {
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
  async readAll(): Promise<StatEntry[]> {
    const file = Bun.file(this.path);
    if (!await file.exists()) return [];

    const content = await file.text();
    const entries: StatEntry[] = [];

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        // Accept version 1 and 2
        if (parsed.version === 1 || parsed.version === 2) {
          // Normalize v1 to include judgeMode
          if (parsed.version === 1 && !parsed.judgeMode) {
            parsed.judgeMode = 'single';
          }
          entries.push(parsed as StatEntry);
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
}
