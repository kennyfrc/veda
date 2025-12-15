// File slice: path:10-20, path:15-, path:8, or path (no slice)

export interface FileSlice {
  /** Base file path without slice suffix */
  path: string;
  /** Start line (1-indexed), undefined means from start */
  start?: number;
  /** End line (1-indexed), undefined means to EOF */
  end?: number;
  /** Whether this entry has a slice */
  hasSlice: boolean;
}

const SLICE_PATTERN = /^(.+?):(\d+)(?:-(\d*))?$/;

/**
 * Parse a path with optional slice suffix into components.
 * 
 * @example
 * parseSlice('main.ts:10-20') → { path: 'main.ts', start: 10, end: 20, hasSlice: true }
 * parseSlice('main.ts:15-')   → { path: 'main.ts', start: 15, end: undefined, hasSlice: true }
 * parseSlice('main.ts:8')     → { path: 'main.ts', start: 8, end: 8, hasSlice: true }
 * parseSlice('main.ts')       → { path: 'main.ts', start: undefined, end: undefined, hasSlice: false }
 * 
 * Invalid slices (start < 1 or end < start) return the input as a plain path.
 */
export function parseSlice(input: string): FileSlice {
  const match = input.match(SLICE_PATTERN);
  
  if (!match) {
    return {
      path: input,
      start: undefined,
      end: undefined,
      hasSlice: false,
    };
  }

  const [, path, startStr, endStr] = match;
  const start = parseInt(startStr, 10);
  
  // Validate: start must be >= 1 (lines are 1-indexed)
  if (start < 1) {
    return {
      path: input,
      start: undefined,
      end: undefined,
      hasSlice: false,
    };
  }
  
  // No hyphen or nothing after hyphen means single line or to EOF
  if (endStr === undefined) {
    // Format: file:N (single line)
    return {
      path,
      start,
      end: start,
      hasSlice: true,
    };
  }
  
  if (endStr === '') {
    // Format: file:N- (to EOF)
    return {
      path,
      start,
      end: undefined,
      hasSlice: true,
    };
  }
  
  // Format: file:N-M (range)
  const end = parseInt(endStr, 10);
  
  // Validate: end must be >= start
  if (end < start) {
    return {
      path: input,
      start: undefined,
      end: undefined,
      hasSlice: false,
    };
  }
  
  return {
    path,
    start,
    end,
    hasSlice: true,
  };
}

/**
 * Format a FileSlice back to a string.
 */
export function formatSlice(slice: FileSlice): string {
  if (!slice.hasSlice) {
    return slice.path;
  }
  
  if (slice.start === slice.end) {
    return `${slice.path}:${slice.start}`;
  }
  
  if (slice.end === undefined) {
    return `${slice.path}:${slice.start}-`;
  }
  
  return `${slice.path}:${slice.start}-${slice.end}`;
}

/**
 * Check if two slices overlap or are the same file.
 */
export function slicesOverlap(a: FileSlice, b: FileSlice): boolean {
  if (a.path !== b.path) return false;
  
  // If either has no slice, they share the same file
  if (!a.hasSlice || !b.hasSlice) return true;
  
  const aStart = a.start ?? 1;
  const aEnd = a.end ?? Infinity;
  const bStart = b.start ?? 1;
  const bEnd = b.end ?? Infinity;
  
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Extract lines from content based on slice.
 */
export function extractSlice(content: string, slice: FileSlice): string {
  if (!slice.hasSlice) {
    return content;
  }
  
  const lines = content.split('\n');
  const start = (slice.start ?? 1) - 1; // Convert to 0-indexed
  const end = slice.end ?? lines.length;
  
  return lines.slice(start, end).join('\n');
}
