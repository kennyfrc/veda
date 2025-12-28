import { describe, expect, test } from 'bun:test';
import {
  createFormatterState,
  formatPhaseHeader,
  formatPhaseSummary,
  formatSolverToolEvent,
  formatSolverComplete,
  formatToolStart,
  formatCandidateSeparator,
  formatCandidateContent,
  formatSelection,
  formatRevision,
  formatStageUsage,
  formatFinalSeparator,
  formatCompletionStatus,
  formatFinalTokens,
  FORMAT_CONFIG,
  type FormatterState,
} from '../../src/util/trace-format';

/**
 * E2E test for trace formatting.
 * Simulates the full event flow and verifies the output matches the streaming design.
 */
describe('trace-format e2e', () => {
  // Helper to strip ANSI codes for assertions
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  test('full pipeline output matches streaming design', () => {
    const state = createFormatterState();
    const output: string[] = [];

    // Simulate: [deep] Starting...
    output.push('[deep] Starting deep thinking mode...');
    output.push('[deep] Distributed solver backends (round-robin): claude, codex');
    output.push('');

    // SOLVE phase - stage_start
    output.push(formatPhaseHeader('solve'));

    // Simulate streaming tool_start events for solver 0
    output.push(formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'empirical', 'Grep'));
    output.push(formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'empirical', 'Read'));
    output.push(formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'empirical', 'Read'));

    // Simulate streaming tool_start events for solver 1
    output.push(formatSolverToolEvent(1, 'claude', 'opus', 'contextual', 'shell', { command: 'rg -n "test"' }));
    output.push(formatSolverToolEvent(1, 'claude', 'opus', 'contextual', 'shell', { command: 'ls -la' }));
    output.push(formatSolverToolEvent(1, 'claude', 'opus', 'contextual', 'shell', { command: 'cat file.ts' }));

    // Simulate streaming tool_start events for solver 2
    output.push(formatSolverToolEvent(2, 'gemini-cli', 'gemini-2.5-flash', 'analytical', 'Grep'));
    output.push(formatSolverToolEvent(2, 'gemini-cli', 'gemini-2.5-flash', 'analytical', 'Glob'));
    output.push(formatSolverToolEvent(2, 'gemini-cli', 'gemini-2.5-flash', 'analytical', 'Read'));

    // solver_complete events (just summary, no tool chain)
    output.push(formatSolverComplete(0, 'codex', 'gpt-5.2', 'empirical', 723));
    output.push(formatSolverComplete(1, 'claude', 'opus', 'contextual', 941));
    output.push(formatSolverComplete(2, 'gemini-cli', 'gemini-2.5-flash', 'analytical', 713));

    // ensemble_complete
    output.push(formatPhaseSummary('ensemble complete'));

    // JUDGE phase header (emitted on ensemble_complete)
    output.push('');
    output.push(formatPhaseHeader('judge', 'gemini-3-flash-preview'));
    state.phase = 'judge';

    // candidate events
    output.push(formatCandidateSeparator(0));
    output.push(formatCandidateContent('<understanding>I need to find and list all solver IDs defined in this codebase.</understanding>'));

    output.push(formatCandidateSeparator(1));
    output.push(formatCandidateContent('I will scan the codebase for the Solver definition.'));

    output.push(formatCandidateSeparator(2));
    output.push(formatCandidateContent('<understanding>I need to find solver IDs.</understanding><solution>Here are all 32 solver IDs in order: 1. critical_thinking 2. assumption_analysis...'));

    // selected event
    output.push(formatSelection(2, 0.90));

    // stage_complete (solve/judge)
    output.push(formatStageUsage(236236, 5417));

    // VERIFY phase - stage_start
    output.push('');
    output.push(formatPhaseHeader('verify', 'gpt-5.2'));
    state.phase = 'verify';

    // tool_start events for verifier (shown inline)
    output.push(formatToolStart('shell', { command: 'rg -n "SolverId|solverIds|solver_ids" src tests' }));
    output.push(formatToolStart('shell', { command: 'bun test' }));

    // verified event
    output.push(formatRevision('Clarified that the 32-item list is the default catalog, Added non-default IDs, Noted normalizeId behavior'));

    // stage_complete (verify)
    output.push(formatPhaseSummary('complete'));

    // complete event
    output.push('');
    output.push(formatFinalSeparator());
    output.push(formatCompletionStatus(['solve', 'judge', 'verify'], 0.90, true));
    output.push(formatFinalTokens(508748, 22538));

    const fullOutput = output.join('\n');
    const stripped = stripAnsi(fullOutput);

    // Verify phase headers
    expect(stripped).toContain('▸ solve ─');
    expect(stripped).toContain('▸ judge (gemini-3-flash-preview) ─');
    expect(stripped).toContain('▸ verify (gpt-5.2) ─');

    // Verify streaming solver tool events with backend:model:module
    expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical] → Grep');
    expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical] → Read');
    expect(stripped).toContain('[solver-2:claude:opus:contextual] → shell: rg -n "test"');
    expect(stripped).toContain('[solver-3:gemini-cli:gemini-2.5-flash:analytical] → Grep');

    // Verify solver completion format (no tool chain, just summary)
    expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical] → done (723 out)');
    expect(stripped).toContain('[solver-2:claude:opus:contextual] → done (941 out)');
    expect(stripped).toContain('[solver-3:gemini-cli:gemini-2.5-flash:analytical] → done (713 out)');

    // Verify candidate separators
    expect(stripped).toContain('#1 ─');
    expect(stripped).toContain('#2 ─');
    expect(stripped).toContain('#3 ─');

    // Verify selection
    expect(stripped).toContain('→ selected #3 (90%)');

    // Verify token formatting
    expect(stripped).toContain('✓ 236K in, 5K out');

    // Verify revision
    expect(stripped).toContain('✓ revised:');

    // Verify completion
    expect(stripped).toContain('═'.repeat(10)); // Double separator
    expect(stripped).toContain('✓ complete | solve → judge → verify | 90% confidence | revised');
    expect(stripped).toContain('Tokens: 509K in, 23K out');
  });

  test('solver tool events are independent (no accumulation)', () => {
    const output: string[] = [];

    // First solver streams tools
    output.push(formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'empirical', 'Grep'));
    output.push(formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'empirical', 'Read'));
    output.push(formatSolverComplete(0, 'codex', 'gpt-5.2', 'empirical', 500));

    // Second solver uses same index (simulating new session)
    output.push(formatSolverToolEvent(0, 'claude', 'opus', 'creative', 'Write'));
    output.push(formatSolverComplete(0, 'claude', 'opus', 'creative', 600));

    const stripped = stripAnsi(output.join('\n'));

    // Each completion should be independent
    expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical] → done (500 out)');
    expect(stripped).toContain('[solver-1:claude:opus:creative] → done (600 out)');
    
    // Tool events should show immediately
    expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical] → Grep');
    expect(stripped).toContain('[solver-1:claude:opus:creative] → Write');
  });

  test('truncates long shell commands with char count', () => {
    const longCmd = 'rg -n "SolverId|solverIds|solver_ids|SOLVER_IDS" src tests lib --type ts --glob "*.ts" | head -100';
    const output = formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'analytical', 'shell', { command: longCmd });

    expect(output).toContain('shell:');
    expect(output).toContain('···');
    expect(output).toMatch(/\[\+\d+\]/); // Contains [+N]
  });

  test('candidate content is truncated with char count', () => {
    const longContent = 'A'.repeat(300);
    const output = formatCandidateContent(longContent);

    expect(output.length).toBeLessThan(250);
    expect(output).toContain('···');
    expect(output).toMatch(/\[\+\d+\]/);
  });

  test('phase headers respect line width', () => {
    const header = formatPhaseHeader('solve', undefined, 80);
    const stripped = stripAnsi(header);

    expect(stripped.length).toBe(80);
    expect(stripped).toMatch(/^▸ solve ─+$/);
  });

  test('completion status omits revised when false', () => {
    const output = formatCompletionStatus(['solve', 'judge'], 0.85, false);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('85% confidence');
    expect(stripped).not.toContain('revised');
  });

  test('token humanization handles millions', () => {
    const output = formatFinalTokens(1500000, 50000);
    const stripped = stripAnsi(output);

    expect(stripped).toContain('1.5M in');
    expect(stripped).toContain('50K out');
  });

  test('symbols are used consistently', () => {
    const { symbols } = FORMAT_CONFIG;

    // Phase header uses phase symbol
    expect(stripAnsi(formatPhaseHeader('solve'))).toContain(symbols.phase);

    // Selection uses arrow
    expect(stripAnsi(formatSelection(0, 0.9))).toContain(symbols.arrow);

    // Summary uses done symbol
    expect(stripAnsi(formatPhaseSummary('complete'))).toContain(symbols.done);

    // Final separator uses double separator
    expect(stripAnsi(formatFinalSeparator())).toContain(symbols.doubleSeparator);
  });

  test('full model strings are preserved', () => {
    // Test with a long model name
    const output = formatSolverComplete(0, 'gemini-cli', 'gemini-2.5-flash-preview-05-20', 'analytical', 500);
    const stripped = stripAnsi(output);
    
    // Full model string should be preserved
    expect(stripped).toContain('gemini-2.5-flash-preview-05-20');
    expect(stripped).toContain('[solver-1:gemini-cli:gemini-2.5-flash-preview-05-20:analytical]');
    expect(stripped).not.toContain('···'); // No truncation on model name
  });
});
