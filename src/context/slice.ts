// File slice: path:10-20, path:15-, path:8, or path (no slice)

/** Explicit type for file slice state - avoids boolean blindness */
export type SliceType = 'full' | 'single-line' | 'range' | 'infinite-range';

export interface FileSlice {
  path: string;
  sliceType: SliceType;
  startLine?: number;  // Present for single-line, range, infinite-range
  endLine?: number;    // Present only for range
}

const SLICE_PATTERN = /^(.+?):(\d+)(?:-(\d*))?$/;

/**
 * Parse a path with optional slice suffix (file:10-20, file:15-, file:8).
 * Invalid slices return the input as a full file slice.
 */
export function parseSlice(input: string): FileSlice {
  const match = input.match(SLICE_PATTERN);

  if (!match) {
    return {
      path: input,
      sliceType: 'full',
    };
  }

  const [, path, startStr, endStr] = match;
  const start = parseInt(startStr, 10);

  if (start < 1) {
    return {
      path: input,
      sliceType: 'full',
    };
  }

  if (endStr === undefined) {
    // Single line: file.ts:10
    return {
      path,
      sliceType: 'single-line',
      startLine: start,
    };
  }

  if (endStr === '') {
    // Infinite range: file.ts:10-
    return {
      path,
      sliceType: 'infinite-range',
      startLine: start,
    };
  }

  const end = parseInt(endStr, 10);

  if (end < start) {
    return {
      path: input,
      sliceType: 'full',
    };
  }

  // Range: file.ts:10-20
  return {
    path,
    sliceType: 'range',
    startLine: start,
    endLine: end,
  };
}

export function formatSlice(slice: FileSlice): string {
  if (slice.sliceType === 'full') return slice.path;
  if (slice.sliceType === 'single-line') return `${slice.path}:${slice.startLine}`;
  if (slice.sliceType === 'infinite-range') return `${slice.path}:${slice.startLine}-`;
  return `${slice.path}:${slice.startLine}-${slice.endLine}`;
}

export function slicesOverlap(a: FileSlice, b: FileSlice): boolean {
  if (a.path !== b.path) return false;
  if (a.sliceType === 'full' || b.sliceType === 'full') return true;

  const aStart = a.startLine ?? 1;
  const aEnd = a.endLine ?? Infinity;
  const bStart = b.startLine ?? 1;
  const bEnd = b.endLine ?? Infinity;

  return aStart <= bEnd && bStart <= aEnd;
}

export function extractSlice(content: string, slice: FileSlice): string {
  if (slice.sliceType === 'full') return content;

  const lines = content.split('\n');
  const start = (slice.startLine ?? 1) - 1;

  // For single-line slice, extract just that one line
  if (slice.sliceType === 'single-line') {
    return lines[start];
  }

  // For range and infinite-range, extract from start to end
  const end = slice.endLine ?? lines.length;
  return lines.slice(start, end).join('\n');
}
