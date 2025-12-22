import { describe, it, expect, mock } from 'bun:test';

// Import the backends to test their normalizeEvent methods
// We'll test via the class instances since normalizeEvent is private

import { isSpawnEnoent, computeBackoffMs, sleep } from '../../src/backend/util/spawn';

describe('spawn retry utilities', () => {
  describe('isSpawnEnoent', () => {
    it('detects ENOENT from error code', () => {
      expect(isSpawnEnoent({ code: 'ENOENT' })).toBe(true);
    });
    
    it('detects ENOENT from error message', () => {
      expect(isSpawnEnoent({ message: 'Executable not found in $PATH: "gemini"' })).toBe(true);
      expect(isSpawnEnoent({ message: 'some error with ENOENT in it' })).toBe(true);
    });
    
    it('returns false for non-ENOENT errors', () => {
      expect(isSpawnEnoent({ code: 'ECONNREFUSED' })).toBe(false);
      expect(isSpawnEnoent({ message: 'Connection refused' })).toBe(false);
      expect(isSpawnEnoent({ message: 'Unknown error' })).toBe(false);
    });
    
    it('handles null/undefined gracefully', () => {
      expect(isSpawnEnoent(null)).toBe(false);
      expect(isSpawnEnoent(undefined)).toBe(false);
    });
    
    it('handles non-objects gracefully', () => {
      expect(isSpawnEnoent('string error')).toBe(false);
      expect(isSpawnEnoent(123)).toBe(false);
    });
  });
  
  describe('computeBackoffMs', () => {
    it('computes exponential backoff', () => {
      // Attempt 0: 250ms * 2^0 = 250ms
      expect(computeBackoffMs(0, { jitter: false })).toBe(250);
      // Attempt 1: 250ms * 2^1 = 500ms
      expect(computeBackoffMs(1, { jitter: false })).toBe(500);
      // Attempt 2: 250ms * 2^2 = 1000ms
      expect(computeBackoffMs(2, { jitter: false })).toBe(1000);
      // Attempt 3: 250ms * 2^3 = 2000ms (capped)
      expect(computeBackoffMs(3, { jitter: false })).toBe(2000);
      // Attempt 4: still capped at 2000ms
      expect(computeBackoffMs(4, { jitter: false })).toBe(2000);
    });
    
    it('applies jitter when enabled', () => {
      // Run multiple times to check for jitter range
      const delays: number[] = [];
      for (let i = 0; i < 100; i++) {
        delays.push(computeBackoffMs(0, { jitter: true }));
      }
      // With jitter ±20%, should range from 200 to 300
      const min = Math.min(...delays);
      const max = Math.max(...delays);
      expect(min).toBeGreaterThanOrEqual(200);
      expect(max).toBeLessThanOrEqual(300);
    });
    
    it('respects custom base delay', () => {
      expect(computeBackoffMs(0, { baseDelayMs: 100, jitter: false })).toBe(100);
      expect(computeBackoffMs(1, { baseDelayMs: 100, jitter: false })).toBe(200);
    });
    
    it('respects max delay cap', () => {
      // With base 500 and max 600, attempt 2 would be 2000 but capped to 600
      expect(computeBackoffMs(2, { baseDelayMs: 500, maxDelayMs: 600, jitter: false })).toBe(600);
    });
  });
  
  describe('sleep', () => {
    it('resolves after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      // Allow some tolerance
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(100);
    });
  });
});

// Import the backends to test their normalizeEvent methods
// We'll test via the class instances since normalizeEvent is private

describe('transient error filtering', () => {
  describe('codex backend', () => {
    // Import dynamically to get access to the pattern
    const { CodexBackend } = require('../../src/backend/codex');
    const backend = new CodexBackend();
    
    // Access the private method via prototype for testing
    const normalizeEvent = (event: unknown) => {
      return (backend as any).normalizeEvent(event);
    };
    
    it('filters reconnection attempts', () => {
      const event = { type: 'error', message: 'Reconnecting... 1/5' };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('filters reconnection with different counts', () => {
      expect(normalizeEvent({ type: 'error', message: 'Reconnecting... 3/10' })).toBeNull();
      expect(normalizeEvent({ type: 'error', message: 'Reconnecting... 10/10' })).toBeNull();
    });
    
    it('does not filter real errors', () => {
      const event = { type: 'error', message: 'Authentication failed' };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.content).toBe('Authentication failed');
    });
    
    it('does not filter partial match', () => {
      // Should not match if it's part of a larger message
      const event = { type: 'error', message: 'Error while Reconnecting... 1/5 to server' };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
    });
  });
  
  describe('gemini backend', () => {
    const { GeminiBackend } = require('../../src/backend/gemini');
    const backend = new GeminiBackend();
    
    const normalizeEvent = (event: unknown) => {
      return (backend as any).normalizeEvent(event);
    };
    
    it('filters warning severity errors', () => {
      const event = { type: 'error', severity: 'warning', message: 'Loop detected' };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('does not filter error severity', () => {
      const event = { type: 'error', severity: 'error', message: 'Fatal error' };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.content).toBe('Fatal error');
    });
    
    it('does not filter when severity is missing (defaults to error)', () => {
      const event = { type: 'error', message: 'Some error' };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
    });
  });
  
  describe('claude backend', () => {
    const { ClaudeBackend } = require('../../src/backend/claude');
    const backend = new ClaudeBackend();
    
    const normalizeEvent = (event: unknown) => {
      return (backend as any).normalizeEvent(event);
    };
    
    it('filters retry messages in result', () => {
      const event = { type: 'result', is_error: true, result: 'Retrying in 5 seconds...' };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('filters attempt count messages', () => {
      const event = { type: 'result', is_error: true, result: 'Connection failed (attempt 3/10)' };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('filters API connection errors', () => {
      const event = { type: 'result', is_error: true, result: 'API Error: Connection error' };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('filters error event type with retry pattern', () => {
      const event = { type: 'error', error: { message: 'Retrying in 40 seconds...' } };
      expect(normalizeEvent(event)).toBeNull();
    });
    
    it('does not filter real errors in result', () => {
      const event = { type: 'result', is_error: true, result: 'Invalid API key' };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.content).toBe('Invalid API key');
    });
    
    it('does not filter success results', () => {
      const event = { 
        type: 'result', 
        is_error: false, 
        session_id: 'abc',
        usage: { input_tokens: 100, output_tokens: 50 }
      };
      const result = normalizeEvent(event);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('done');
    });
  });
});
