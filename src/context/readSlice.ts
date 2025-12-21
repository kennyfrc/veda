import { relative } from 'path';
import type { FileSlice } from './slice';

export interface ReadSliceResult {
  absolutePath: string;
  displayPath: string;
  content: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  hasSlice: boolean;
}

export interface ReadSliceOptions {
  cwd: string;
  slice: FileSlice;
  displayPath?: string;
}

/**
 * Read file content with optional slice. Returns null if unreadable.
 */
export async function readSliceText(opts: ReadSliceOptions): Promise<ReadSliceResult | null> {
  const { cwd, slice, displayPath: providedDisplayPath } = opts;
  const absolutePath = slice.path;

  try {
    const file = Bun.file(absolutePath);
    if (!await file.exists()) return null;

    const rawContent = await file.text();
    const allLines = rawContent.split('\n');
    const totalLines = allLines.length;

    let displayPath = providedDisplayPath;
    if (!displayPath) {
      const rel = relative(cwd, absolutePath);
      displayPath = rel.startsWith('..') ? absolutePath : rel;
    }

    if (!slice.hasSlice) {
      return {
        absolutePath,
        displayPath,
        content: rawContent,
        startLine: 1,
        endLine: totalLines,
        lineCount: totalLines,
        hasSlice: false,
      };
    }

    const startLine = Math.max(1, slice.start ?? 1);
    const endLine = Math.min(totalLines, slice.end ?? totalLines);

    if (startLine > totalLines) {
      return {
        absolutePath,
        displayPath,
        content: '',
        startLine,
        endLine: startLine,
        lineCount: 0,
        hasSlice: true,
      };
    }

    const slicedLines = allLines.slice(startLine - 1, endLine);
    const content = slicedLines.join('\n');

    return {
      absolutePath,
      displayPath,
      content,
      startLine,
      endLine,
      lineCount: slicedLines.length,
      hasSlice: true,
    };
  } catch {
    return null;
  }
}
