/**
 * Stats command: Glicko-2 leaderboards ranked by exposure (rating - 2*RD).
 */

import {
  RatingsStore,
  PairwiseStatsStore,
  computeExposure,
  KEY_PREFIX,
  type EraSelector,
} from '../stats';
import { c } from '../util';
import type { StatsGroupBy } from '../cli/types';
import { getCurrentEra, stripEraSuffix } from '../core/era';

export interface StatsOptions {
  groupBy: StatsGroupBy;
  limit: number;
  json: boolean;
  era: EraSelector;
}

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

function getKeyPrefix(groupBy: StatsGroupBy): string {
  switch (groupBy) {
    case 'judge': return KEY_PREFIX.JUDGE;
    case 'model': return KEY_PREFIX.MODEL;
    case 'module': return KEY_PREFIX.MODULE;
    case 'category': return KEY_PREFIX.CATEGORY;
  }
}

function stripPrefix(key: string, prefix: string): string {
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

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

function formatRating(rating: number, rd: number): string {
  const r = Math.round(rating);
  if (rd > 200) return `${r}?`;  // high uncertainty
  if (rd > 100) return `${r}~`;  // medium uncertainty
  return `${r}`;
}

export async function handleStats(options: StatsOptions): Promise<void> {
  const ratingsStore = new RatingsStore();
  const pairwiseStore = new PairwiseStatsStore();
  const currentEra = getCurrentEra();

  const prefix = getKeyPrefix(options.groupBy);
  const ratings = await ratingsStore.getByPrefix(prefix, options.era);

  let runCount: number;
  if (options.era === 'all') {
    runCount = await pairwiseStore.count();
  } else if (options.era === 'legacy') {
    runCount = await pairwiseStore.countByEra('legacy');
  } else if (options.era === 'current') {
    runCount = await pairwiseStore.countByEra(currentEra.id);
  } else {
    runCount = await pairwiseStore.countByEra(options.era);
  }

  if (ratings.size === 0) {
    if (options.era === 'current') {
      console.log(`No ratings recorded for current era (${currentEra.id}).`);
      console.log(c.dim('Run deep mode to collect statistics for the current module catalog.'));
      console.log(c.dim('Use --era legacy to view ratings from previous module versions.'));
    } else if (options.era === 'legacy') {
      console.log('No legacy ratings recorded.');
      console.log(c.dim('Legacy ratings are from runs before era tracking was added.'));
    } else {
      console.log('No ratings recorded yet.');
      console.log(c.dim('Run deep mode with --distribute-solvers to collect pairwise statistics.'));
    }
    return;
  }

  const entries: RatingEntry[] = [];
  for (const [key, state] of ratings) {
    const withoutEra = stripEraSuffix(key);
    entries.push({
      key,
      displayKey: stripPrefix(withoutEra, prefix),
      rating: state.r,
      rd: state.rd,
      vol: state.vol,
      exposure: computeExposure(state),
      games: state.games,
      lastTs: state.lastTs,
    });
  }

  entries.sort((a, b) => {
    if (Math.abs(a.exposure - b.exposure) > 0.1) return b.exposure - a.exposure;
    if (a.games !== b.games) return b.games - a.games;
    return a.displayKey.localeCompare(b.displayKey);
  });

  const ranked = entries.slice(0, options.limit);

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

  const modeLabel = options.groupBy === 'judge' ? 'Judge'
    : options.groupBy === 'model' ? 'Model'
    : options.groupBy === 'module' ? 'Module'
    : 'Category';

  let eraLabel: string;
  if (options.era === 'current') {
    eraLabel = `era: ${currentEra.id}`;
  } else if (options.era === 'legacy') {
    eraLabel = 'era: legacy';
  } else if (options.era === 'all') {
    eraLabel = 'all eras';
  } else {
    eraLabel = `era: ${options.era}`;
  }

  console.log(`\n${c.cyan('Glicko-2 Ratings')} — ${modeLabel}s (${eraLabel}, ${runCount} runs)\n`);

  if (options.era === 'legacy') {
    console.log(c.yellow('Warning: Legacy ratings may not reflect current module prompts.\n'));
  }

  console.log(c.dim('─'.repeat(80)));
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

    let keyColor = (s: string) => s;
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
