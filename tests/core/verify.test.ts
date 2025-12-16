import { describe, it, expect } from 'bun:test';
import {
  formatGenerateChecksPrompt,
  formatAnswerChecksPrompt,
  formatRevisionPrompt,
  parseChecks,
  parseCheckResults,
  parseRevision,
} from '../../src/core/verify';

describe('verify', () => {
  describe('parseChecks', () => {
    it('parses valid XML checks', () => {
      const text = `
<checks>
<check id="1">
<question>Is the function pure?</question>
<claim>The function has no side effects</claim>
</check>
<check id="2">
<question>Does it handle null?</question>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(2);
      expect(checks[0].id).toBe('1');
      expect(checks[0].question).toBe('Is the function pure?');
      expect(checks[0].targetClaim).toBe('The function has no side effects');
      expect(checks[1].id).toBe('2');
      expect(checks[1].question).toBe('Does it handle null?');
      expect(checks[1].targetClaim).toBeUndefined();
    });

    it('returns empty array for invalid XML', () => {
      const text = 'No checks here';
      const checks = parseChecks(text);
      expect(checks).toHaveLength(0);
    });
  });

  describe('parseCheckResults', () => {
    it('parses verdict correctly', () => {
      const text = `
<results>
<result id="1">
<answer>Yes, it is pure</answer>
<verdict>supports</verdict>
<confidence>high</confidence>
</result>
<result id="2">
<answer>No, it throws on null</answer>
<verdict>contradicts</verdict>
<confidence>medium</confidence>
</result>
</results>`;
      
      const checks = [{ id: '1', question: 'Q1' }, { id: '2', question: 'Q2' }];
      const results = parseCheckResults(text, checks);
      
      expect(results).toHaveLength(2);
      expect(results[0].checkId).toBe('1');
      expect(results[0].contradictsDraft).toBe(false);
      expect(results[0].confidence).toBe(0.9); // high
      expect(results[1].checkId).toBe('2');
      expect(results[1].contradictsDraft).toBe(true);
      expect(results[1].confidence).toBe(0.7); // medium
    });

    it('provides fallback for missing results', () => {
      const text = '<results></results>';
      const checks = [{ id: '1', question: 'Q1' }];
      const results = parseCheckResults(text, checks);
      
      expect(results).toHaveLength(1);
      expect(results[0].contradictsDraft).toBe(false);
      expect(results[0].confidence).toBe(0.5);
    });
  });

  describe('parseRevision', () => {
    it('parses revision result correctly', () => {
      const original = 'Original draft';
      const text = `
<revised>
Updated draft with fixes
</revised>

<changes>
- Fixed typo
- Added error handling
</changes>

<conflicts>
none
</conflicts>`;
      
      const revision = parseRevision(original, text);
      
      expect(revision.revised).toBe('Updated draft with fixes');
      expect(revision.changes).toEqual(['Fixed typo', 'Added error handling']);
      expect(revision.conflicts).toEqual([]);
      expect(revision.unchanged).toBe(false);
    });

    it('returns unchanged when revision matches original', () => {
      const original = 'Same content';
      const text = `<revised>Same content</revised><changes></changes><conflicts>none</conflicts>`;
      
      const revision = parseRevision(original, text);
      
      expect(revision.unchanged).toBe(true);
    });

    it('falls back to original when no revised tag', () => {
      const original = 'Original draft';
      const text = 'Some unstructured response';
      
      const revision = parseRevision(original, text);
      
      expect(revision.revised).toBe('Original draft');
      expect(revision.unchanged).toBe(true);
    });
  });

  describe('formatGenerateChecksPrompt', () => {
    it('includes original task when provided', () => {
      const prompt = formatGenerateChecksPrompt('reasoning', 'My draft', 'The task');
      expect(prompt).toContain('Original task: The task');
      expect(prompt).toContain('My draft');
    });

    it('adapts prompt for different verification types', () => {
      const factual = formatGenerateChecksPrompt('factual', 'Draft', 'Task');
      const code = formatGenerateChecksPrompt('code', 'Draft', 'Task');
      const reasoning = formatGenerateChecksPrompt('reasoning', 'Draft', 'Task');
      
      expect(factual).toContain('factual accuracy');
      expect(code).toContain('Correctness');
      expect(reasoning).toContain('Logical consistency');
    });
  });
});
