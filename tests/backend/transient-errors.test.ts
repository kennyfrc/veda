import { describe, it, expect } from 'bun:test';

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
