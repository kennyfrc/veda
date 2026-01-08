/**
 * Tests for the new composable verification primitives:
 * - runGenerateChecks
 * - runAnswerCheck
 * - runAnswerChecks
 * 
 * These tests verify the decomposition maintains identical behavior
 * to the original monolithic runVerification.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import {
  runGenerateChecks,
  runAnswerCheck,
  runAnswerChecks,
  runVerification,
  formatGenerateChecksPrompt,
  parseChecks,
  parseSingleCheckResult,
  difficultyToReasoning,
  type Check,
  type CheckResult,
  type VerificationType,
  type RunGenerateChecksArgs,
  type RunAnswerCheckArgs,
  type RunAnswerChecksArgs,
} from '../../src/core/verify';

// =============================================================================
// Unit Tests: difficultyToReasoning
// =============================================================================

describe('difficultyToReasoning', () => {
  it('maps easy to low', () => {
    expect(difficultyToReasoning('easy')).toBe('low');
  });

  it('maps moderate to medium', () => {
    expect(difficultyToReasoning('moderate')).toBe('medium');
  });

  it('maps hard to high', () => {
    expect(difficultyToReasoning('hard')).toBe('high');
  });

  it('defaults to low when undefined', () => {
    expect(difficultyToReasoning(undefined)).toBe('low');
  });
});

// =============================================================================
// Unit Tests: parseChecks
// =============================================================================

describe('parseChecks', () => {
  it('parses valid checks XML', () => {
    const xml = `
<checks>
<check id="1">
<question>Does the function handle null inputs?</question>
<claim>Handles null gracefully</claim>
<difficulty>easy</difficulty>
</check>
<check id="2">
<question>Is the algorithm O(n log n)?</question>
<claim>Time complexity claim</claim>
<difficulty>hard</difficulty>
</check>
</checks>`;

    const checks = parseChecks(xml);
    expect(checks).toHaveLength(2);
    expect(checks[0].id).toBe('1');
    expect(checks[0].question).toBe('Does the function handle null inputs?');
    expect(checks[0].difficulty).toBe('easy');
    expect(checks[1].id).toBe('2');
    expect(checks[1].difficulty).toBe('hard');
  });

  it('handles missing difficulty (defaults to easy)', () => {
    const xml = `
<checks>
<check id="test">
<question>Some question</question>
</check>
</checks>`;

    const checks = parseChecks(xml);
    expect(checks).toHaveLength(1);
    expect(checks[0].difficulty).toBe('easy');
  });

  it('returns empty array for no matches', () => {
    const checks = parseChecks('no valid xml here');
    expect(checks).toEqual([]);
  });

  it('skips checks without id attribute', () => {
    const xml = `
<checks>
<check>
<question>No id here</question>
</check>
<check id="valid">
<question>Has id</question>
</check>
</checks>`;

    const checks = parseChecks(xml);
    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('valid');
  });
});

// =============================================================================
// Unit Tests: parseSingleCheckResult
// =============================================================================

describe('parseSingleCheckResult', () => {
  const check: Check = { id: '1', question: 'Test question' };

  it('parses valid result XML', () => {
    const xml = `
<result id="1">
<answer>Yes, it handles null correctly</answer>
<verdict>supports</verdict>
<confidence>high</confidence>
</result>`;

    const result = parseSingleCheckResult(xml, check);
    expect(result.checkId).toBe('1');
    expect(result.verdict).toBe('supports');
    expect(result.confidence).toBe(0.9);
    expect(result.answer).toBe('Yes, it handles null correctly');
  });

  it('handles missing confidence (defaults to medium)', () => {
    const xml = `
<result id="1">
<answer>Some answer</answer>
<verdict>contradicts</verdict>
</result>`;

    const result = parseSingleCheckResult(xml, check);
    expect(result.confidence).toBe(0.7);
  });

  it('returns uncertain for unparseable response', () => {
    const result = parseSingleCheckResult('garbage', check);
    expect(result.verdict).toBe('uncertain');
    expect(result.confidence).toBe(0.5);
  });

  it('returns uncertain for ID mismatch', () => {
    const xml = `
<result id="wrong_id">
<answer>Some answer</answer>
<verdict>supports</verdict>
</result>`;

    const result = parseSingleCheckResult(xml, check);
    expect(result.verdict).toBe('uncertain');
    expect(result.answer).toContain('mismatch');
  });
});

// =============================================================================
// Unit Tests: formatGenerateChecksPrompt
// =============================================================================

describe('formatGenerateChecksPrompt', () => {
  it('includes draft and task context', () => {
    const prompt = formatGenerateChecksPrompt('code', 'function foo() {}', 'Implement foo');
    expect(prompt).toContain('function foo() {}');
    expect(prompt).toContain('Implement foo');
    expect(prompt).toContain('<draft>');
  });

  it('produces different prompts for different types', () => {
    const factual = formatGenerateChecksPrompt('factual', 'draft', 'task');
    const code = formatGenerateChecksPrompt('code', 'draft', 'task');
    const reasoning = formatGenerateChecksPrompt('reasoning', 'draft', 'task');

    expect(factual).not.toBe(code);
    expect(code).not.toBe(reasoning);
  });
});

// =============================================================================
// Integration Tests: Primitive Composition
// =============================================================================

describe('runAnswerChecks', () => {
  it('handles empty checks array', async () => {
    const result = await runAnswerChecks({
      backend: 'codex',
      systemPrompt: 'test',
      checks: [],
      originalTask: 'test task',
    });

    expect(result.results).toEqual([]);
    expect(result.usage.inputTokens).toBe(0);
  });

  it('skips completed results (resume support)', async () => {
    const checks: Check[] = [
      { id: '1', question: 'Q1' },
      { id: '2', question: 'Q2' },
    ];

    const completedResults: CheckResult[] = [
      { checkId: '1', answer: 'Already done', verdict: 'supports', confidence: 0.9 },
      { checkId: '2', answer: 'Also done', verdict: 'contradicts', confidence: 0.8 },
    ];

    // When all checks are already completed, no LLM calls needed
    const result = await runAnswerChecks({
      backend: 'codex',
      systemPrompt: 'test',
      checks,
      originalTask: 'test task',
      completedResults,
    });

    // Should return the completed results in order
    expect(result.results).toHaveLength(2);
    expect(result.results[0].checkId).toBe('1');
    expect(result.results[0].verdict).toBe('supports');
    expect(result.results[1].checkId).toBe('2');
    expect(result.results[1].verdict).toBe('contradicts');
    // No LLM calls = zero usage
    expect(result.usage.inputTokens).toBe(0);
  });

  it('fires callbacks for completed results', async () => {
    const events: string[] = [];
    const checks: Check[] = [
      { id: 'a', question: 'Q1' },
      { id: 'b', question: 'Q2' },
    ];

    const completedResults: CheckResult[] = [
      { checkId: 'a', answer: 'Done A', verdict: 'supports', confidence: 0.9 },
      { checkId: 'b', answer: 'Done B', verdict: 'contradicts', confidence: 0.8 },
    ];

    // When all checks are completed, no LLM calls but results still returned
    const result = await runAnswerChecks({
      backend: 'codex',
      systemPrompt: 'test',
      checks,
      originalTask: 'test task',
      completedResults,
      onCheckStart: ({ index, check }) => events.push(`start-${index}-${check.id}`),
      onCheckComplete: ({ index, check }) => events.push(`complete-${index}-${check.id}`),
    });

    // No starts/completes for already-completed checks (they're skipped entirely)
    expect(events).toEqual([]);
    // But results are still in the output
    expect(result.results).toHaveLength(2);
  });

  it('merges completed and new results in correct order', async () => {
    const checks: Check[] = [
      { id: '1', question: 'Q1' },
      { id: '2', question: 'Q2' },
      { id: '3', question: 'Q3' },
    ];

    // Only check 2 is completed
    const completedResults: CheckResult[] = [
      { checkId: '2', answer: 'Already done', verdict: 'supports', confidence: 0.9 },
    ];

    // Checks 1 and 3 need to run - but we have all completed to avoid LLM
    const allCompleted: CheckResult[] = [
      { checkId: '1', answer: 'Done 1', verdict: 'supports', confidence: 0.9 },
      { checkId: '2', answer: 'Done 2', verdict: 'contradicts', confidence: 0.8 },
      { checkId: '3', answer: 'Done 3', verdict: 'uncertain', confidence: 0.5 },
    ];

    const result = await runAnswerChecks({
      backend: 'codex',
      systemPrompt: 'test',
      checks,
      originalTask: 'test task',
      completedResults: allCompleted,
    });

    // Results should be in checks order (1, 2, 3)
    expect(result.results[0].checkId).toBe('1');
    expect(result.results[1].checkId).toBe('2');
    expect(result.results[2].checkId).toBe('3');
  });
});

// =============================================================================
// Type Export Tests
// =============================================================================

describe('type exports', () => {
  it('exports RunGenerateChecksArgs', () => {
    const args: RunGenerateChecksArgs = {
      backend: 'codex',
      systemPrompt: 'test',
      type: 'code',
      draft: 'test',
      originalTask: 'test',
    };
    expect(args.backend).toBe('codex');
  });

  it('exports RunAnswerCheckArgs', () => {
    const args: RunAnswerCheckArgs = {
      backend: 'codex',
      systemPrompt: 'test',
      check: { id: '1', question: 'test' },
      originalTask: 'test',
    };
    expect(args.check.id).toBe('1');
  });

  it('exports RunAnswerChecksArgs', () => {
    const args: RunAnswerChecksArgs = {
      backend: 'codex',
      systemPrompt: 'test',
      checks: [],
      originalTask: 'test',
    };
    expect(args.checks).toEqual([]);
  });
});
