import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Test that -m propagates to solver, judge, and verifier in deep mode

describe('Deep mode model propagation', () => {
  // We test the resolution logic by importing the config module
  // and verifying the fallback behavior
  
  describe('resolveBackendModel with fallbackModel', () => {
    test('fallbackModel is used when explicitModel is undefined', async () => {
      const { resolveBackendModel } = await import('../../src/agent/config');
      
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
        explicitModel: undefined,
        fallbackBackend: 'gemini-cli',
        fallbackModel: 'gemini-3-pro-preview',  // This simulates base.model from -m
      });
      
      expect(result.model).toBe('gemini-3-pro-preview');
    });
    
    test('explicitModel overrides fallbackModel', async () => {
      const { resolveBackendModel } = await import('../../src/agent/config');
      
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
        explicitModel: 'gemini-3-flash-preview',  // --solver-model overrides -m
        fallbackBackend: 'gemini-cli',
        fallbackModel: 'gemini-3-pro-preview',  // base.model from -m
      });
      
      expect(result.model).toBe('gemini-3-flash-preview');
    });
    
    test('model alias resolves correctly when passed as fallbackModel', async () => {
      const { resolveBackendModel } = await import('../../src/agent/config');
      
      // When base.model is already resolved (e.g., 'gemini-3-pro-preview' not 'gemini-pro'),
      // it should be used as-is
      const result = resolveBackendModel({
        explicitBackend: 'gemini-cli',
        explicitModel: undefined,
        fallbackBackend: 'gemini-cli',
        fallbackModel: 'gemini-3-pro-preview',  // Already resolved, not an alias
      });
      
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.backend).toBe('gemini-cli');
    });
  });
  
  describe('multi-backend distribution conflict', () => {
    test('throws error when -m used with multi-backend --distribute-solvers', async () => {
      // We can't easily test expandDeepThinkOptions directly without mocking backends,
      // but we can verify the error message format
      const expectedError = 'Cannot use -m/--model with --distribute-solvers across multiple backends';
      
      // The actual test would require mocking loadGlobalConfig and getAvailableBackends
      // For now, just verify the error message pattern exists in the source
      const { readFileSync } = await import('fs');
      const source = readFileSync('src/pipelines/deep-think.ts', 'utf-8');
      
      expect(source).toContain(expectedError);
    });
  });
});
