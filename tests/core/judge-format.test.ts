import { describe, expect, test } from 'bun:test';
import { XML_JUDGE_FORMAT, type JudgeFormat } from '../../src/core/judge-format';

describe('JudgeFormat interface', () => {
  test('XML_JUDGE_FORMAT has required structure', () => {
    expect(XML_JUDGE_FORMAT).toBeDefined();
    expect(typeof XML_JUDGE_FORMAT.format).toBe('function');
    expect(typeof XML_JUDGE_FORMAT.parse).toBe('function');
  });

  describe('XML_JUDGE_FORMAT.format', () => {
    test('formats candidates with XML tags', () => {
      const candidates = ['Answer A', 'Answer B'];
      const indexMapping = [0, 1];

      const prompt = XML_JUDGE_FORMAT.format(candidates, indexMapping);

      expect(prompt).toContain('<best>');
      expect(prompt).toContain('<confidence>');
      expect(prompt).toContain('<reason>');
      expect(prompt).toContain('Candidate 1');
      expect(prompt).toContain('Candidate 2');
    });

    test('includes original task when provided', () => {
      const candidates = ['Answer'];
      const indexMapping = [0];

      const prompt = XML_JUDGE_FORMAT.format(candidates, indexMapping, 'What is 2+2?');

      expect(prompt).toContain('Original task: What is 2+2?');
    });

    test('respects shuffled order via index mapping', () => {
      const candidates = ['First', 'Second', 'Third'];
      const indexMapping = [2, 0, 1]; // Display order: Third, First, Second

      const prompt = XML_JUDGE_FORMAT.format(candidates, indexMapping);

      expect(prompt).toMatch(/Candidate 1\nThird/);
      expect(prompt).toMatch(/Candidate 2\nFirst/);
      expect(prompt).toMatch(/Candidate 3\nSecond/);
    });
  });

  describe('XML_JUDGE_FORMAT.parse', () => {
    test('parses high confidence decision', () => {
      const text = '<best>2</best>\n<confidence>high</confidence>\n<reason>Better</reason>';
      const indexMapping = [0, 1, 2];

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.selectedIndex).toBe(1);
      expect(decision.confidence).toBe(0.9);
      expect(decision.confidenceLevel).toBe('high');
      expect(decision.reasoning).toBe('Better');
    });

    test('parses medium confidence decision', () => {
      const text = '<best>1</best>\n<confidence>medium</confidence>';
      const indexMapping = [0, 1];

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.confidence).toBe(0.5);
      expect(decision.confidenceLevel).toBe('medium');
    });

    test('parses low confidence decision', () => {
      const text = '<best>3</best>\n<confidence>low</confidence>';
      const indexMapping = [0, 1, 2];

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.confidence).toBe(0.3);
      expect(decision.confidenceLevel).toBe('low');
    });

    test('maps display index back to original via mapping', () => {
      const text = '<best>1</best>\n<confidence>high</confidence>';
      const indexMapping = [2, 0, 1]; // Display index 0 → original index 2

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.selectedIndex).toBe(2);
    });

    test('defaults to medium when confidence not specified', () => {
      const text = '<best>1</best>';
      const indexMapping = [0];

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.confidence).toBe(0.5);
      expect(decision.confidenceLevel).toBe('medium');
    });

    test('clamps out-of-bounds index', () => {
      const text = '<best>99</best>\n<confidence>high</confidence>';
      const indexMapping = [0, 1, 2];

      const decision = XML_JUDGE_FORMAT.parse(text, indexMapping);

      expect(decision.selectedIndex).toBe(2); // Clamped to last index
    });
  });

  describe('JudgeFormat type compatibility', () => {
    test('custom format can be created', () => {
      const customFormat: JudgeFormat = {
        format: (candidates, indexMapping) => {
          return candidates.map((c, i) => `${i}: ${c}`).join('\n');
        },
        parse: (text, indexMapping) => {
          const parsed = parseInt(text.trim(), 10);
          const clamped = Math.min(parsed, indexMapping.length - 1);
          return {
            selectedIndex: indexMapping[clamped],
            confidence: 0.5,
            confidenceLevel: 'medium',
          };
        },
      };

      const formatted = customFormat.format(['A', 'B'], [0, 1]);
      expect(formatted).toContain('0: A');
      expect(formatted).toContain('1: B');

      const decision = customFormat.parse('1', [0, 1]);
      expect(decision.selectedIndex).toBe(1);
    });
  });
});
