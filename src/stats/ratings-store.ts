/**
 * Ratings Store: Persistent Glicko-2 ratings snapshot.
 * 
 * Maintains a JSON file with current ratings for all entities.
 * Updates are applied atomically per rating period (one deep-think run).
 * 
 * Design: never throw into caller (best-effort, like StatsStore).
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { withLock } from '../util/lock';
import { getRatingsPath } from '../util/paths';
import type { RatingState, RatingsSnapshot, PairwiseStatEntry } from './pairwise-types';
import { glicko2UpdatePool } from './glicko2';
import { deriveAllMatches, mergeMatches } from './derive-matches';

export interface RatingsStoreOptions {
  baseDir?: string;
}

export class RatingsStore {
  private readonly path: string;

  constructor(options: RatingsStoreOptions = {}) {
    this.path = getRatingsPath(options.baseDir);
  }

  /**
   * Load current ratings snapshot.
   * Returns empty map if file doesn't exist or is malformed.
   */
  async load(): Promise<Map<string, RatingState>> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) {
        return new Map();
      }

      const content = await file.text();
      const snapshot: RatingsSnapshot = JSON.parse(content);

      if (snapshot.version !== 1) {
        return new Map();
      }

      return new Map(Object.entries(snapshot.entities));
    } catch {
      return new Map();
    }
  }

  /**
   * Save ratings snapshot.
   */
  async save(ratings: Map<string, RatingState>): Promise<void> {
    await withLock(this.path, async () => {
      await mkdir(dirname(this.path), { recursive: true });

      const snapshot: RatingsSnapshot = {
        version: 1,
        updatedAt: new Date().toISOString(),
        entities: Object.fromEntries(ratings),
      };

      await Bun.write(this.path, JSON.stringify(snapshot, null, 2));
    });
  }

  /**
   * Apply a rating period update from a pairwise stat entry.
   * This is the main entry point called after each deep-think run.
   * 
   * Best-effort: catches all errors and returns silently.
   */
  async applyRatingPeriod(entry: PairwiseStatEntry): Promise<void> {
    try {
      await withLock(this.path, async () => {
        // Load current ratings
        const current = await this.loadUnlocked();

        // Derive matches for all entity types
        const { judges, models, modules, categories } = deriveAllMatches(entry);

        // Merge all matches into a single pool for unified update
        const allMatches = mergeMatches(judges, models, modules, categories);

        // Update all ratings simultaneously
        const updated = glicko2UpdatePool(current, allMatches);

        // Save updated ratings
        await this.saveUnlocked(updated);
      });
    } catch {
      // Best-effort: don't fail the pipeline
    }
  }

  /**
   * Get ratings for a specific entity type prefix.
   */
  async getByPrefix(prefix: string): Promise<Map<string, RatingState>> {
    const all = await this.load();
    const filtered = new Map<string, RatingState>();

    for (const [key, state] of all) {
      if (key.startsWith(prefix)) {
        filtered.set(key, state);
      }
    }

    return filtered;
  }

  /**
   * Internal load without lock (for use within locked context).
   */
  private async loadUnlocked(): Promise<Map<string, RatingState>> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) {
        return new Map();
      }

      const content = await file.text();
      const snapshot: RatingsSnapshot = JSON.parse(content);

      if (snapshot.version !== 1) {
        return new Map();
      }

      return new Map(Object.entries(snapshot.entities));
    } catch {
      return new Map();
    }
  }

  /**
   * Internal save without lock (for use within locked context).
   */
  private async saveUnlocked(ratings: Map<string, RatingState>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });

    const snapshot: RatingsSnapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entities: Object.fromEntries(ratings),
    };

    await Bun.write(this.path, JSON.stringify(snapshot, null, 2));
  }
}
