/**
 * Append-only JSONL storage for pairwise judge results.
 * Each entry = one deep-think run with all votes and pair results.
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { withLock } from '../util/lock';
import { getPairwiseStatsPath } from '../util/paths';
import type { AnyPairwiseStatEntry } from './pairwise-types';
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

  /** Best-effort append + ratings update. */
  async append(entry: AnyPairwiseStatEntry): Promise<void> {
    try {
      await withLock(this.path, async () => {
        await mkdir(dirname(this.path), { recursive: true });
        const line = JSON.stringify(entry) + '\n';
        const file = Bun.file(this.path);
        const existing = await file.exists() ? await file.text() : '';
        await Bun.write(this.path, existing + line);
      });
      await this.ratingsStore.applyRatingPeriod(entry);
    } catch {
      // Best-effort: don't fail the pipeline
    }
  }

  async readAll(): Promise<AnyPairwiseStatEntry[]> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return [];

      const content = await file.text();
      const entries: AnyPairwiseStatEntry[] = [];

      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if ((parsed.version === 1 || parsed.version === 2) && parsed.judgeMode === 'pairwise') {
            entries.push(parsed as AnyPairwiseStatEntry);
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

  async countByEra(eraId: string | 'legacy'): Promise<number> {
    const entries = await this.readAll();
    return entries.filter(e => {
      if (eraId === 'legacy') return e.version === 1;
      return e.version === 2 && e.era.id === eraId;
    }).length;
  }
}
