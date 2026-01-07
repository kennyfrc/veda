import { describe, it, expect } from 'bun:test';
import {
  canUseMultiJudge,
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
});
