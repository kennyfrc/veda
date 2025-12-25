import { describe, expect, test } from 'bun:test';
import {
  parseCheckResults,
  parseRevision,
  isUnchanged,
  type CheckVerdict,
} from '../../src/core/verify';
import { parseSlice, formatSlice, extractSlice } from '../../src/context/slice';
import { resolveBackendModel } from '../../src/agent/config';

describe('Boolean Blindness Fixes', () => {
  describe('CheckResult verdict preserves domain meaning', () => {
    test('supports verdict is distinct from contradicts', () => {
      const text = `
<results>
<result id="1">
<answer>Yes, it supports</answer>
<verdict>supports</verdict>
<confidence>high</confidence>
</result>
<result id="2">
<answer>No, it contradicts</answer>
<verdict>contradicts</verdict>
<confidence>medium</confidence>
</result>
</results>`;

      const checks = [{ id: '1', question: 'Q1' }, { id: '2', question: 'Q2' }];
      const results = parseCheckResults(text, checks);

      expect(results[0].verdict).toBe('supports');
      expect(results[0].checkId).toBe('1');
      expect(results[1].verdict).toBe('contradicts');
      expect(results[1].checkId).toBe('2');

      // Verify the verdict type explicitly
      const supports: CheckVerdict = 'supports';
      const contradicts: CheckVerdict = 'contradicts';
      const uncertain: CheckVerdict = 'uncertain';

      expect(supports !== contradicts).toBe(true);
      expect(contradicts !== uncertain).toBe(true);
      expect(supports !== uncertain).toBe(true);
    });

    test('low confidence supports is still supports verdict', () => {
      const text = `
<results>
<result id="1">
<answer>Weak support</answer>
<verdict>supports</verdict>
<confidence>low</confidence>
</result>
</results>`;

      const checks = [{ id: '1', question: 'Q1' }];
      const results = parseCheckResults(text, checks);

      // With boolean blindness, this would be reduced to:
      //   supports && high_confidence = true
      //   supports && low_confidence = false
      // Now we preserve the distinct verdicts
      expect(results[0].verdict).toBe('supports');
      expect(results[0].confidence).toBe(0.5); // low
    });

    test('uncertain verdict is distinct from supports at low confidence', () => {
      const text = `
<results>
<result id="1">
<answer>Not sure</answer>
<verdict>uncertain</verdict>
<confidence>low</confidence>
</result>
</results>`;

      const checks = [{ id: '1', question: 'Q1' }];
      const results = parseCheckResults(text, checks);

      // Explicit distinct state
      expect(results[0].verdict).toBe('uncertain');
      expect(results[0].confidence).toBe(0.5);
    });
  });

  describe('Revision unchanged is derived, not stored', () => {
    test('isUnchanged derives state from comparison', () => {
      const original = 'Original content';
      const unchangedRevision = parseRevision(original, '<revised>Original content</revised><changes></changes><conflicts>none</conflicts>');
      const changedRevision = parseRevision(original, '<revised>Revised content</revised><changes>Tweaked</changes><conflicts>none</conflicts>');

      // Derive state - not stored in boolean field
      expect(isUnchanged(unchangedRevision, original)).toBe(true);
      expect(isUnchanged(changedRevision, original)).toBe(false);

      // Verify the Revision interface doesn't have the 'unchanged' field
      expect('unchanged' in unchangedRevision).toBe(false);
      expect('unchanged' in changedRevision).toBe(false);
    });

    test('isUnchanged handles different originals correctly', () => {
      const originalDraft = 'Original content';
      const revisionText = '<revised>Original content</revised><changes></changes><conflicts>none</conflicts>';
      const revision = parseRevision(originalDraft, revisionText);

      // Same as original: unchanged
      expect(isUnchanged(revision, originalDraft)).toBe(true);

      // Different from original: changed
      expect(isUnchanged(revision, 'Different content')).toBe(false);
    });
  });

  describe('FileSlice sliceType captures all states explicitly', () => {
    test('sliceType distinguishes four distinct states', () => {
      const full = parseSlice('file.ts');
      const singleLine = parseSlice('file.ts:5');
      const range = parseSlice('file.ts:10-20');
      const infiniteRange = parseSlice('file.ts:15-');

      // All four have explicit type tags
      expect(full.sliceType).toBe('full');
      expect(singleLine.sliceType).toBe('single-line');
      expect(range.sliceType).toBe('range');
      expect(infiniteRange.sliceType).toBe('infinite-range');

      // No boolean field 'hasSlice'
      expect('hasSlice' in full).toBe(false);
      expect('hasSlice' in singleLine).toBe(false);

      // Format roundtrips correctly
      expect(formatSlice(full)).toBe('file.ts');
      expect(formatSlice(singleLine)).toBe('file.ts:5');
      expect(formatSlice(range)).toBe('file.ts:10-20');
      expect(formatSlice(infiniteRange)).toBe('file.ts:15-');
    });

    test('sliceType prevents impossible states', () => {
      const singleLine = parseSlice('file.ts:5');
      const range = parseSlice('file.ts:10-20');
      const infiniteRange = parseSlice('file.ts:15-');

      // single-line: only startLine defined
      expect(singleLine.startLine).toBe(5);
      expect(singleLine.endLine).toBeUndefined();

      // range: both startLine and endLine defined
      expect(range.startLine).toBe(10);
      expect(range.endLine).toBe(20);

      // infinite-range: only startLine defined
      expect(infiniteRange.startLine).toBe(15);
      expect(infiniteRange.endLine).toBeUndefined();
    });

    test('extractSlice uses sliceType correctly', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';

      const full = parseSlice('file.ts');
      const singleLine = parseSlice('file.ts:3');
      const range = parseSlice('file.ts:2-4');
      const infiniteRange = parseSlice('file.ts:3-');

      // Each slice type extracts correctly
      expect(extractSlice(content, full)).toBe(content);
      expect(extractSlice(content, singleLine)).toBe('line3');
      expect(extractSlice(content, range)).toBe('line2\nline3\nline4');
      expect(extractSlice(content, infiniteRange)).toBe('line3\nline4\nline5');
    });
  });

  describe('ModelSource captures resolution provenance', () => {
    test('ModelSource distinguishes resolution paths', () => {
      // Alias resolution
      const aliasResult = resolveBackendModel({
        explicitModel: 'opus',
        fallbackBackend: 'codex',
      });
      expect(aliasResult.source.kind).toBe('alias');
      if (aliasResult.source.kind === 'alias') {
        expect(aliasResult.source.aliasName).toBe('opus');
      }

      // Explicit resolution
      const explicitResult = resolveBackendModel({
        explicitBackend: 'codex',
        explicitModel: 'gpt-4o',
      });
      expect(explicitResult.source.kind).toBe('explicit');

      // Fallback resolution
      const fallbackResult = resolveBackendModel({
        fallbackBackend: 'claude-code',
        fallbackModel: 'haiku',
      });
      expect(fallbackResult.source.kind).toBe('fallback');

      // Default resolution
      const defaultResult = resolveBackendModel({
        fallbackBackend: 'claude-code',
      });
      expect(defaultResult.source.kind).toBe('default');
    });

    test('ModelSource preserves alias name (normalized)', () => {
      const aliasResult = resolveBackendModel({
        explicitModel: ' OPUS ', // with whitespace and uppercase
        fallbackBackend: 'codex',
      });

      expect(aliasResult.source.kind).toBe('alias');
      if (aliasResult.source.kind === 'alias') {
        // Alias name is normalized
        expect(aliasResult.source.aliasName).toBe('opus');
      }
      expect(aliasResult.backend).toBe('claude-code');
      expect(aliasResult.model).toBe('opus');
    });

    test('No boolean field "fromAlias" - replaced with rich ModelSource', () => {
      const result = resolveBackendModel({
        explicitModel: 'opus',
        fallbackBackend: 'codex',
      });

      // No boolean field
      expect('fromAlias' in result).toBe(false);

      // Rich source information
      expect('source' in result).toBe(true);
      expect(typeof result.source).toBe('object');
    });
  });
});
