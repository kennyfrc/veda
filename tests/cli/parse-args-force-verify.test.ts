import { describe, test, expect } from 'bun:test';
import { parseArgs } from '../../src/cli';

describe('CLI parsing for --force-verify flag', () => {
  test('parses no flags', () => {
    const result = parseArgs(['node', 'veda', 'deep', 'test prompt']);

    expect(result.options.forceVerify).toBeUndefined();
    expect(result.options.noVerify).toBeUndefined();
  });

  test('parses --force-verify flag', () => {
    const result = parseArgs(['node', 'veda', 'deep', '--force-verify', 'test prompt']);

    expect(result.options.forceVerify).toBe(true);
    expect(result.options.noVerify).toBeUndefined();
  });

  test('parses --no-verify flag', () => {
    const result = parseArgs(['node', 'veda', 'deep', '--no-verify', 'test prompt']);

    expect(result.options.noVerify).toBe(true);
    expect(result.options.forceVerify).toBeUndefined();
  });

  test('parses both --force-verify and --no-verify (verifier wins)', () => {
    const result = parseArgs(['node', 'veda', 'deep', '--force-verify', '--no-verify', 'test prompt']);

    // Both should be set because CLI parser doesn't make decisions
    expect(result.options.forceVerify).toBe(true);
    expect(result.options.noVerify).toBe(true);

    // The pipeline will handle precedence: noVerify → verifyEnabled = false → shouldVerify = false
  });

  test('parses flags in different order (--no-verify first)', () => {
    const result = parseArgs(['node', 'veda', 'deep', '--no-verify', '--force-verify', 'test prompt']);

    expect(result.options.forceVerify).toBe(true);
    expect(result.options.noVerify).toBe(true);
  });

  test('works with other deep mode flags', () => {
    const result = parseArgs([
      'node', 'veda', 'deep',
      '--force-verify',
      '-k', '5',
      '--categories', 'analytical,creative',
      'test prompt'
    ]);

    expect(result.options.forceVerify).toBe(true);
    expect(result.options.k).toBe(5);
    expect(result.options.categories).toEqual(['analytical', 'creative']);
  });

  test('parses --deep and --force-verify together', () => {
    const result = parseArgs(['node', 'veda', '--deep', '--force-verify', 'test prompt']);

    expect(result.options.deep).toBe(true);
    expect(result.options.forceVerify).toBe(true);
  });

  test('parses --deep -d and --force-verify together', () => {
    const result = parseArgs(['node', 'veda', '-d', '--force-verify', 'test prompt']);

    expect(result.options.deep).toBe(true);
    expect(result.options.forceVerify).toBe(true);
  });
});
