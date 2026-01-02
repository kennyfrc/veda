/**
 * Stats Command: View judge decision statistics.
 * 
 * Aggregates and displays statistics from judge-stats.jsonl,
 * enabling analysis of module win rates and judge behavior.
 */

import { StatsStore, type StatEntry, type GroupAgg, type GroupByMode } from '../stats';
import { c } from '../util';

export interface StatsOptions {
  groupBy: GroupByMode;
  limit: number;
  json: boolean;
}

/**
 * Get the grouping key for an entry based on the mode.
 */
function getKey(entry: StatEntry, mode: GroupByMode): string {
  switch (mode) {
    case 'category':
      return entry.winner.category;
    case 'backend':
      return entry.winner.backend;
    case 'module':
    default:
      return `${entry.winner.category}/${entry.winner.moduleId}`;
  }
}

/**
 * Aggregate entries into groups.
 */
function aggregate(entries: StatEntry[], mode: GroupByMode): GroupAgg[] {
  const groups = new Map<string, GroupAgg>();

  for (const entry of entries) {
    const key = getKey(entry, mode);
    const agg = groups.get(key) ?? {
      key,
      wins: 0,
      totalConfidence: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      lastSeen: '',
    };

    agg.wins++;
    agg.totalConfidence += entry.confidence.score;

    if (entry.confidence.level === 'high') agg.highCount++;
    else if (entry.confidence.level === 'medium') agg.mediumCount++;
    else agg.lowCount++;

    if (entry.timestamp > agg.lastSeen) {
      agg.lastSeen = entry.timestamp;
    }

    groups.set(key, agg);
  }

  return [...groups.values()];
}

/**
 * Format a date for display.
 */
function formatDate(iso: string): string {
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

export async function handleStats(options: StatsOptions): Promise<void> {
  const store = new StatsStore();
  const entries = await store.readAll();

  if (entries.length === 0) {
    console.log('No judge statistics recorded yet.');
    console.log(c.dim('Run some deep mode queries to collect statistics.'));
    return;
  }

  // Aggregate and rank
  const groups = aggregate(entries, options.groupBy);
  const ranked = groups
    .sort((a, b) => b.wins - a.wins)
    .slice(0, options.limit);

  // Output
  if (options.json) {
    const output = ranked.map(g => ({
      key: g.key,
      wins: g.wins,
      avgConfidence: +(g.totalConfidence / g.wins).toFixed(3),
      highCount: g.highCount,
      mediumCount: g.mediumCount,
      lowCount: g.lowCount,
      lastSeen: g.lastSeen,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Human-readable output
  const modeLabel = options.groupBy === 'category' ? 'Category' 
    : options.groupBy === 'backend' ? 'Backend' 
    : 'Module';

  console.log(`\n${c.cyan('Judge Statistics')} (${entries.length} total decisions)\n`);
  console.log(c.dim('─'.repeat(80)));

  // Header
  const header = `${modeLabel.padEnd(40)} ${'Wins'.padStart(5)}  ${'Avg%'.padStart(4)}  ${c.dim('H/M/L'.padStart(9))}  ${c.dim('Last')}`;
  console.log(header);
  console.log(c.dim('─'.repeat(80)));

  for (const g of ranked) {
    const avgPct = ((g.totalConfidence / g.wins) * 100).toFixed(0);
    const breakdown = `${g.highCount}/${g.mediumCount}/${g.lowCount}`;
    const lastSeen = formatDate(g.lastSeen);

    console.log(
      `${c.cyan(g.key.padEnd(40))} ${String(g.wins).padStart(5)}  ${avgPct.padStart(4)}%  ${c.dim(breakdown.padStart(9))}  ${c.dim(lastSeen)}`
    );
  }

  console.log(c.dim('─'.repeat(80)));
  const pluralLabel = modeLabel.toLowerCase() === 'category' ? 'categories' : `${modeLabel.toLowerCase()}s`;
  console.log(c.dim(`Showing top ${ranked.length} of ${groups.length} ${pluralLabel}`));
}
