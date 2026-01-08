/**
 * Stats Command: View Glicko-2 ratings for judges, models, modules, and categories.
 * 
 * Reads ratings from the ratings snapshot file and displays leaderboards
 * ranked by exposure (rating - 2*RD) for conservative ranking.
 */

import {
  RatingsStore,
  PairwiseStatsStore,
  computeExposure,
  KEY_PREFIX,
} from '../stats';
import { c } from '../util';
import type { StatsGroupBy } from '../cli/types';

export interface StatsOptions {
  groupBy: StatsGroupBy;
  limit: number;
  json: boolean;
}

/** Rating entry for display */
interface RatingEntry {
  key: string;
  displayKey: string;
  rating: number;
  rd: number;
  vol: number;
  exposure: number;
  games: number;
  lastTs?: string;
}

/**
 * Get the key prefix for the groupBy mode.
 */
function getKeyPrefix(groupBy: StatsGroupBy): string {
  switch (groupBy) {
    case 'judge': return KEY_PREFIX.JUDGE;
    case 'model': return KEY_PREFIX.MODEL;
    case 'module': return KEY_PREFIX.MODULE;
    case 'category': return KEY_PREFIX.CATEGORY;
  }
}

/**
 * Strip prefix from key for display.
 */
function stripPrefix(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/**
 * Format a date for display.
 */
function formatDate(iso?: string): string {
  if (!iso) return 'never';
  
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Format rating with uncertainty indicator.
 */
function formatRating(rating: number, rd: number): string {
  const r = Math.round(rating);
  // High uncertainty (RD > 200): show ?
  // Medium uncertainty (RD > 100): show ~
  // Low uncertainty: show exact
  if (rd > 200) return `${r}?`;
  if (rd > 100) return `${r}~`;
  return `${r}`;
}

export async function handleStats(options: StatsOptions): Promise<void> {
  const ratingsStore = new RatingsStore();
  const pairwiseStore = new PairwiseStatsStore();
  
  const prefix = getKeyPrefix(options.groupBy);
  const ratings = await ratingsStore.getByPrefix(prefix);
  const runCount = await pairwiseStore.count();

  if (ratings.size === 0) {
    console.log('No ratings recorded yet.');
    console.log(c.dim('Run deep mode with --distribute-solvers to collect pairwise statistics.'));
    return;
  }

  // Build rating entries
  const entries: RatingEntry[] = [];
  for (const [key, state] of ratings) {
    entries.push({
      key,
      displayKey: stripPrefix(key, prefix),
      rating: state.r,
      rd: state.rd,
      vol: state.vol,
      exposure: computeExposure(state),
      games: state.games,
      lastTs: state.lastTs,
    });
  }

  // Sort by exposure (conservative ranking), then by games, then by key
  entries.sort((a, b) => {
    if (Math.abs(a.exposure - b.exposure) > 0.1) return b.exposure - a.exposure;
    if (a.games !== b.games) return b.games - a.games;
    return a.displayKey.localeCompare(b.displayKey);
  });

  const ranked = entries.slice(0, options.limit);

  // JSON output
  if (options.json) {
    const output = ranked.map(e => ({
      key: e.displayKey,
      rating: Math.round(e.rating),
      rd: Math.round(e.rd),
      volatility: +e.vol.toFixed(4),
      exposure: Math.round(e.exposure),
      games: e.games,
      lastSeen: e.lastTs ?? null,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Human-readable output
  const modeLabel = options.groupBy === 'judge' ? 'Judge'
    : options.groupBy === 'model' ? 'Model'
    : options.groupBy === 'module' ? 'Module'
    : 'Category';

  console.log(`\n${c.cyan('Glicko-2 Ratings')} — ${modeLabel}s (${runCount} runs)\n`);
  console.log(c.dim('─'.repeat(80)));

  // Header
  const header = `${'#'.padStart(3)}  ${modeLabel.padEnd(35)} ${'Rating'.padStart(7)}  ${'RD'.padStart(4)}  ${'Games'.padStart(5)}  ${c.dim('Last')}`;
  console.log(header);
  console.log(c.dim('─'.repeat(80)));

  for (let i = 0; i < ranked.length; i++) {
    const e = ranked[i];
    const rank = `${i + 1}`.padStart(3);
    const displayKey = e.displayKey.length > 35 
      ? e.displayKey.slice(0, 32) + '...'
      : e.displayKey.padEnd(35);
    const rating = formatRating(e.rating, e.rd).padStart(7);
    const rd = `±${Math.round(e.rd)}`.padStart(4);
    const games = String(e.games).padStart(5);
    const lastSeen = formatDate(e.lastTs);

    // Color code by exposure
    let keyColor = (s: string) => s; // no color (default)
    if (e.exposure >= 1600) keyColor = c.green;
    else if (e.exposure >= 1450) keyColor = c.cyan;
    else if (e.exposure < 1350) keyColor = c.yellow;

    console.log(
      `${c.dim(rank)}  ${keyColor(displayKey)} ${rating}  ${c.dim(rd)}  ${games}  ${c.dim(lastSeen)}`
    );
  }

  console.log(c.dim('─'.repeat(80)));
  console.log(c.dim(`Showing top ${ranked.length} of ${entries.length} ${modeLabel.toLowerCase()}s`));
  console.log(c.dim(`Rating? = high uncertainty (RD>200), ~ = medium (RD>100)`));
}
