/**
 * Persistent Glicko-2 ratings snapshot. Never throws (best-effort).
 * Updates applied atomically per rating period (one deep-think run).
 */

import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { withLock } from '../util/lock';
import { getRatingsPath } from '../util/paths';
import type {
  RatingState,
  RatingsSnapshotV2,
  AnyRatingsSnapshot,
  AnyPairwiseStatEntry,
  EraRef,
  MatchesByKey,
  Match,
} from './pairwise-types';
import { glicko2UpdatePool } from './glicko2';
import { deriveAllMatches, mergeMatches } from './derive-matches';
import { getCurrentEra, addEraSuffix, extractEraFromKey } from '../core/era';

export interface RatingsStoreOptions {
  baseDir?: string;
}

export class RatingsStore {
  private readonly path: string;

  constructor(options: RatingsStoreOptions = {}) {
    this.path = getRatingsPath(options.baseDir);
  }

  async load(): Promise<Map<string, RatingState>> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return new Map();

      const snapshot: AnyRatingsSnapshot = JSON.parse(await file.text());
      if (snapshot.version !== 1 && snapshot.version !== 2) return new Map();

      return new Map(Object.entries(snapshot.entities));
    } catch {
      return new Map();
    }
  }

  async loadCurrentEra(): Promise<EraRef | undefined> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return undefined;

      const snapshot: AnyRatingsSnapshot = JSON.parse(await file.text());
      return snapshot.version === 2 ? snapshot.currentEra : undefined;
    } catch {
      return undefined;
    }
  }

  async save(ratings: Map<string, RatingState>): Promise<void> {
    await withLock(this.path, async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const snapshot: RatingsSnapshotV2 = {
        version: 2,
        updatedAt: new Date().toISOString(),
        currentEra: getCurrentEra(),
        entities: Object.fromEntries(ratings),
      };
      await Bun.write(this.path, JSON.stringify(snapshot, null, 2));
    });
  }

  /**
   * v2 entries get @{eraId} suffix on keys; v1 (legacy) keys stay unsuffixed.
   * This prevents mixing ratings across different module catalog versions.
   */
  async applyRatingPeriod(entry: AnyPairwiseStatEntry): Promise<void> {
    try {
      await withLock(this.path, async () => {
        const current = await this.loadUnlocked();
        const { judges, models, modules, categories } = deriveAllMatches(entry);
        const allMatches = mergeMatches(judges, models, modules, categories);
        const namespacedMatches = this.namespaceMatchesByEra(allMatches, entry);
        const updated = glicko2UpdatePool(current, namespacedMatches);
        await this.saveUnlocked(updated);
      });
    } catch {
      // Best-effort: don't fail the pipeline
    }
  }

  private namespaceMatchesByEra(
    matches: MatchesByKey,
    entry: AnyPairwiseStatEntry
  ): MatchesByKey {
    if (entry.version === 1) return matches;

    const eraId = entry.era.id;
    const namespaced: MatchesByKey = new Map();

    for (const [key, matchList] of matches) {
      const namespacedKey = addEraSuffix(key, eraId);
      const namespacedMatches: Match[] = matchList.map(m => ({
        opponentKey: addEraSuffix(m.opponentKey, eraId),
        score: m.score,
      }));
      namespaced.set(namespacedKey, namespacedMatches);
    }

    return namespaced;
  }

  async getByPrefix(
    prefix: string,
    eraSelector: string = 'current'
  ): Promise<Map<string, RatingState>> {
    const all = await this.load();
    const filtered = new Map<string, RatingState>();
    const currentEra = getCurrentEra();

    for (const [key, state] of all) {
      if (!key.startsWith(prefix)) continue;

      const keyEra = extractEraFromKey(key);

      if (eraSelector === 'all') {
        filtered.set(key, state);
      } else if (eraSelector === 'legacy') {
        if (!keyEra) filtered.set(key, state);
      } else if (eraSelector === 'current') {
        if (keyEra === currentEra.id) filtered.set(key, state);
      } else {
        if (keyEra === eraSelector) filtered.set(key, state);
      }
    }

    return filtered;
  }

  private async loadUnlocked(): Promise<Map<string, RatingState>> {
    try {
      const file = Bun.file(this.path);
      if (!await file.exists()) return new Map();

      const snapshot: AnyRatingsSnapshot = JSON.parse(await file.text());
      if (snapshot.version !== 1 && snapshot.version !== 2) return new Map();

      return new Map(Object.entries(snapshot.entities));
    } catch {
      return new Map();
    }
  }

  private async saveUnlocked(ratings: Map<string, RatingState>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const snapshot: RatingsSnapshotV2 = {
      version: 2,
      updatedAt: new Date().toISOString(),
      currentEra: getCurrentEra(),
      entities: Object.fromEntries(ratings),
    };
    await Bun.write(this.path, JSON.stringify(snapshot, null, 2));
  }
}
