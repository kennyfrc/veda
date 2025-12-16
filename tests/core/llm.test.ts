import { describe, it, expect } from 'bun:test';
import { combineUsage, extractText, getSessionId, getUsage } from '../../src/core/llm';
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
