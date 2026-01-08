/**
 * PairwiseStatsStore: Append-only JSONL storage for pairwise judge results.
 * 
 * Stores full pairwise matchup data for Glicko-2 rating derivation.
 * Each entry = one deep-think run with all votes and pair results.
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { withLock } from '../util/lock';
import { getPairwiseStatsPath } from '../util/paths';
import type { PairwiseStatEntry } from './pairwise-types';
import { RatingsStore } from './ratings-store';

export interface PairwiseStatsStoreOptions {
  baseDir?: string;
}

export class PairwiseStatsStore {
  private readonly path: string;
  private readonly ratingsStore: RatingsStore;

  constructor(options: PairwiseStatsStoreOptions = {}) {
    this.path = getPairwiseStatsPath(options.baseDir);
    this.ratingsStore = new RatingsStore(options);
  }

  /**
   * Append a pairwise stat entry and update ratings.
   * Uses file locking for concurrency safety.
   * Best-effort: catches errors silently.
   */
  async append(entry: PairwiseStatEntry): Promise<void> {
    try {
      await withLock(this.path, async () => {
        await mkdir(dirname(this.path), { recursive: true });

        const line = JSON.stringify(entry) + '\n';
        const file = Bun.file(this.path);
        const existing = await file.exists() ? await file.text() : '';
        await Bun.write(this.path, existing + line);
      });

      // Update ratings after successful append
      await this.ratingsStore.applyRatingPeriod(entry);
    } catch {
      // Best-effort: don't fail the pipeline
    }
  }

  /**
   * Read all valid entries from the log.
   */
  async readAll(): Promise<PairwiseStatEntry[]> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return [];

      const content = await file.text();
      const entries: PairwiseStatEntry[] = [];

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.version === 1 && parsed.judgeMode === 'pairwise') {
            entries.push(parsed as PairwiseStatEntry);
          }
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Get count of entries.
   */
  async count(): Promise<number> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return 0;

      const content = await file.text();
      return content.split('\n').filter(line => line.trim()).length;
    } catch {
      return 0;
    }
  }
}
