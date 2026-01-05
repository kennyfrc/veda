/**
 * Test: resolveStageReasoning with base -r flag override
 * 
 * Tests the actual implementation in resolve.ts to ensure -r properly overrides
 * config defaults for all stages, matching the behavior of -b/-m.
 */

import { describe, test, expect } from 'bun:test';
import { resolveStageReasoning } from '../../src/cli/resolve';
import type { RawFlags } from '../../src/cli/types';
import type { GlobalConfig, ReasoningLevel } from '../../src/agent/config';

function makeFlags(overrides: Partial<RawFlags> = {}): RawFlags {
  return {
    files: [],
    noSel: false,
    json: false,
    deep: false,
    noVerify: false,
    forceVerify: false,
    statsModule: false,
    statsCategory: false,
    statsBackend: false,
    help: false,
    version: false,
    dryRun: false,
    ...overrides,
  };
}

function makeConfig(deep: GlobalConfig['deep'] = {}): GlobalConfig {
  return { deep };
}

describe('resolveStageReasoning', () => {
  describe('base -r flag precedence', () => {
    test('-r overrides all stages regardless of config', () => {
      const flags = makeFlags({ reasoning: 'high' });
      const config = makeConfig({
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'medium',
        revisionReasoning: 'low',
      });

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('high');
    });

    test('-r xhigh applies to all stages', () => {
      const flags = makeFlags({ reasoning: 'xhigh' });
      const config = makeConfig({});

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('xhigh');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('xhigh');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('xhigh');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('xhigh');
    });

    test('per-stage CLI flags override -r', () => {
      const flags = makeFlags({
        reasoning: 'high',
        judgeReasoning: 'low',  // Explicit override
      });
      const config = makeConfig({});

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('low');  // Override
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('high');
    });

    test('-r suppresses config for all stages', () => {
      const flags = makeFlags({ reasoning: 'medium' });
      const config = makeConfig({
        solverReasoning: 'xhigh',
        judgeReasoning: 'xhigh',
        verifierReasoning: 'xhigh',
        revisionReasoning: 'xhigh',
      });

      // All stages use -r value, not config
      expect(resolveStageReasoning(flags, 'solver', config)).toBe('medium');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('medium');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('medium');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('medium');
    });
  });

  describe('without -r flag', () => {
    test('config defaults apply', () => {
      const flags = makeFlags({});
      const config = makeConfig({
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'xhigh',
        revisionReasoning: 'medium',
      });

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('low');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('minimal');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('xhigh');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('medium');
    });

    test('stage defaults apply when no config', () => {
      const flags = makeFlags({});
      const config = makeConfig({});

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('medium');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('medium');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('high');
    });

    test('revision falls back to verifier when not set', () => {
      const flags = makeFlags({ verifierReasoning: 'xhigh' });
      const config = makeConfig({});

      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('xhigh');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('xhigh');
    });

    test('revision falls back to verifier config when not set', () => {
      const flags = makeFlags({});
      const config = makeConfig({ verifierReasoning: 'minimal' });

      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('minimal');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('minimal');
    });
  });

  describe('per-stage flags only', () => {
    test('per-stage flags work independently', () => {
      const flags = makeFlags({
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'high',
        revisionReasoning: 'xhigh',
      });
      const config = makeConfig({
        solverReasoning: 'xhigh',  // Ignored
        judgeReasoning: 'xhigh',   // Ignored
      });

      expect(resolveStageReasoning(flags, 'solver', config)).toBe('low');
      expect(resolveStageReasoning(flags, 'judge', config)).toBe('minimal');
      expect(resolveStageReasoning(flags, 'verifier', config)).toBe('high');
      expect(resolveStageReasoning(flags, 'revision', config)).toBe('xhigh');
    });
  });

  describe('invalid reasoning values', () => {
    test('invalid -r value falls through to config', () => {
      const flags = makeFlags({ reasoning: 'invalid' as any });
      const config = makeConfig({ solverReasoning: 'low' });

      // Invalid -r is not a valid reasoning level, so config applies
      expect(resolveStageReasoning(flags, 'solver', config)).toBe('low');
    });

    test('invalid per-stage flag falls through to -r', () => {
      const flags = makeFlags({
        reasoning: 'high',
        solverReasoning: 'invalid' as any,
      });
      const config = makeConfig({});

      // Invalid per-stage flag is not valid, so -r applies
      expect(resolveStageReasoning(flags, 'solver', config)).toBe('high');
    });
  });
});
