/**
 * Selection file I/O operations.
 * 
 * Selection files are line-delimited absolute paths, optionally with slice suffixes.
 */

import { resolve, isAbsolute } from 'path';
import { parseSlice, formatSlice, type FileSlice } from './slice';

export interface SelectionEntry {
  /** Original path as stored in selection file */
  original: string;
  /** Absolute path to file (without slice) */
  absolutePath: string;
  /** Parsed slice information */
  slice: FileSlice;
}

/**
 * Parse selection file contents into entries.
 */
export function parseSelection(content: string, cwd: string = process.cwd()): SelectionEntry[] {
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  return lines.map(line => {
    const slice = parseSlice(line.trim());
    const absolutePath = isAbsolute(slice.path) ? slice.path : resolve(cwd, slice.path);
    
    return {
      original: line.trim(),
      absolutePath,
      slice: { ...slice, path: absolutePath },
    };
  });
}

/**
 * Serialize entries back to selection file format.
 */
export function serializeSelection(entries: SelectionEntry[]): string {
  return entries.map(e => formatSlice(e.slice)).join('\n') + (entries.length > 0 ? '\n' : '');
}

/**
 * Read selection file from disk.
 */
export async function readSelectionFile(path: string, cwd: string = process.cwd()): Promise<SelectionEntry[]> {
  try {
    const file = Bun.file(path);
    if (!await file.exists()) {
      return [];
    }
    const content = await file.text();
    return parseSelection(content, cwd);
  } catch {
    return [];
  }
}

/**
 * Write selection entries to disk.
 */
export async function writeSelectionFile(path: string, entries: SelectionEntry[]): Promise<void> {
  const content = serializeSelection(entries);
  await Bun.write(path, content);
}

/**
 * Resolve a pattern to absolute paths.
 * Handles glob patterns using Bun.Glob.
 */
export async function resolvePattern(pattern: string, cwd: string = process.cwd()): Promise<string[]> {
  const slice = parseSlice(pattern);
  const basePath = slice.path;
  
  // Check if it's a glob pattern
  const isGlob = basePath.includes('*') || basePath.includes('?') || basePath.includes('[');
  
  if (isGlob) {
    const glob = new Bun.Glob(basePath);
    const matches: string[] = [];
    
    for await (const match of glob.scan({ cwd, absolute: true })) {
      if (slice.hasSlice) {
        // Apply slice to each match
        matches.push(formatSlice({ ...slice, path: match }));
      } else {
        matches.push(match);
      }
    }
    
    return matches;
  }
  
  // Single file - resolve to absolute
  const absolutePath = isAbsolute(basePath) ? basePath : resolve(cwd, basePath);
  
  if (slice.hasSlice) {
    return [formatSlice({ ...slice, path: absolutePath })];
  }
  
  return [absolutePath];
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  const slice = parseSlice(path);
  return await Bun.file(slice.path).exists();
}
