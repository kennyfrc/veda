/**
 * ContextStore - Manages file selection for sessions.
 * 
 * Provides atomic operations for adding/removing files with locking.
 */

import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { getSelectionPath, getSessionDir, isValidSessionId } from '../util/paths';
import { withLock } from '../util/lock';
import { parseSlice, formatSlice, type FileSlice } from './slice';
import {
  readSelectionFile,
  writeSelectionFile,
  resolvePattern,
  fileExists,
  type SelectionEntry,
} from './selection';

export interface ContextStoreOptions {
  sessionId: string;
  cwd?: string;
  /** Base config directory (defaults to ~/.config/veda) */
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
  private readonly sessionId: string;
  private readonly selectionPath: string;
  private readonly sessionDir: string;
  private readonly cwd: string;
  private readonly baseDir?: string;

  constructor(options: ContextStoreOptions) {
    if (!isValidSessionId(options.sessionId)) {
      throw new Error(`Invalid session ID: ${options.sessionId}`);
    }
    
    this.sessionId = options.sessionId;
    this.baseDir = options.baseDir;
    this.selectionPath = getSelectionPath(options.sessionId, options.baseDir);
    this.sessionDir = getSessionDir(options.sessionId, options.baseDir);
    this.cwd = options.cwd ?? process.cwd();
  }

  /**
   * Add files to selection.
   * @param patterns - File paths or glob patterns (may include slice suffixes)
   */
  async add(patterns: string[]): Promise<AddResult> {
    const result: AddResult = { added: 0, skipped: 0, notFound: [] };
    
    // Resolve all patterns to absolute paths
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
    
    if (resolvedPaths.length === 0) {
      return result;
    }

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
   * Remove files from selection.
   * @param patterns - File paths or glob patterns
   * 
   * Behavior:
   * - Removing a slice (file.c:10-20) removes only that exact slice
   * - Removing a file (file.c) removes the file AND all its slices
   */
  async remove(patterns: string[]): Promise<RemoveResult> {
    const result: RemoveResult = { removed: 0, notFound: 0 };
    
    // Resolve all patterns
    const toRemove: string[] = [];
    for (const pattern of patterns) {
      const paths = await resolvePattern(pattern, this.cwd);
      toRemove.push(...paths);
    }
    
    if (toRemove.length === 0) {
      return result;
    }

    await withLock(this.selectionPath, async () => {
      const entries = await readSelectionFile(this.selectionPath, this.cwd);
      const remaining: SelectionEntry[] = [];
      
      for (const entry of entries) {
        let shouldRemove = false;
        
        for (const pattern of toRemove) {
          const patternSlice = parseSlice(pattern);
          
          if (patternSlice.hasSlice) {
            // Removing a specific slice - exact match only
            if (formatSlice(entry.slice) === pattern) {
              shouldRemove = true;
              break;
            }
          } else {
            // Removing a file - remove file AND all its slices
            if (entry.slice.path === patternSlice.path) {
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
      
      result.notFound = toRemove.length - result.removed;
      if (result.notFound < 0) result.notFound = 0;
      
      await writeSelectionFile(this.selectionPath, remaining);
    });
    
    return result;
  }

  /**
   * List all entries in selection.
   */
  async list(): Promise<SelectionEntry[]> {
    return await readSelectionFile(this.selectionPath, this.cwd);
  }

  /**
   * Clear all entries from selection.
   */
  async clear(): Promise<void> {
    await this.ensureSessionDir();
    
    await withLock(this.selectionPath, async () => {
      await writeSelectionFile(this.selectionPath, []);
    });
  }

  /**
   * Get token count estimate for all selected files.
   * Uses rough estimate of ~4 chars per token.
   */
  async tokens(): Promise<number> {
    const entries = await this.list();
    let totalChars = 0;
    
    for (const entry of entries) {
      try {
        const file = Bun.file(entry.absolutePath);
        if (await file.exists()) {
          const content = await file.text();
          
          if (entry.slice.hasSlice) {
            const lines = content.split('\n');
            const start = (entry.slice.start ?? 1) - 1;
            const end = entry.slice.end ?? lines.length;
            const slicedContent = lines.slice(start, end).join('\n');
            totalChars += slicedContent.length;
          } else {
            totalChars += content.length;
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    // Rough token estimate: ~4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Get detailed token info per file.
   */
  async tokenDetails(): Promise<TokenInfo[]> {
    const entries = await this.list();
    const details: TokenInfo[] = [];
    
    for (const entry of entries) {
      try {
        const file = Bun.file(entry.absolutePath);
        if (await file.exists()) {
          const content = await file.text();
          let chars: number;
          let lines: number;
          
          if (entry.slice.hasSlice) {
            const allLines = content.split('\n');
            const start = (entry.slice.start ?? 1) - 1;
            const end = entry.slice.end ?? allLines.length;
            const slicedLines = allLines.slice(start, end);
            chars = slicedLines.join('\n').length;
            lines = slicedLines.length;
          } else {
            chars = content.length;
            lines = content.split('\n').length;
          }
          
          details.push({
            path: formatSlice(entry.slice),
            tokens: Math.ceil(chars / 4),
            lines,
          });
        }
      } catch {
        // Skip files that can't be read
      }
    }
    
    return details;
  }

  /**
   * Serialize selection to llm_ctx format.
   * Returns the context string ready to pass to llm_ctx.
   */
  async serialize(): Promise<string> {
    const entries = await this.list();
    
    if (entries.length === 0) {
      return '';
    }
    
    // Build file arguments for llm_ctx
    // Format: -f path[:start-end] for each entry
    const args = entries.map(e => formatSlice(e.slice));
    
    // Shell out to llm_ctx
    const proc = Bun.spawn(['llm_ctx', '-f', ...args, '-o', '-'], {
      cwd: this.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`llm_ctx failed: ${stderr}`);
    }
    
    return stdout;
  }

  /**
   * Ensure the session directory exists.
   */
  private async ensureSessionDir(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
  }
}
