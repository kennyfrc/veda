// File slice: path:10-20, path:15-, path:8, or path (no slice)

export interface FileSlice {
  path: string;
  start?: number;
  end?: number;
  hasSlice: boolean;
}

const SLICE_PATTERN = /^(.+?):(\d+)(?:-(\d*))?$/;

/**
 * Parse a path with optional slice suffix (file:10-20, file:15-, file:8).
 * Invalid slices return the input as a plain path.
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
  
  if (start < 1) {
    return {
      path: input,
      start: undefined,
      end: undefined,
      hasSlice: false,
    };
  }
  
  if (endStr === undefined) {
    return {
      path,
      start,
      end: start,
      hasSlice: true,
    };
  }
  
  if (endStr === '') {
    return {
      path,
      start,
      end: undefined,
      hasSlice: true,
    };
  }
  
  const end = parseInt(endStr, 10);
  
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

export function formatSlice(slice: FileSlice): string {
  if (!slice.hasSlice) return slice.path;
  if (slice.start === slice.end) return `${slice.path}:${slice.start}`;
  if (slice.end === undefined) return `${slice.path}:${slice.start}-`;
  return `${slice.path}:${slice.start}-${slice.end}`;
}

export function slicesOverlap(a: FileSlice, b: FileSlice): boolean {
  if (a.path !== b.path) return false;
  if (!a.hasSlice || !b.hasSlice) return true;
  
  const aStart = a.start ?? 1;
  const aEnd = a.end ?? Infinity;
  const bStart = b.start ?? 1;
  const bEnd = b.end ?? Infinity;
  
  return aStart <= bEnd && bStart <= aEnd;
}

export function extractSlice(content: string, slice: FileSlice): string {
  if (!slice.hasSlice) return content;
  
  const lines = content.split('\n');
  const start = (slice.start ?? 1) - 1;
  const end = slice.end ?? lines.length;
  
  return lines.slice(start, end).join('\n');
}
