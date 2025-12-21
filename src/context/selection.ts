import { resolve, isAbsolute } from 'path';
import { parseSlice, formatSlice, type FileSlice } from './slice';

export interface SelectionEntry {
  original: string;
  absolutePath: string;
  slice: FileSlice;
}

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

export function serializeSelection(entries: SelectionEntry[]): string {
  return entries.map(e => formatSlice(e.slice)).join('\n') + (entries.length > 0 ? '\n' : '');
}

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

export async function writeSelectionFile(path: string, entries: SelectionEntry[]): Promise<void> {
  const content = serializeSelection(entries);
  await Bun.write(path, content);
}

/**
 * Resolve a pattern to absolute paths, supporting globs via Bun.Glob.
 */
export async function resolvePattern(pattern: string, cwd: string = process.cwd()): Promise<string[]> {
  const slice = parseSlice(pattern);
  const basePath = slice.path;
  
  const isGlob = basePath.includes('*') || basePath.includes('?') || basePath.includes('[');
  
  if (isGlob) {
    const glob = new Bun.Glob(basePath);
    const matches: string[] = [];
    
    for await (const match of glob.scan({ cwd, absolute: true })) {
      matches.push(slice.hasSlice ? formatSlice({ ...slice, path: match }) : match);
    }
    
    return matches;
  }
  
  const absolutePath = isAbsolute(basePath) ? basePath : resolve(cwd, basePath);
  return [slice.hasSlice ? formatSlice({ ...slice, path: absolutePath }) : absolutePath];
}

export async function fileExists(path: string): Promise<boolean> {
  const slice = parseSlice(path);
  return await Bun.file(slice.path).exists();
}
