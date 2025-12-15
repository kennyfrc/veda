import { relative } from 'path';
import type { FileSlice } from './slice';

export interface ReadSliceResult {
  /** Absolute path to file */
  absolutePath: string;
  /** Display path (relative when possible) */
  displayPath: string;
  /** File content (sliced if applicable) */
  content: string;
  /** Start line (1-indexed, inclusive) */
  startLine: number;
  /** End line (1-indexed, inclusive) */
  endLine: number;
  /** Number of lines in content */
  lineCount: number;
  /** Whether a slice was applied */
  hasSlice: boolean;
}

export interface ReadSliceOptions {
  /** Working directory for relative path computation */
  cwd: string;
  /** File slice to read */
  slice: FileSlice;
  /** Optional pre-computed display path */
  displayPath?: string;
}

/**
 * Read file content with optional slice.
 * Returns null if file is unreadable (best-effort, non-throwing).
 */
export async function readSliceText(opts: ReadSliceOptions): Promise<ReadSliceResult | null> {
  const { cwd, slice, displayPath: providedDisplayPath } = opts;
  const absolutePath = slice.path;

  try {
    const file = Bun.file(absolutePath);
    if (!await file.exists()) {
      return null;
    }

    const rawContent = await file.text();
    const allLines = rawContent.split('\n');
    const totalLines = allLines.length;

    // Compute display path (prefer relative if within cwd)
    let displayPath = providedDisplayPath;
    if (!displayPath) {
      const rel = relative(cwd, absolutePath);
      displayPath = rel.startsWith('..') ? absolutePath : rel;
    }

    if (!slice.hasSlice) {
      // No slice - return entire file
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

    // Apply slice with clamping
    const startLine = Math.max(1, slice.start ?? 1);
    const endLine = Math.min(totalLines, slice.end ?? totalLines);

    // Handle case where start > total lines
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

    // Extract lines (convert to 0-indexed for slice)
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
    // File unreadable (binary, permissions, etc.) - skip
    return null;
  }
}
