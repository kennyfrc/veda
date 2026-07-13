import { describe, it, expect } from 'bun:test';
import {
  createFormatterState,
  formatSolverToolEvent,
  formatSolverComplete,
  truncateWithCount,
  formatToolStart,
  formatPhaseHeader,
  formatCandidateSeparator,
  formatSelection,
  formatJudgeReasoning,
  formatCompletionStatus,
  humanizeTokens,
  formatUsageCompact,
  formatChatHeader,
  formatChatToolEvent,
  formatChatComplete,
  FORMAT_CONFIG,
} from '../../src/util/trace-format';

describe('trace-format', () => {
  describe('createFormatterState', () => {
    it('creates initial state', () => {
      const state = createFormatterState();
      expect(state.phase).toBe(null);
      expect(state.candidateCount).toBe(0);
    });
  });

  describe('formatSolverToolEvent', () => {
    it('formats solver tool event with backend and model', () => {
      const result = formatSolverToolEvent(0, 'codex', 'gpt-5.2', 'analytical', 'Grep');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('[solver-1:codex:gpt-5.2:analytical]');
      expect(stripped).toContain('→ Grep');
    });

    it('formats shell commands with truncation', () => {
      const result = formatSolverToolEvent(1, 'claude', 'opus', 'empirical', 'shell', { command: 'rg -n "test" src' });
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('[solver-2:claude:opus:empirical]');
      expect(stripped).toContain('shell: rg');
    });

    it('includes full model string without truncation', () => {
      const result = formatSolverToolEvent(2, 'droid', 'glm-5.2', 'creative', 'Read');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('[solver-3:droid:glm-5.2:creative]');
    });
  });

  describe('formatSolverComplete', () => {
    it('formats completion with backend and model', () => {
      const output = formatSolverComplete(0, 'codex', 'gpt-5.2', 'empirical', 683);
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('[solver-1:codex:gpt-5.2:empirical]');
      expect(stripped).toContain('done');
      expect(stripped).toContain('683 out');
    });

    it('handles missing token count', () => {
      const output = formatSolverComplete(1, 'claude', 'opus', 'analytical');
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('[solver-2:claude:opus:analytical]');
      expect(stripped).toContain('done');
      expect(stripped).not.toContain('out');
    });

    it('shows simple completion line without tool chain', () => {
      const output = formatSolverComplete(0, 'codex', 'gpt-5.2', 'systematic', 500);
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      // Should NOT contain tool chain artifacts
      expect(stripped).not.toContain('→ →');
      expect(stripped).not.toContain('×');
      // Should contain the expected format
      expect(stripped).toBe('  [solver-1:codex:gpt-5.2:systematic] → done (500 out)');
    });
  });

  describe('truncateWithCount', () => {
    it('does not truncate short text', () => {
      expect(truncateWithCount('short', 60)).toBe('short');
    });

    it('truncates long text with char count', () => {
      const long = 'a'.repeat(100);
      const result = truncateWithCount(long, 50);
      expect(result).toContain('···');
      expect(result).toContain('[+');
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it('uses Unicode ellipsis', () => {
      const result = truncateWithCount('a'.repeat(100), 50);
      expect(result).toContain(FORMAT_CONFIG.symbols.ellipsis);
    });
  });

  describe('formatToolStart', () => {
    it('formats shell commands with truncation', () => {
      const result = formatToolStart('shell', { command: 'rg -n "SolverId" src' });
      expect(result).toContain('shell:');
      expect(result).toContain('rg');
    });

    it('truncates long shell commands', () => {
      const longCmd = 'rg -n "SolverId|solverIds|solver_ids" src tests --type ts --glob "*.ts" | head -100';
      const result = formatToolStart('shell', { command: longCmd }, 40);
      expect(result).toContain('···');
    });

    it('handles file_change tool', () => {
      expect(formatToolStart('file_change')).toBe('file change');
    });

    it('handles mcp tools', () => {
      expect(formatToolStart('mcp:github')).toBe('mcp:github');
    });

    it('returns tool name for unknown tools', () => {
      expect(formatToolStart('Grep')).toBe('Grep');
    });

    it('formats bash commands with truncation (jdc uses bash, droid uses shell)', () => {
      const result = formatToolStart('bash', { command: 'rg -n "test" src/' });
      expect(result).toContain('bash:');
      expect(result).toContain('rg');
    });

    it('truncates long bash commands', () => {
      const longCmd = 'rg -n "SolverId|solverIds|solver_ids" src tests --type ts --glob "*.ts" | head -100';
      const result = formatToolStart('bash', { command: longCmd }, 40);
      expect(result).toContain('···');
    });
  });

  describe('formatPhaseHeader', () => {
    it('includes phase name', () => {
      const result = formatPhaseHeader('solve');
      expect(result).toContain('solve');
      expect(result).toContain(FORMAT_CONFIG.symbols.phase);
    });

    it('includes suffix when provided', () => {
      const result = formatPhaseHeader('judge', 'glm-5.2');
      expect(result).toContain('judge');
      expect(result).toContain('glm-5.2');
    });

    it('fills to specified width', () => {
      // Strip ANSI codes for length check
      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
      const result = formatPhaseHeader('solve', undefined, 80);
      expect(stripAnsi(result).length).toBe(80);
    });
  });

  describe('formatCandidateSeparator', () => {
    it('uses 1-based numbering', () => {
      expect(formatCandidateSeparator(0)).toContain('#1');
      expect(formatCandidateSeparator(2)).toContain('#3');
    });
  });

  describe('formatSelection', () => {
    it('formats selection with confidence percentage', () => {
      const result = formatSelection(2, 0.90);
      expect(result).toContain('#3');
      expect(result).toContain('90%');
    });
  });

  describe('formatJudgeReasoning', () => {
    it('formats reasoning with prefix', () => {
      const result = formatJudgeReasoning('Candidate 3 provides complete list with correct ordering');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('reason:');
      expect(stripped).toContain('Candidate 3 provides complete list');
    });

    it('does not truncate long reasoning', () => {
      const longReasoning = 'A'.repeat(500);
      const result = formatJudgeReasoning(longReasoning);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('A'.repeat(500));
      expect(stripped).not.toContain('···');
    });
  });

  describe('formatCompletionStatus', () => {
    it('includes all stages', () => {
      const result = formatCompletionStatus(['solve', 'judge', 'verify'], 0.85, true);
      expect(result).toContain('solve');
      expect(result).toContain('judge');
      expect(result).toContain('verify');
    });

    it('shows revised flag when true', () => {
      const result = formatCompletionStatus(['solve', 'judge'], 0.90, true);
      expect(result).toContain('revised');
    });

    it('omits revised flag when false', () => {
      const result = formatCompletionStatus(['solve', 'judge'], 0.90, false);
      expect(result).not.toContain('revised');
    });
  });

  describe('humanizeTokens', () => {
    it('returns raw number for small counts', () => {
      expect(humanizeTokens(999)).toBe('999');
      expect(humanizeTokens(500)).toBe('500');
    });

    it('uses K suffix for thousands', () => {
      expect(humanizeTokens(1000)).toBe('1K');
      expect(humanizeTokens(5000)).toBe('5K');
      expect(humanizeTokens(236236)).toBe('236K');
    });

    it('uses M suffix for millions', () => {
      expect(humanizeTokens(1000000)).toBe('1M');
      expect(humanizeTokens(1500000)).toBe('1.5M');
      expect(humanizeTokens(2000000)).toBe('2M');
    });
  });

  describe('formatUsageCompact', () => {
    it('formats input and output tokens', () => {
      const result = formatUsageCompact(236236, 5417);
      expect(result).toBe('236K in, 5K out');
    });

    it('handles small numbers', () => {
      const result = formatUsageCompact(95, 683);
      expect(result).toBe('95 in, 683 out');
    });
  });

  describe('formatChatHeader', () => {
    it('formats with persona, backend, and model', () => {
      const result = formatChatHeader('navigator-chat', 'claude-code', 'opus');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('▸ navigator-chat (claude-code/opus)');
      expect(stripped).toContain('─');
    });

    it('formats with persona and backend only', () => {
      const result = formatChatHeader('navigator-chat', 'codex', undefined);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('▸ navigator-chat (codex)');
    });

    it('formats with backend and model only', () => {
      const result = formatChatHeader(undefined, 'claude-code', 'opus');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('▸ claude-code/opus');
    });

    it('formats with backend only', () => {
      const result = formatChatHeader(undefined, 'codex', undefined);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('▸ codex');
    });

    it('strips redundant backend prefix from model display', () => {
      const result = formatChatHeader(undefined, 'jdc', 'jdc/wafer/glm-5.1');
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('▸ jdc/wafer/glm-5.1');
      expect(stripped).not.toContain('jdc/jdc/');
    });

    it('respects line width', () => {
      const result = formatChatHeader('test', 'backend', 'model', 80);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped.length).toBe(80);
    });
  });

  describe('formatChatToolEvent', () => {
    it('formats simple tool names', () => {
      const result = formatChatToolEvent('Read', undefined);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('→ Read');
    });

    it('formats shell commands with truncation', () => {
      const result = formatChatToolEvent('shell', { command: 'rg -n "export" src/util/index.ts' });
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('→ shell:');
      expect(stripped).toContain('rg');
    });

    it('truncates long shell commands', () => {
      const longCmd = 'rg -n "SolverId|solverIds|solver_ids|SOLVER_IDS" src tests lib --type ts --glob "*.ts" | head -100';
      const result = formatChatToolEvent('shell', { command: longCmd });
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('···');
      expect(stripped).toMatch(/\[\+\d+\]/);
    });
  });

  describe('formatChatComplete', () => {
    it('formats with usage stats', () => {
      const result = formatChatComplete(1200, 450);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('✓ complete');
      expect(stripped).toContain('1K in');
      expect(stripped).toContain('450 out');
    });

    it('handles missing usage stats', () => {
      const result = formatChatComplete(undefined, undefined);
      const stripped = result.replace(/\x1b\[[0-9;]*m/g, '');
      expect(stripped).toContain('✓ complete');
      expect(stripped).not.toContain('in');
    });
  });
});
