import { describe, expect, test } from 'bun:test';
import { resolveDeepStages } from '../../src/cli/resolve';
import type { RawFlags, ResolvedBackendModel } from '../../src/cli/types';
import type { GlobalConfig } from '../../src/agent/config';

/**
 * Tests for "pinned base" behavior:
 * When user passes -b or -m (that infers backend), config-driven distribution
 * should be suppressed unless --distribute-solvers is explicitly passed.
 */
describe('Pinned base suppresses config distribution', () => {
  const baseFlags: RawFlags = {
    files: [],
    noSel: false,
    json: false,
    deep: true,
    noVerify: false,
    forceVerify: false,
    statsModule: false,
    statsCategory: false,
    statsBackend: false,
    help: false,
    session: 'test',
  };

  const configWithDistribution: GlobalConfig = {
    deep: {
      distributeSolvers: true,
      solverBackends: ['codex', 'claude-code', 'droid'],
    },
  };

  describe('source=explicit (from -b flag)', () => {
    const explicitBase: ResolvedBackendModel = {
      backend: 'codex',
      model: 'gpt-5.2',
      source: 'explicit',
    };

    test('-b codex suppresses config distribution', () => {
      const stages = resolveDeepStages({
        flags: baseFlags,
        baseResolved: explicitBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('fixed');
      if (stages.solver.mode === 'fixed') {
        expect(stages.solver.backend).toBe('codex');
      }
    });

    test('-b codex --distribute-solvers still enables distribution', () => {
      const stages = resolveDeepStages({
        flags: { ...baseFlags, distributeSolvers: true },
        baseResolved: explicitBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('distributed');
    });

    test('-b codex with --distribute-solvers=false stays fixed', () => {
      const stages = resolveDeepStages({
        flags: { ...baseFlags, distributeSolvers: false },
        baseResolved: explicitBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('fixed');
    });
  });

  describe('source=alias (from -m opus)', () => {
    const aliasBase: ResolvedBackendModel = {
      backend: 'claude-code',
      model: 'claude-sonnet-4-20250514',
      source: 'alias',
    };

    test('-m opus suppresses config distribution', () => {
      const stages = resolveDeepStages({
        flags: baseFlags,
        baseResolved: aliasBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('fixed');
      if (stages.solver.mode === 'fixed') {
        expect(stages.solver.backend).toBe('claude-code');
      }
    });
  });

  describe('source=prefix (from -m gpt-5.2)', () => {
    const prefixBase: ResolvedBackendModel = {
      backend: 'codex',
      model: 'gpt-5.2',
      source: 'prefix',
    };

    test('-m gpt-5.2 suppresses config distribution', () => {
      const stages = resolveDeepStages({
        flags: baseFlags,
        baseResolved: prefixBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('fixed');
      if (stages.solver.mode === 'fixed') {
        expect(stages.solver.backend).toBe('codex');
      }
    });
  });

  describe('source=config or source=default (no pinning)', () => {
    const configBase: ResolvedBackendModel = {
      backend: 'codex',
      model: 'gpt-5.2',
      source: 'config',
    };

    const defaultBase: ResolvedBackendModel = {
      backend: 'codex',
      model: 'gpt-5.2',
      source: 'default',
    };

    test('config-derived base allows config distribution', () => {
      const stages = resolveDeepStages({
        flags: baseFlags,
        baseResolved: configBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('distributed');
    });

    test('default base allows config distribution', () => {
      const stages = resolveDeepStages({
        flags: baseFlags,
        baseResolved: defaultBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('distributed');
    });
  });

  describe('--solver-backend always wins', () => {
    const explicitBase: ResolvedBackendModel = {
      backend: 'codex',
      model: 'gpt-5.2',
      source: 'explicit',
    };

    test('--solver-backend overrides -b', () => {
      const stages = resolveDeepStages({
        flags: { ...baseFlags, solverBackend: 'droid' },
        baseResolved: explicitBase,
        globalConfig: configWithDistribution,
      });

      expect(stages.solver.mode).toBe('fixed');
      if (stages.solver.mode === 'fixed') {
        expect(stages.solver.backend).toBe('droid');
      }
    });
  });
});
