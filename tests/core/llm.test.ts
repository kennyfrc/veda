import { describe, it, expect } from 'bun:test';
import { combineUsage, extractText, extractErrors, getSessionId, getUsage } from '../../src/core/llm';
import type { Message, UsageStats } from '../../src/core/llm';

describe('llm helpers', () => {
  describe('extractText', () => {
    it('extracts text from messages', () => {
      const messages: Message[] = [
        { type: 'init', sessionId: 'abc' },
        { type: 'text', content: 'Hello ' },
        { type: 'text', content: 'world' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ];
      
      expect(extractText(messages)).toBe('Hello world');
    });

    it('handles empty content', () => {
      const messages: Message[] = [
        { type: 'text' },
        { type: 'text', content: 'test' },
      ];
      
      expect(extractText(messages)).toBe('test');
    });
  });

  describe('extractErrors', () => {
    it('returns empty array when no errors', () => {
      const messages: Message[] = [
        { type: 'init', sessionId: 'abc' },
        { type: 'text', content: 'Hello' },
        { type: 'done' },
      ];
      
      expect(extractErrors(messages)).toEqual([]);
    });

    it('extracts single error', () => {
      const messages: Message[] = [
        { type: 'init' },
        { type: 'error', content: 'Auth failed' },
        { type: 'done' },
      ];
      
      expect(extractErrors(messages)).toEqual(['Auth failed']);
    });

    it('extracts multiple errors', () => {
      const messages: Message[] = [
        { type: 'error', content: 'Error 1' },
        { type: 'text', content: 'some text' },
        { type: 'error', content: 'Error 2' },
      ];
      
      expect(extractErrors(messages)).toEqual(['Error 1', 'Error 2']);
    });

    it('filters out undefined content', () => {
      const messages: Message[] = [
        { type: 'error' },
        { type: 'error', content: 'Real error' },
      ];
      
      expect(extractErrors(messages)).toEqual(['Real error']);
    });

    it('filters out empty content', () => {
      const messages: Message[] = [
        { type: 'error', content: '' },
        { type: 'error', content: 'Real error' },
      ];
      
      expect(extractErrors(messages)).toEqual(['Real error']);
    });

    it('returns empty array for empty messages', () => {
      expect(extractErrors([])).toEqual([]);
    });
  });

  describe('getSessionId', () => {
    it('returns session ID from init message', () => {
      const messages: Message[] = [
        { type: 'init', sessionId: 'session-123' },
        { type: 'text', content: 'Hello' },
      ];
      
      expect(getSessionId(messages)).toBe('session-123');
    });

    it('returns undefined when no init message', () => {
      const messages: Message[] = [
        { type: 'text', content: 'Hello' },
      ];
      
      expect(getSessionId(messages)).toBeUndefined();
    });
  });

  describe('getUsage', () => {
    it('returns usage from done message', () => {
      const messages: Message[] = [
        { type: 'text', content: 'Hello' },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } },
      ];
      
      const usage = getUsage(messages);
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.outputTokens).toBe(50);
    });

    it('returns undefined when no done message', () => {
      const messages: Message[] = [
        { type: 'text', content: 'Hello' },
      ];
      
      expect(getUsage(messages)).toBeUndefined();
    });
  });

  describe('combineUsage', () => {
    it('sums all usage fields', () => {
      const usages: UsageStats[] = [
        { inputTokens: 100, outputTokens: 50, cachedTokens: 10, costUsd: 0.01 },
        { inputTokens: 200, outputTokens: 100, cachedTokens: 20, costUsd: 0.02 },
      ];
      
      const result = combineUsage(usages);
      
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.cachedTokens).toBe(30);
      expect(result.costUsd).toBe(0.03);
    });

    it('handles empty array', () => {
      const result = combineUsage([]);
      
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('handles undefined in array', () => {
      const usages: (UsageStats | undefined)[] = [
        { inputTokens: 100, outputTokens: 50 },
        undefined,
        { inputTokens: 200, outputTokens: 100 },
      ];
      
      const result = combineUsage(usages);
      
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
    });

    it('handles all undefined optional fields', () => {
      const usages: UsageStats[] = [
        { inputTokens: 100, outputTokens: 50 },
        { inputTokens: 200, outputTokens: 100 },
      ];
      
      const result = combineUsage(usages);
      
      expect(result.cachedTokens).toBeUndefined();
      expect(result.costUsd).toBeUndefined();
    });
  });
});
