import { describe, it, expect } from 'bun:test';
import {
  formatGenerateChecksPrompt,
  formatAnswerChecksPrompt,
  formatRevisionPrompt,
  parseChecks,
  parseCheckResults,
  parseSingleCheckResult,
  parseRevision,
  isUnchanged,
  difficultyToReasoning,
} from '../../src/core/verify';
import { getFactoredAnswerCheckPrompt } from '../../src/pipelines/prompts/verifier';

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

    it('parses difficulty field', () => {
      const text = `
<checks>
<check id="1">
<question>Is the file exported?</question>
<claim>Function is exported</claim>
<difficulty>easy</difficulty>
</check>
<check id="2">
<question>Does the algorithm terminate?</question>
<claim>Recursion has base case</claim>
<difficulty>hard</difficulty>
</check>
<check id="3">
<question>Are types correct?</question>
<claim>Return type matches</claim>
<difficulty>moderate</difficulty>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(3);
      expect(checks[0].difficulty).toBe('easy');
      expect(checks[1].difficulty).toBe('hard');
      expect(checks[2].difficulty).toBe('moderate');
    });

    it('defaults to easy when difficulty missing or invalid', () => {
      const text = `
<checks>
<check id="1">
<question>Simple check</question>
<claim>Something</claim>
</check>
<check id="2">
<question>Another check</question>
<claim>Something else</claim>
<difficulty>invalid</difficulty>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(2);
      expect(checks[0].difficulty).toBe('easy');
      expect(checks[1].difficulty).toBe('easy');
    });

    it('parses claim and difficulty in any order', () => {
      const text = `
<checks>
<check id="1">
<question>First question</question>
<difficulty>hard</difficulty>
<claim>First claim</claim>
</check>
<check id="2">
<question>Second question</question>
<claim>Second claim</claim>
<difficulty>easy</difficulty>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(2);
      expect(checks[0].targetClaim).toBe('First claim');
      expect(checks[0].difficulty).toBe('hard');
      expect(checks[1].targetClaim).toBe('Second claim');
      expect(checks[1].difficulty).toBe('easy');
    });

    it('handles non-numeric IDs and extra attributes', () => {
      const text = `
<checks>
<check id="check-1" difficulty="easy">
<question>First question</question>
</check>
<check  id="abc123"  >
<question>Second question</question>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(2);
      expect(checks[0].id).toBe('check-1');
      expect(checks[1].id).toBe('abc123');
    });

    it('handles id attribute anywhere in opening tag', () => {
      const text = `
<checks>
<check difficulty="easy" id="1">
<question>ID after difficulty</question>
</check>
<check class="test" id="2" data-foo="bar">
<question>ID in middle of attributes</question>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(2);
      expect(checks[0].id).toBe('1');
      expect(checks[1].id).toBe('2');
    });

    it('supports single-quoted id attributes', () => {
      const text = `
<checks>
<check id='single-quoted'>
<question>Single quoted ID</question>
</check>
</checks>`;
      
      const checks = parseChecks(text);
      
      expect(checks).toHaveLength(1);
      expect(checks[0].id).toBe('single-quoted');
    });
  });

  describe('difficultyToReasoning', () => {
    it('maps difficulty to reasoning level', () => {
      expect(difficultyToReasoning('easy')).toBe('low');
      expect(difficultyToReasoning('moderate')).toBe('medium');
      expect(difficultyToReasoning('hard')).toBe('high');
    });

    it('defaults to low for undefined', () => {
      expect(difficultyToReasoning(undefined)).toBe('low');
    });
  });

  describe('parseSingleCheckResult', () => {
    it('parses a single result', () => {
      const text = `
<result id="1">
<answer>Yes, the function is exported from index.ts</answer>
<verdict>supports</verdict>
<confidence>high</confidence>
</result>`;
      
      const check = { id: '1', question: 'Is it exported?' };
      const result = parseSingleCheckResult(text, check);
      
      expect(result.checkId).toBe('1');
      expect(result.answer).toContain('exported from index.ts');
      expect(result.verdict).toBe('supports');
      expect(result.confidence).toBe(0.9);
    });

    it('returns uncertain fallback on parse failure', () => {
      const text = 'No valid result here';
      const check = { id: '1', question: 'Something' };
      const result = parseSingleCheckResult(text, check);
      
      expect(result.checkId).toBe('1');
      expect(result.verdict).toBe('uncertain');
      expect(result.confidence).toBe(0.5);
    });

    it('returns uncertain when result ID mismatches check ID', () => {
      const text = `
<result id="999">
<answer>Some answer</answer>
<verdict>supports</verdict>
<confidence>high</confidence>
</result>`;
      
      const check = { id: '1', question: 'Something' };
      const result = parseSingleCheckResult(text, check);
      
      expect(result.checkId).toBe('1');
      expect(result.verdict).toBe('uncertain');
      expect(result.answer).toContain('mismatch');
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
      expect(results[0].verdict).toBe('supports');
      expect(results[0].confidence).toBe(0.9); // high
      expect(results[1].checkId).toBe('2');
      expect(results[1].verdict).toBe('contradicts');
      expect(results[1].confidence).toBe(0.7); // medium
    });

    it('provides fallback for missing results', () => {
      const text = '<results></results>';
      const checks = [{ id: '1', question: 'Q1' }];
      const results = parseCheckResults(text, checks);
      
      expect(results).toHaveLength(1);
      expect(results[0].verdict).toBe('uncertain');
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
      expect(isUnchanged(revision, original)).toBe(false);
    });

    it('returns unchanged when revision matches original', () => {
      const original = 'Same content';
      const text = `<revised>Same content</revised><changes></changes><conflicts>none</conflicts>`;
      
      const revision = parseRevision(original, text);
      
      expect(isUnchanged(revision, original)).toBe(true);
    });

    it('falls back to original when no revised tag', () => {
      const original = 'Original draft';
      const text = 'Some unstructured response';
      
      const revision = parseRevision(original, text);
      
      expect(revision.revised).toBe('Original draft');
      expect(isUnchanged(revision, original)).toBe(true);
    });

    it('detects changed revision', () => {
      const original = 'Original draft';
      const text = `<revised>Revised draft</revised><changes>Tweaked</changes><conflicts>none</conflicts>`;
      
      const revision = parseRevision(original, text);
      
      expect(revision.revised).toBe('Revised draft');
      expect(isUnchanged(revision, original)).toBe(false);
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

    it('includes difficulty tag in format specification', () => {
      const prompt = formatGenerateChecksPrompt('code', 'Draft', 'Task');
      expect(prompt).toContain('<difficulty>');
      expect(prompt).toContain('easy');
      expect(prompt).toContain('moderate');
      expect(prompt).toContain('hard');
    });
  });

  describe('getFactoredAnswerCheckPrompt', () => {
    it('includes task context but not draft', () => {
      const check = { id: '1', question: 'Is function exported?', targetClaim: 'Exported from index.ts' };
      const prompt = getFactoredAnswerCheckPrompt(check, 'Build a verification system');
      
      expect(prompt).toContain('Build a verification system');
      expect(prompt).toContain('Is function exported?');
      expect(prompt).toContain('Exported from index.ts');
      expect(prompt).toContain('independently');
      expect(prompt).not.toContain('draft'); // should NOT reference any draft
    });

    it('handles missing claim', () => {
      const check = { id: '2', question: 'Does it compile?' };
      const prompt = getFactoredAnswerCheckPrompt(check, 'Task');
      
      expect(prompt).toContain('Does it compile?');
      expect(prompt).not.toContain('<claim>');
    });

    it('escapes XML special characters in question and claim', () => {
      const check = {
        id: '1',
        question: 'Does the regex handle <script> tags & special chars?',
        targetClaim: 'Pattern matches "</script>" correctly'
      };
      const prompt = getFactoredAnswerCheckPrompt(check, 'Task');
      
      // Should escape < > & "
      expect(prompt).toContain('&lt;script&gt;');
      expect(prompt).toContain('&amp;');
      expect(prompt).toContain('&lt;/script&gt;');
      // Should NOT contain unescaped versions that would break XML
      expect(prompt).not.toContain('<script>');
    });

    it('escapes XML special characters in originalTask', () => {
      const check = { id: '1', question: 'Simple question' };
      const prompt = getFactoredAnswerCheckPrompt(check, 'Handle <input> tags & "quotes"');
      
      // Task context should be escaped
      expect(prompt).toContain('&lt;input&gt;');
      expect(prompt).toContain('&amp;');
      expect(prompt).toContain('&quot;quotes&quot;');
    });

    it('does not escape check ID to avoid mismatch', () => {
      const check = { id: '1', question: 'Test' };
      const prompt = getFactoredAnswerCheckPrompt(check, 'Task');
      
      // ID should appear unescaped in both check and result format
      expect(prompt).toContain('<check id="1">');
      expect(prompt).toContain('<result id="1">');
    });
  });
});
