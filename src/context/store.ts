import { mkdir } from 'fs/promises';
import { getSelectionPath, getSessionDir, isValidSessionId } from '../util/paths';
import { withLock } from '../util/lock';
import { parseSlice, formatSlice } from './slice';
import {
  readSelectionFile,
  writeSelectionFile,
  resolvePattern,
  fileExists,
  type SelectionEntry,
} from './selection';
import { readSliceText } from './readSlice';
import { serializeAllFileContextBlocks } from './serialize';
import { estimateTokensByScript } from './tokenEstimate';

export interface ContextStoreOptions {
  sessionId: string;
  cwd?: string;
  baseDir?: string;
}

export interface AddResult {
  added: number;
  skipped: number;
  notFound: string[];
}

export interface RemoveResult {
  removed: number;
  notFound: number;
}

export interface TokenInfo {
  path: string;
  tokens: number;
  lines: number;
}

export class ContextStore {
  private readonly selectionPath: string;
  private readonly sessionDir: string;
  private readonly cwd: string;

  /**
   * Performance note: list() caching considered but NOT implemented.
   *
   * Analysis:
   * - list() is called in: add(), remove(), tokens(), tokenDetails()
   * - Only 1 duplicate read path: 'ls' command → list() → tokenDetails() → list()
   * - This is an interactive command, not performance-critical
   * - Typical selections: <100 files, <10KB each → file I/O is <10ms
   *
   * Pragmatic principle: "Inline until duplication appears"
   * - Wait until we have 2+ hot path usages that truly benefit from caching
   * - See tests/context/store-performance.test.ts for benchmarks
   *
   * If caching is ever needed, consider:
   * - Ephemeral per-operation cache (not across method calls)
   * - Automatic invalidation on add/remove/clear
   * - Benchmark to verify actual performance benefit
   */

  constructor(options: ContextStoreOptions) {
    if (!isValidSessionId(options.sessionId)) {
      throw new Error(`Invalid session ID: ${options.sessionId}`);
    }
    
    this.selectionPath = getSelectionPath(options.sessionId, options.baseDir);
    this.sessionDir = getSessionDir(options.sessionId, options.baseDir);
    this.cwd = options.cwd ?? process.cwd();
  }

  async add(patterns: string[]): Promise<AddResult> {
    const result: AddResult = { added: 0, skipped: 0, notFound: [] };
    
    // Resolve patterns to absolute paths
    const resolvedPaths: string[] = [];
    for (const pattern of patterns) {
      const paths = await resolvePattern(pattern, this.cwd);
      
      for (const path of paths) {
        if (await fileExists(path)) {
          resolvedPaths.push(path);
        } else {
          result.notFound.push(path);
        }
      }
    }
    
    if (resolvedPaths.length === 0) return result;

    await this.ensureSessionDir();
    
    await withLock(this.selectionPath, async () => {
      const entries = await readSelectionFile(this.selectionPath, this.cwd);
      const existingPaths = new Set(entries.map(e => formatSlice(e.slice)));
      
      for (const path of resolvedPaths) {
        if (existingPaths.has(path)) {
          result.skipped++;
        } else {
          const slice = parseSlice(path);
          entries.push({
            original: path,
            absolutePath: slice.path,
            slice,
          });
          existingPaths.add(path);
          result.added++;
        }
      }
      
      await writeSelectionFile(this.selectionPath, entries);
    });
    
    return result;
  }

  /**
   * Remove files from selection. Removing a file (file.c) removes all its slices.
   */
  async remove(patterns: string[]): Promise<RemoveResult> {
    const result: RemoveResult = { removed: 0, notFound: 0 };
    
    const toRemove: string[] = [];
    for (const pattern of patterns) {
      const paths = await resolvePattern(pattern, this.cwd);
      toRemove.push(...paths);
    }
    
    if (toRemove.length === 0) return result;

    await withLock(this.selectionPath, async () => {
      const entries = await readSelectionFile(this.selectionPath, this.cwd);
      const remaining: SelectionEntry[] = [];
      
      for (const entry of entries) {
        let shouldRemove = false;
        
        for (const pattern of toRemove) {
          const patternSlice = parseSlice(pattern);

          if (patternSlice.sliceType === 'full') {
            if (entry.slice.path === patternSlice.path) {
              shouldRemove = true;
              break;
            }
          } else {
            if (formatSlice(entry.slice) === pattern) {
              shouldRemove = true;
              break;
            }
          }
        }
        
        if (shouldRemove) {
          result.removed++;
        } else {
          remaining.push(entry);
        }
      }
      
      result.notFound = Math.max(0, toRemove.length - result.removed);
      await writeSelectionFile(this.selectionPath, remaining);
    });
    
    return result;
  }

  async list(): Promise<SelectionEntry[]> {
    return await readSelectionFile(this.selectionPath, this.cwd);
  }

  async clear(): Promise<void> {
    await this.ensureSessionDir();
    await withLock(this.selectionPath, async () => {
      await writeSelectionFile(this.selectionPath, []);
    });
  }

  /**
   * Get token count estimate for selection using script detection.
   */
  async tokens(): Promise<number> {
    const entries = await this.list();
    
    const results = await Promise.all(
      entries.map(entry => readSliceText({
        cwd: this.cwd,
        slice: entry.slice,
      }))
    );
    
    let totalTokens = 0;
    for (const res of results) {
      if (res.ok) {
        totalTokens += estimateTokensByScript(res.value.content).tokens;
      }
    }
    
    return totalTokens;
  }

  async tokenDetails(): Promise<TokenInfo[]> {
    const entries = await this.list();
    
    const results = await Promise.all(
      entries.map(async (entry) => {
        const res = await readSliceText({
          cwd: this.cwd,
          slice: entry.slice,
        });
        return { entry, res };
      })
    );
    
    const details: TokenInfo[] = [];
    for (const { entry, res } of results) {
      if (res.ok) {
        details.push({
          path: formatSlice(entry.slice),
          tokens: estimateTokensByScript(res.value.content).tokens,
          lines: res.value.lineCount,
        });
      }
    }
    
    return details;
  }

  /**
   * Serialize selection to <file_context> format. Skips unreadable files.
   */
  async serialize(): Promise<string> {
    const entries = await this.list();
    if (entries.length === 0) return '';
    
    const results = await Promise.all(
      entries.map(entry => readSliceText({
        cwd: this.cwd,
        slice: entry.slice,
      }))
    );
    
    const successfulResults = results
      .filter((res): res is { ok: true, value: any } => res.ok)
      .map(res => res.value);
    
    return serializeAllFileContextBlocks(successfulResults);
  }

  private async ensureSessionDir(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
  }
}
