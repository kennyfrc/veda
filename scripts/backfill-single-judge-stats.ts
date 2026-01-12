#!/usr/bin/env bun
/**
 * Backfill single-judge stats from existing trace YAML files.
 * 
 * Usage: bun scripts/backfill-single-judge-stats.ts [trace-dir]
 * 
 * Default trace directory: current working directory (searches recursively)
 * 
 * Deduplication: Uses trace file path hash as runId. Safe to re-run.
 */

import { parse } from 'yaml';
import { createHash } from 'crypto';
import { StatsStore, type StatEntryV3, type ConfidenceLevel } from '../src/stats';

interface TraceCandidate {
  id?: string;
  module: {
    id: string;
    category: string;
    name?: string;
  };
  response?: string;
}

interface TraceJudge {
  mode?: string;
  selectedIndex?: number;      // camelCase (deep-think.ts output)
  selected_index?: number;     // snake_case (trace YAML from CLI)
  selectedDisplayIndex?: number;
  selected_display_index?: number;
  confidence: number;
}

interface TraceData {
  trace_version?: number;
  prompt?: string;
  run?: { timestamp?: string };
  solve?: { candidates?: TraceCandidate[] };
  judge?: TraceJudge;
}

function hashFilePath(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

async function backfill(traceDir: string): Promise<void> {
  const store = new StatsStore();
  
  // Load existing runIds for deduplication
  const existingRunIds = await store.getRunIds();
  console.log(`Found ${existingRunIds.size} existing entries`);
  
  // Find all YAML trace files recursively
  const glob = new Bun.Glob('*.yaml');  // Non-recursive to avoid permission issues
  const files: string[] = [];
  try {
    for await (const file of glob.scan({ cwd: traceDir, absolute: true })) {
      files.push(file);
    }
  } catch (e) {
    console.error(`Error scanning directory: ${e}`);
  }
  console.log(`Found ${files.length} trace files in ${traceDir}`);
  
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  
  for (const file of files) {
    const runId = hashFilePath(file);
    
    // Skip if already recorded
    if (existingRunIds.has(runId)) {
      skipped++;
      continue;
    }
    
    try {
      const content = await Bun.file(file).text();
      const trace = parse(content) as TraceData;
      
      // Validate trace structure
      if (!trace?.judge?.confidence) {
        invalid++;
        continue;
      }
      
      // Skip non-single-judge modes
      if (trace.judge.mode && trace.judge.mode !== 'single') {
        invalid++;
        continue;
      }
      
      // Skip if no candidates
      if (!trace.solve?.candidates?.length) {
        invalid++;
        continue;
      }
      
      // Get winner (handle both camelCase and snake_case)
      const winnerIdx = trace.judge.selectedIndex ?? trace.judge.selected_index;
      if (winnerIdx === undefined) {
        invalid++;
        continue;
      }
      const winner = trace.solve.candidates[winnerIdx];
      if (!winner?.module) {
        invalid++;
        continue;
      }
      
      // Build entry
      const entry: StatEntryV3 = {
        version: 3,
        timestamp: trace.run?.timestamp ?? new Date().toISOString(),
        promptHash: trace.prompt 
          ? Bun.hash(trace.prompt).toString(16).padStart(16, '0').slice(0, 16)
          : '0000000000000000',
        runId,
        judgeMode: 'single',
        judge: {
          backend: 'unknown',
          model: 'unknown',
        },
        winner: {
          category: winner.module.category,
          moduleId: winner.module.id,
        },
        participants: trace.solve.candidates.map(c => ({
          category: c.module.category,
          moduleId: c.module.id,
        })),
        confidence: {
          level: confidenceLevel(trace.judge.confidence),
          score: trace.judge.confidence,
        },
      };
      
      await store.append(entry);
      added++;
      
    } catch (e) {
      // Skip files that can't be parsed
      invalid++;
    }
  }
  
  console.log(`\nBackfill complete:`);
  console.log(`  Added: ${added}`);
  console.log(`  Skipped (duplicate): ${skipped}`);
  console.log(`  Invalid/skipped: ${invalid}`);
}

// Main
const traceDir = process.argv[2] || process.cwd();
console.log(`Backfilling single-judge stats from: ${traceDir}\n`);
backfill(traceDir).catch(console.error);
