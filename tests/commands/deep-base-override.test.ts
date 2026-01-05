/**
 * Test: Base CLI override (-b/-m) takes precedence over per-stage config defaults
 * 
 * This tests the fix for: when -b or -m is passed, it should override DEEP_* config
 * for all stages (solver, judge, verifier, revision) unless per-stage CLI flags are used.
 */

import { describe, test, expect } from 'bun:test';
import { resolveBackendModel } from '../../src/agent/config';
import type { GlobalConfig } from '../../src/agent/config';

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
        verifierBackend: 'gemini-cli',
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
        revisionModel: 'gemini-pro'
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
        verifierBackend: 'gemini-cli',
        verifierModel: 'gemini-pro',
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
        judgeBackend: 'gemini-cli',
        judgeModel: 'gemini-pro',
        verifierBackend: 'gemini-cli',
        verifierModel: 'gemini-pro'
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
        verifierBackend: 'gemini-cli',
        verifierModel: 'gemini-pro'
      }
    );
    
    expect(result.judge.backend).toBe('claude-code');
    expect(result.judge.model).toBe('opus');
    expect(result.verifier.backend).toBe('gemini-cli');
    expect(result.verifier.model).toBe('gemini-pro');
  });

  test('-b alone suppresses config backends but not models', () => {
    const result = resolveEffectiveStageValues(
      { backend: 'codex' },  // Only -b, no -m
      { 
        judgeBackend: 'claude-code',
        judgeModel: 'opus',  // Config has model
        verifierBackend: 'gemini-cli',
        verifierModel: 'gemini-pro'
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
