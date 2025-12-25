import { describe, expect, test } from 'bun:test';
import { parseSlice, formatSlice, slicesOverlap, extractSlice } from '../../src/context/slice';

describe('parseSlice', () => {
  test('parses file without slice', () => {
    const result = parseSlice('main.ts');
    expect(result).toEqual({
      path: 'main.ts',
      sliceType: 'full',
    });
  });

  test('parses file with range slice', () => {
    const result = parseSlice('main.ts:10-20');
    expect(result).toEqual({
      path: 'main.ts',
      sliceType: 'range',
      startLine: 10,
      endLine: 20,
    });
  });

  test('parses file with open-ended slice', () => {
    const result = parseSlice('main.ts:15-');
    expect(result).toEqual({
      path: 'main.ts',
      sliceType: 'infinite-range',
      startLine: 15,
    });
  });

  test('parses file with single line slice', () => {
    const result = parseSlice('main.ts:8');
    expect(result).toEqual({
      path: 'main.ts',
      sliceType: 'single-line',
      startLine: 8,
    });
  });

  test('handles absolute paths', () => {
    const result = parseSlice('/Users/test/main.ts:1-10');
    expect(result).toEqual({
      path: '/Users/test/main.ts',
      sliceType: 'range',
      startLine: 1,
      endLine: 10,
    });
  });

  test('handles paths with colons in directory names', () => {
    // Edge case: path has colon but no valid slice suffix
    const result = parseSlice('C:/Users/main.ts');
    expect(result.sliceType).toBe('full');
    expect(result.path).toBe('C:/Users/main.ts');
  });

  test('rejects line number 0 (lines are 1-indexed)', () => {
    const result = parseSlice('file.ts:0');
    expect(result.sliceType).toBe('full');
    expect(result.path).toBe('file.ts:0');
  });

  test('rejects line number 0 in range', () => {
    const result = parseSlice('file.ts:0-10');
    expect(result.sliceType).toBe('full');
    expect(result.path).toBe('file.ts:0-10');
  });

  test('rejects end < start', () => {
    const result = parseSlice('file.ts:20-10');
    expect(result.sliceType).toBe('full');
    expect(result.path).toBe('file.ts:20-10');
  });

  test('accepts end == start (single line via range)', () => {
    const result = parseSlice('file.ts:5-5');
    expect(result.sliceType).toBe('range');
    expect(result.startLine).toBe(5);
    expect(result.endLine).toBe(5);
  });
});

describe('formatSlice', () => {
  test('formats file without slice', () => {
    const result = formatSlice({ path: 'main.ts', sliceType: 'full' });
    expect(result).toBe('main.ts');
  });

  test('formats file with range slice', () => {
    const result = formatSlice({ path: 'main.ts', sliceType: 'range', startLine: 10, endLine: 20 });
    expect(result).toBe('main.ts:10-20');
  });

  test('formats file with open-ended slice', () => {
    const result = formatSlice({ path: 'main.ts', sliceType: 'infinite-range', startLine: 15 });
    expect(result).toBe('main.ts:15-');
  });

  test('formats file with single line slice', () => {
    const result = formatSlice({ path: 'main.ts', sliceType: 'single-line', startLine: 8 });
    expect(result).toBe('main.ts:8');
  });

  test('roundtrips through parse and format', () => {
    const inputs = ['main.ts', 'main.ts:10-20', 'main.ts:15-', 'main.ts:8', '/abs/path.ts:1-5'];
    for (const input of inputs) {
      expect(formatSlice(parseSlice(input))).toBe(input);
    }
  });
});

describe('slicesOverlap', () => {
  test('different files do not overlap', () => {
    const a = parseSlice('a.ts:1-10');
    const b = parseSlice('b.ts:1-10');
    expect(slicesOverlap(a, b)).toBe(false);
  });

  test('same file without slices overlap', () => {
    const a = parseSlice('a.ts');
    const b = parseSlice('a.ts');
    expect(slicesOverlap(a, b)).toBe(true);
  });

  test('file without slice overlaps any slice of same file', () => {
    const a = parseSlice('a.ts');
    const b = parseSlice('a.ts:10-20');
    expect(slicesOverlap(a, b)).toBe(true);
    expect(slicesOverlap(b, a)).toBe(true);
  });

  test('adjacent slices do not overlap', () => {
    const a = parseSlice('a.ts:1-10');
    const b = parseSlice('a.ts:11-20');
    expect(slicesOverlap(a, b)).toBe(false);
  });

  test('overlapping slices detected', () => {
    const a = parseSlice('a.ts:1-15');
    const b = parseSlice('a.ts:10-20');
    expect(slicesOverlap(a, b)).toBe(true);
  });

  test('contained slices detected', () => {
    const a = parseSlice('a.ts:1-20');
    const b = parseSlice('a.ts:5-10');
    expect(slicesOverlap(a, b)).toBe(true);
  });
});

describe('extractSlice', () => {
  const content = 'line1\nline2\nline3\nline4\nline5';

  test('returns full content without slice', () => {
    const slice = parseSlice('file.ts');
    expect(extractSlice(content, slice)).toBe(content);
  });

  test('extracts range', () => {
    const slice = parseSlice('file.ts:2-4');
    expect(extractSlice(content, slice)).toBe('line2\nline3\nline4');
  });

  test('extracts single line', () => {
    const slice = parseSlice('file.ts:3');
    expect(extractSlice(content, slice)).toBe('line3');
  });

  test('extracts to end of file', () => {
    const slice = parseSlice('file.ts:4-');
    expect(extractSlice(content, slice)).toBe('line4\nline5');
  });

  test('handles out of bounds gracefully', () => {
    const slice = parseSlice('file.ts:3-100');
    expect(extractSlice(content, slice)).toBe('line3\nline4\nline5');
  });
});
