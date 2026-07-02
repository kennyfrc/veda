/**
 * Test: Base CLI override (-b/-m) takes precedence over per-stage config defaults
 * 
 * This tests the fix for: when -b or -m is passed, it should override DEEP_* config
 * for all stages (solver, judge, verifier, revision) unless per-stage CLI flags are used.
 */

import { describe, test, expect } from 'bun:test';
import { resolveBackendModel } from '../../src/agent/config';
import type { GlobalConfig, ReasoningLevel } from '../../src/agent/config';

// Helper to simulate the effective value resolution logic from handleDeep
function resolveEffectiveStageValues(
  options: {
    backend?: string;
    model?: string;
    judgeBackend?: string;
    judgeModel?: string;
    verifierBackend?: string;
    verifierModel?: string;
    revisionBackend?: string;
    revisionModel?: string;
  },
  deepConfig: {
    judgeBackend?: string;
    judgeModel?: string;
    verifierBackend?: string;
    verifierModel?: string;
    revisionBackend?: string;
    revisionModel?: string;
  }
) {
  // Detect base CLI override
  const cliHasBaseBackend = options.backend !== undefined;
  const cliHasBaseModel = options.model !== undefined;
  const cliHasBaseOverride = cliHasBaseBackend || cliHasBaseModel;

  // Judge
  const effectiveJudgeBackend = options.judgeBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.judgeBackend);
  const effectiveJudgeModel = options.judgeModel ?? (options.judgeBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.judgeModel)));

  // Verifier
  const effectiveVerifierBackend = options.verifierBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.verifierBackend);
  const effectiveVerifierModel = options.verifierModel ?? (options.verifierBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.verifierModel)));

  // Revision
  const effectiveRevisionBackend = options.revisionBackend ?? (cliHasBaseOverride ? options.backend : deepConfig.revisionBackend);
  const effectiveRevisionModel = options.revisionModel ?? (options.revisionBackend ? undefined : (cliHasBaseModel ? options.model : (cliHasBaseBackend ? undefined : deepConfig.revisionModel)));

  return {
    judge: { backend: effectiveJudgeBackend, model: effectiveJudgeModel },
    verifier: { backend: effectiveVerifierBackend, model: effectiveVerifierModel },
    revision: { backend: effectiveRevisionBackend, model: effectiveRevisionModel },
  };
}

describe('Base CLI override precedence', () => {
  test('-b overrides all stage backends from config', () => {
    const result = resolveEffectiveStageValues(
      { backend: 'codex' },
      { 
        judgeBackend: 'claude-code',
        verifierBackend: 'droid',
        revisionBackend: 'claude-code'
      }
    );
    
    expect(result.judge.backend).toBe('codex');
    expect(result.verifier.backend).toBe('codex');
    expect(result.revision.backend).toBe('codex');
  });

  test('-m overrides all stage models from config', () => {
    const result = resolveEffectiveStageValues(
      { model: 'gpt-5.2' },
      { 
        judgeModel: 'opus',
        verifierModel: 'sonnet',
        revisionModel: 'glm-5.2'
      }
    );
    
    expect(result.judge.model).toBe('gpt-5.2');
    expect(result.verifier.model).toBe('gpt-5.2');
    expect(result.revision.model).toBe('gpt-5.2');
  });

  test('-b/-m together override all stages', () => {
    const result = resolveEffectiveStageValues(
      { backend: 'codex', model: 'gpt-5.2' },
      { 
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        verifierBackend: 'droid',
        verifierModel: 'glm-5.2',
        revisionBackend: 'claude-code',
        revisionModel: 'sonnet'
      }
    );
    
    expect(result.judge.backend).toBe('codex');
    expect(result.judge.model).toBe('gpt-5.2');
    expect(result.verifier.backend).toBe('codex');
    expect(result.verifier.model).toBe('gpt-5.2');
    expect(result.revision.backend).toBe('codex');
    expect(result.revision.model).toBe('gpt-5.2');
  });

  test('per-stage CLI flags override base -b/-m', () => {
    const result = resolveEffectiveStageValues(
      { 
        backend: 'codex', 
        model: 'gpt-5.2',
        judgeModel: 'opus'  // Explicit judge override
      },
      { 
        judgeBackend: 'droid',
        judgeModel: 'glm-5.2',
        verifierBackend: 'droid',
        verifierModel: 'glm-5.2'
      }
    );
    
    // Judge uses explicit CLI flag
    expect(result.judge.model).toBe('opus');
    // Judge backend follows base since --judge-backend wasn't set
    expect(result.judge.backend).toBe('codex');
    
    // Verifier/revision use base -b/-m
    expect(result.verifier.backend).toBe('codex');
    expect(result.verifier.model).toBe('gpt-5.2');
    expect(result.revision.backend).toBe('codex');
    expect(result.revision.model).toBe('gpt-5.2');
  });

  test('explicit --judge-backend without --judge-model lets backend resolve default', () => {
    const result = resolveEffectiveStageValues(
      { 
        backend: 'codex', 
        model: 'gpt-5.2',
        judgeBackend: 'claude-code'  // Explicit backend, no model
      },
      {}
    );
    
    // Judge backend is explicit
    expect(result.judge.backend).toBe('claude-code');
    // Judge model should be undefined (let backend resolve its default)
    expect(result.judge.model).toBeUndefined();
    
    // Other stages use base
    expect(result.verifier.backend).toBe('codex');
    expect(result.verifier.model).toBe('gpt-5.2');
  });

  test('without -b/-m, config defaults apply', () => {
    const result = resolveEffectiveStageValues(
      {},  // No CLI flags
      { 
        judgeBackend: 'claude-code',
        judgeModel: 'opus',
        verifierBackend: 'droid',
        verifierModel: 'glm-5.2'
      }
    );
    
    expect(result.judge.backend).toBe('claude-code');
    expect(result.judge.model).toBe('opus');
    expect(result.verifier.backend).toBe('droid');
    expect(result.verifier.model).toBe('glm-5.2');
  });

  test('-b alone suppresses config backends but not models', () => {
    const result = resolveEffectiveStageValues(
      { backend: 'codex' },  // Only -b, no -m
      { 
        judgeBackend: 'claude-code',
        judgeModel: 'opus',  // Config has model
        verifierBackend: 'droid',
        verifierModel: 'glm-5.2'
      }
    );
    
    // Backends should be overridden by -b
    expect(result.judge.backend).toBe('codex');
    expect(result.verifier.backend).toBe('codex');
    
    // Models should be undefined (let backend resolve default, not use config)
    // because cliHasBaseBackend is true, which means config models are suppressed
    expect(result.judge.model).toBeUndefined();
    expect(result.verifier.model).toBeUndefined();
  });
});

// =============================================================================
// Base Reasoning Override Tests
// =============================================================================

// Helper to simulate the effective reasoning resolution logic from handleDeep
function resolveEffectiveReasoningValues(
  options: {
    reasoning?: ReasoningLevel;
    solverReasoning?: ReasoningLevel;
    judgeReasoning?: ReasoningLevel;
    verifierReasoning?: ReasoningLevel;
    revisionReasoning?: ReasoningLevel;
  },
  deepConfig: {
    solverReasoning?: ReasoningLevel;
    judgeReasoning?: ReasoningLevel;
    verifierReasoning?: ReasoningLevel;
    revisionReasoning?: ReasoningLevel;
  }
) {
  // Detect base reasoning override (same pattern as cliHasBaseOverride for -b/-m)
  const cliHasBaseReasoning = options.reasoning !== undefined;
  
  // Stage defaults (used when nothing else is set)
  const DEFAULTS = {
    solver: 'medium' as ReasoningLevel,
    judge: 'medium' as ReasoningLevel,
    verifier: 'high' as ReasoningLevel,
    revision: 'high' as ReasoningLevel,  // Falls back to verifier when no -r
  };

  // Solver: per-stage CLI > base -r > config > default
  const effectiveSolverReasoning = options.solverReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.solverReasoning)
    ?? DEFAULTS.solver;

  // Judge: per-stage CLI > base -r > config > default
  const effectiveJudgeReasoning = options.judgeReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.judgeReasoning)
    ?? DEFAULTS.judge;

  // Verifier: per-stage CLI > base -r > config > default
  const effectiveVerifierReasoning = options.verifierReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.verifierReasoning)
    ?? DEFAULTS.verifier;

  // Revision: per-stage CLI > base -r > config > verifier fallback
  // Note: when cliHasBaseReasoning, revision uses -r directly (no verifier cascade)
  const effectiveRevisionReasoning = options.revisionReasoning 
    ?? (cliHasBaseReasoning ? options.reasoning : deepConfig.revisionReasoning)
    ?? effectiveVerifierReasoning;

  return {
    solver: effectiveSolverReasoning,
    judge: effectiveJudgeReasoning,
    verifier: effectiveVerifierReasoning,
    revision: effectiveRevisionReasoning,
  };
}

describe('Base reasoning override precedence', () => {
  test('-r overrides all stage reasoning from config', () => {
    const result = resolveEffectiveReasoningValues(
      { reasoning: 'high' },
      { 
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'medium',
        revisionReasoning: 'low'
      }
    );
    
    expect(result.solver).toBe('high');
    expect(result.judge).toBe('high');
    expect(result.verifier).toBe('high');
    expect(result.revision).toBe('high');
  });

  test('-r xhigh sets all stages to xhigh', () => {
    const result = resolveEffectiveReasoningValues(
      { reasoning: 'xhigh' },
      {}
    );
    
    expect(result.solver).toBe('xhigh');
    expect(result.judge).toBe('xhigh');
    expect(result.verifier).toBe('xhigh');
    expect(result.revision).toBe('xhigh');
  });

  test('per-stage CLI flags override base -r', () => {
    const result = resolveEffectiveReasoningValues(
      { 
        reasoning: 'high',
        judgeReasoning: 'low'  // Explicit judge override
      },
      { 
        solverReasoning: 'minimal',
        verifierReasoning: 'minimal'
      }
    );
    
    // Solver/verifier/revision use base -r (config suppressed)
    expect(result.solver).toBe('high');
    expect(result.verifier).toBe('high');
    expect(result.revision).toBe('high');
    
    // Judge uses explicit per-stage CLI flag
    expect(result.judge).toBe('low');
  });

  test('without -r, config defaults apply', () => {
    const result = resolveEffectiveReasoningValues(
      {},  // No CLI flags
      { 
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'xhigh',
        revisionReasoning: 'medium'
      }
    );
    
    expect(result.solver).toBe('low');
    expect(result.judge).toBe('minimal');
    expect(result.verifier).toBe('xhigh');
    expect(result.revision).toBe('medium');
  });

  test('without -r and without config, stage defaults apply', () => {
    const result = resolveEffectiveReasoningValues(
      {},  // No CLI flags
      {}   // No config
    );
    
    expect(result.solver).toBe('medium');
    expect(result.judge).toBe('medium');
    expect(result.verifier).toBe('high');
    expect(result.revision).toBe('high');  // Falls back to verifier default
  });

  test('-r suppresses config reasoning for all stages', () => {
    const result = resolveEffectiveReasoningValues(
      { reasoning: 'medium' },
      { 
        solverReasoning: 'xhigh',
        judgeReasoning: 'xhigh',
        verifierReasoning: 'xhigh',
        revisionReasoning: 'xhigh'
      }
    );
    
    // All stages use -r value, config is suppressed
    expect(result.solver).toBe('medium');
    expect(result.judge).toBe('medium');
    expect(result.verifier).toBe('medium');
    expect(result.revision).toBe('medium');
  });

  test('revision falls back to verifier when neither -r nor config set', () => {
    const result = resolveEffectiveReasoningValues(
      { verifierReasoning: 'xhigh' },  // Only verifier set via CLI
      {}
    );
    
    expect(result.verifier).toBe('xhigh');
    expect(result.revision).toBe('xhigh');  // Falls back to verifier
    expect(result.solver).toBe('medium');   // Uses default
    expect(result.judge).toBe('medium');    // Uses default
  });

  test('per-stage flags work independently of -r', () => {
    const result = resolveEffectiveReasoningValues(
      { 
        solverReasoning: 'low',
        judgeReasoning: 'minimal',
        verifierReasoning: 'high',
        revisionReasoning: 'xhigh'
      },
      { 
        solverReasoning: 'xhigh',  // Config ignored when CLI flag set
        judgeReasoning: 'xhigh'
      }
    );
    
    expect(result.solver).toBe('low');
    expect(result.judge).toBe('minimal');
    expect(result.verifier).toBe('high');
    expect(result.revision).toBe('xhigh');
  });
});
