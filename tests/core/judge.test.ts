import { describe, it, expect } from 'bun:test';
import { formatJudgePrompt, parseJudgeDecision } from '../../src/core/judge';

describe('judge', () => {
  describe('formatJudgePrompt', () => {
    it('formats candidates with task context', () => {
      const candidates = ['Answer A', 'Answer B'];
      const indexMapping = [0, 1];
      const prompt = formatJudgePrompt(candidates, indexMapping, 'What is 2+2?');
      
      expect(prompt).toContain('Original task: What is 2+2?');
      expect(prompt).toContain('Candidate 1');
      expect(prompt).toContain('Candidate 2');
      expect(prompt).toContain('Answer A');
      expect(prompt).toContain('Answer B');
    });

    it('respects index mapping for shuffled order', () => {
      const candidates = ['First', 'Second', 'Third'];
      const indexMapping = [2, 0, 1]; // Third, First, Second
      const prompt = formatJudgePrompt(candidates, indexMapping);
      
      // Candidate 1 should be "Third" (index 2)
      expect(prompt).toMatch(/Candidate 1\nThird/);
      // Candidate 2 should be "First" (index 0)
      expect(prompt).toMatch(/Candidate 2\nFirst/);
    });
  });

  describe('parseJudgeDecision', () => {
    it('parses high confidence decision', () => {
      const text = '<best>2</best>\n<confidence>high</confidence>\n<reason>Better explanation</reason>';
      const indexMapping = [0, 1, 2];
      const decision = parseJudgeDecision(text, indexMapping, 3);
      
      expect(decision.selectedIndex).toBe(1); // Candidate 2 -> index 1
      expect(decision.confidence).toBe(0.9);
      expect(decision.confidenceLevel).toBe('high');
      expect(decision.reasoning).toBe('Better explanation');
    });

    it('parses medium confidence decision', () => {
      const text = '<best>1</best>\n<confidence>medium</confidence>';
      const indexMapping = [0, 1];
      const decision = parseJudgeDecision(text, indexMapping, 2);
      
      expect(decision.confidence).toBe(0.5);
      expect(decision.confidenceLevel).toBe('medium');
    });

    it('parses low confidence decision', () => {
      const text = '<best>3</best>\n<confidence>low</confidence>';
      const indexMapping = [0, 1, 2];
      const decision = parseJudgeDecision(text, indexMapping, 3);
      
      expect(decision.confidence).toBe(0.3);
      expect(decision.confidenceLevel).toBe('low');
    });

    it('maps shuffled display index back to original', () => {
      const text = '<best>1</best>\n<confidence>high</confidence>';
      // If indexMapping[0] = 2, then display index 1 maps to original index 2
      const indexMapping = [2, 0, 1];
      const decision = parseJudgeDecision(text, indexMapping, 3);
      
      expect(decision.selectedIndex).toBe(2); // Display 1 -> original 2
    });

    it('defaults to medium confidence when not specified', () => {
      const text = '<best>1</best>';
      const indexMapping = [0];
      const decision = parseJudgeDecision(text, indexMapping, 1);
      
      expect(decision.confidence).toBe(0.5);
      expect(decision.confidenceLevel).toBe('medium');
    });

    it('clamps out-of-bounds index', () => {
      const text = '<best>99</best>\n<confidence>high</confidence>';
      const indexMapping = [0, 1, 2];
      const decision = parseJudgeDecision(text, indexMapping, 3);
      
      // Should clamp to last valid index (2)
      expect(decision.selectedIndex).toBe(2);
    });
  });
});
