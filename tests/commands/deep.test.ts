import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSlice, readSliceText } from '../../src/context';
import { resolve } from 'path';

// Test the context building logic used in deep.ts
// This verifies that file slices work correctly with ad-hoc files

const TEST_BASE = join(tmpdir(), 'veda-deep-test-' + process.pid + '-' + Date.now());

/** 
 * Simulates buildAdhocContext from deep.ts
 * This is a copy of the fixed logic to test it independently
 */
async function buildAdhocContext(files: string[], cwd: string): Promise<string> {
  const parts: string[] = [];
  
  for (const path of files) {
    const slice = parseSlice(path);
    const absolutePath = resolve(cwd, slice.path);
    
    const result = await readSliceText({
      cwd,
      slice: { ...slice, path: absolutePath },
    });
    
    if (result) {
      // path already includes slice suffix (e.g., "file.ts:10-20")
      // so we use it directly for the header
      parts.push(`## ${path}\n\`\`\`\n${result.content}\n\`\`\``);
    }
  }
  
  return parts.join('\n\n');
}

describe('deep command context building', () => {
  beforeEach(async () => {
    await mkdir(TEST_BASE, { recursive: true });
    // Create test file with 5 lines
    await writeFile(join(TEST_BASE, 'test.ts'), 'line1\nline2\nline3\nline4\nline5');
  });

  afterEach(async () => {
    try {
      await rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('handles file without slice', async () => {
    const result = await buildAdhocContext([join(TEST_BASE, 'test.ts')], TEST_BASE);
    
    expect(result).toContain('## ');
    expect(result).toContain('test.ts');
    expect(result).toContain('line1');
    expect(result).toContain('line5');
  });

  test('handles file with range slice', async () => {
    const result = await buildAdhocContext([`${join(TEST_BASE, 'test.ts')}:2-4`], TEST_BASE);
    
    // Header includes the slice suffix from the original path
    expect(result).toContain(':2-4');
    expect(result).not.toContain('line1');
    expect(result).toContain('line2');
    expect(result).toContain('line3');
    expect(result).toContain('line4');
    expect(result).not.toContain('line5');
  });

  test('handles file with open-ended slice', async () => {
    const result = await buildAdhocContext([`${join(TEST_BASE, 'test.ts')}:3-`], TEST_BASE);
    
    // Header includes the slice suffix from the original path
    expect(result).toContain(':3-');
    expect(result).not.toContain('line1');
    expect(result).not.toContain('line2');
    expect(result).toContain('line3');
    expect(result).toContain('line4');
    expect(result).toContain('line5');
  });

  test('handles single line slice', async () => {
    const result = await buildAdhocContext([`${join(TEST_BASE, 'test.ts')}:3`], TEST_BASE);
    
    // Header includes the slice suffix from the original path
    expect(result).toContain(':3\n');
    expect(result).not.toContain('line1');
    expect(result).not.toContain('line2');
    expect(result).toContain('line3');
    expect(result).not.toContain('line4');
    expect(result).not.toContain('line5');
  });

  test('handles multiple files with mixed slices', async () => {
    await writeFile(join(TEST_BASE, 'other.ts'), 'a\nb\nc\nd\ne');
    
    const result = await buildAdhocContext([
      `${join(TEST_BASE, 'test.ts')}:1-2`,
      join(TEST_BASE, 'other.ts'),
    ], TEST_BASE);
    
    // First file: sliced (header includes slice suffix)
    expect(result).toContain('test.ts:1-2');
    expect(result).toContain('line1');
    expect(result).toContain('line2');
    expect(result).not.toContain('line3');
    
    // Second file: full
    expect(result).toContain('other.ts');
    expect(result).toContain('a\nb\nc\nd\ne');
  });

  test('skips non-existent files silently', async () => {
    const result = await buildAdhocContext([
      join(TEST_BASE, 'nonexistent.ts'),
      join(TEST_BASE, 'test.ts'),
    ], TEST_BASE);
    
    // Only test.ts should be included
    expect(result).toContain('test.ts');
    expect(result).not.toContain('nonexistent');
    expect(result).toContain('line1');
  });

  test('handles slice with invalid file gracefully', async () => {
    const result = await buildAdhocContext([
      `${join(TEST_BASE, 'nonexistent.ts')}:1-10`,
    ], TEST_BASE);
    
    // Should return empty string when no files found
    expect(result).toBe('');
  });
});
