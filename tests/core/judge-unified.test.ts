import { describe, it, expect } from 'bun:test';
import {
  canUseMultiJudge,
  canUsePairwiseJudge,
  getEffectiveJudgeMode,
  type CandidateInfo,
} from '../../src/core';

describe('canUseMultiJudge', () => {
  it('should return true for multiple backends', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'codex', content: 'B' },
    ];
    
    expect(canUseMultiJudge(candidates)).toBe(true);
  });
  
  it('should return false for single backend', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'claude-code', content: 'B' },
    ];
    
    expect(canUseMultiJudge(candidates)).toBe(false);
  });
  
  it('should return false for empty candidates', () => {
    expect(canUseMultiJudge([])).toBe(false);
  });
});

describe('getEffectiveJudgeMode', () => {
  it('should return single when requested single', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'codex', content: 'B' },
    ];
    
    expect(getEffectiveJudgeMode('single', candidates)).toBe('single');
  });
  
  it('should return multi when requested multi and possible', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'codex', content: 'B' },
    ];
    
    expect(getEffectiveJudgeMode('multi', candidates)).toBe('multi');
  });
  
  it('should fall back to single when multi not possible', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'claude-code', content: 'B' },
    ];
    
    expect(getEffectiveJudgeMode('multi', candidates)).toBe('single');
  });
  
  it('should return pairwise when requested and 2+ candidates', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'codex', content: 'B' },
    ];
    
    expect(getEffectiveJudgeMode('pairwise', candidates)).toBe('pairwise');
  });
  
  it('should fall back to single for pairwise with single backend', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'claude-code', content: 'B' },
    ];
    
    // Pairwise requires 2+ backends, falls back to single-judge
    expect(getEffectiveJudgeMode('pairwise', candidates)).toBe('single');
  });
  
  it('should fall back to single for pairwise with <2 candidates', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
    ];
    
    expect(getEffectiveJudgeMode('pairwise', candidates)).toBe('single');
  });
});

describe('canUsePairwiseJudge', () => {
  it('should return true for 2+ backends', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'codex', content: 'B' },
    ];
    
    expect(canUsePairwiseJudge(candidates)).toBe(true);
  });
  
  it('should return false for single backend', () => {
    const candidates: CandidateInfo[] = [
      { id: 's0', solverBackend: 'claude-code', content: 'A' },
      { id: 's1', solverBackend: 'claude-code', content: 'B' },
    ];
    
    expect(canUsePairwiseJudge(candidates)).toBe(false);
  });
  
  it('should return false for <2 candidates', () => {
    expect(canUsePairwiseJudge([])).toBe(false);
    expect(canUsePairwiseJudge([{ id: 's0', solverBackend: 'claude-code', content: 'A' }])).toBe(false);
  });
});
