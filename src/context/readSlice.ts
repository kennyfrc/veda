import { relative } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { FileSlice } from './slice';
import type { Result } from '../util/result';
import { ok, err } from '../util/result';

export interface ReadSliceResult {
  absolutePath: string;
  displayPath: string;
  content: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  sliceType: 'full' | 'single-line' | 'range' | 'infinite-range';
}

export interface ReadSliceOptions {
  cwd: string;
  slice: FileSlice;
  displayPath?: string;
}

export async function readSliceText(opts: ReadSliceOptions): Promise<Result<ReadSliceResult>> {
  const { cwd, slice, displayPath: providedDisplayPath } = opts;
  const absolutePath = slice.path;

  try {
    const file = Bun.file(absolutePath);
    if (!await file.exists()) {
      return err(new Error(`File not found: ${absolutePath}`));
    }

    let displayPath = providedDisplayPath;
    if (!displayPath) {
      const rel = relative(cwd, absolutePath);
      displayPath = rel.startsWith('..') ? absolutePath : rel;
    }

    // Optimization: if no slice is requested, use the optimized file.text()
    if (slice.sliceType === 'full') {
      const content = await file.text();
      const lineCount = content.split('\n').length;
      return ok({
        absolutePath,
        displayPath,
        content,
        startLine: 1,
        endLine: lineCount,
        lineCount,
        sliceType: 'full',
      });
    }

    // Memory-efficient slicing using line iterator
    const startLine = Math.max(1, slice.startLine ?? 1);
    const endLine = slice.sliceType === 'single-line' ? startLine : (slice.endLine ?? Infinity);

    const lines: string[] = [];
    let currentLine = 1;
    let actualEndLine = 0;

    const rl = createInterface({
      input: createReadStream(absolutePath),
      crlfDelay: Infinity
    });

    try {
      for await (const line of rl) {
        if (currentLine >= startLine && currentLine <= endLine) {
          lines.push(line);
          actualEndLine = currentLine;
        }
        if (currentLine >= endLine) {
          currentLine++;
          break;
        }
        currentLine++;
      }
    } finally {
      rl.close();
    }

    // If startLine was beyond the end of the file
    if (currentLine < startLine) {
      return ok({
        absolutePath,
        displayPath,
        content: '',
        startLine,
        endLine: startLine,
        lineCount: 0,
        sliceType: slice.sliceType,
      });
    }

    const content = lines.join('\n');
    const result = ok({
      absolutePath,
      displayPath,
      content,
      startLine,
      endLine: actualEndLine || startLine,
      lineCount: lines.length,
      sliceType: slice.sliceType,
    });
    return result;
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
