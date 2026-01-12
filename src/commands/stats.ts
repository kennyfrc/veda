/**
 * Stats command: Glicko-2 leaderboards ranked by exposure (rating - 2*RD).
 */

import {
  RatingsStore,
  PairwiseStatsStore,
  StatsStore,
  computeExposure,
  wilsonLower,
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
    const glicko2Ratings = ranked.map(e => ({
      key: e.displayKey,
      rating: Math.round(e.rating),
      rd: Math.round(e.rd),
      volatility: +e.vol.toFixed(4),
      exposure: Math.round(e.exposure),
      games: e.games,
      lastSeen: e.lastTs ?? null,
    }));
    
    // For module groupBy, include single-judge win rates alongside Glicko-2
    if (options.groupBy === 'module') {
      const statsStore = new StatsStore();
      const winRates = await statsStore.getModuleWinRates();
      
      const singleJudgeWinRates = [...winRates.values()]
        .map(m => ({ ...m, wilsonLB: wilsonLower(m.wins, m.appearances) }))
        .sort((a, b) => b.wilsonLB - a.wilsonLB || b.appearances - a.appearances)
        .slice(0, options.limit)
        .map(m => ({
          key: m.moduleKey,
          wins: m.wins,
          appearances: m.appearances,
          winRate: +m.winRate.toFixed(4),
          wilsonLower: +m.wilsonLB.toFixed(4),
          avgConfidence: +m.avgConfidence.toFixed(4),
          lastSeen: m.lastSeen,
        }));
      
      console.log(JSON.stringify({
        glicko2Ratings,
        singleJudgeWinRates,
      }, null, 2));
    } else {
      console.log(JSON.stringify(glicko2Ratings, null, 2));
    }
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

  // Show single-judge win rates for module groupBy
  if (options.groupBy === 'module') {
    await displaySingleJudgeWinRates(options);
  }
}

/**
 * Display single-judge module win rates.
 * Shown after Glicko-2 ratings when groupBy is 'module'.
 */
async function displaySingleJudgeWinRates(options: StatsOptions): Promise<void> {
  const statsStore = new StatsStore();
  const winRates = await statsStore.getModuleWinRates();

  if (winRates.size === 0) {
    return; // No single-judge stats, skip this section
  }

  // JSON output is handled in handleStats() to combine with Glicko-2 ratings
  if (options.json) {
    return;
  }

  // Sort by Wilson lower bound (more meaningful than raw win rate for small samples)
  const sorted = [...winRates.values()]
    .map(m => ({ ...m, wilsonLB: wilsonLower(m.wins, m.appearances) }))
    .sort((a, b) => b.wilsonLB - a.wilsonLB || b.appearances - a.appearances)
    .slice(0, options.limit);

  const runCount = await statsStore.count();

  console.log(`\n${c.cyan('Single-Judge Win Rates')} — Modules (${runCount} runs)\n`);
  console.log(c.dim('─'.repeat(75)));
  console.log(`${'#'.padStart(3)}  ${'Module'.padEnd(35)} ${'Win%'.padStart(6)}  ${'W/A'.padStart(7)}  ${'≥LB'.padStart(5)}  ${c.dim('Last')}`);
  console.log(c.dim('─'.repeat(75)));

  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const rank = `${i + 1}`.padStart(3);
    const displayKey = m.moduleKey.length > 35
      ? m.moduleKey.slice(0, 32) + '...'
      : m.moduleKey.padEnd(35);
    const pct = `${(m.winRate * 100).toFixed(1)}%`.padStart(6);
    const ratio = `${m.wins}/${m.appearances}`.padStart(7);
    const lb = `≥${Math.round(m.wilsonLB * 100)}%`.padStart(5);
    const lastSeen = formatDate(m.lastSeen);

    // Color based on Wilson lower bound (more reliable than raw win rate)
    let keyColor = (s: string) => s;
    if (m.wilsonLB >= 0.15) keyColor = c.green;
    else if (m.wilsonLB >= 0.05) keyColor = c.cyan;
    else if (m.appearances >= 5 && m.wilsonLB < 0.05) keyColor = c.yellow;

    console.log(
      `${c.dim(rank)}  ${keyColor(displayKey)} ${pct}  ${ratio}  ${c.dim(lb)}  ${c.dim(lastSeen)}`
    );
  }

  console.log(c.dim('─'.repeat(75)));
  console.log(c.dim(`Showing top ${sorted.length} of ${winRates.size} modules (sorted by Wilson lower bound)`));
  console.log(c.dim(`≥LB = 95% confidence lower bound on true win rate`));
}
