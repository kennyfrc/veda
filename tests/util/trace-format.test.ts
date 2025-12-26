import { describe, it, expect } from 'bun:test';
import {
  createFormatterState,
  accumulateTool,
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
      expect(state.solverTools.size).toBe(0);
      expect(state.candidateCount).toBe(0);
    });
  });

  describe('tool accumulation', () => {
    it('accumulates tools for a solver', () => {
      const state = createFormatterState();
      accumulateTool(state, 0, 'Grep');
      accumulateTool(state, 0, 'Read');
      expect(state.solverTools.get(0)).toEqual(['Grep', 'Read']);
    });

    it('accumulates tools for multiple solvers', () => {
      const state = createFormatterState();
      accumulateTool(state, 0, 'Grep');
      accumulateTool(state, 1, 'shell');
      accumulateTool(state, 0, 'Read');
      expect(state.solverTools.get(0)).toEqual(['Grep', 'Read']);
      expect(state.solverTools.get(1)).toEqual(['shell']);
    });
  });

  describe('formatSolverComplete', () => {
    it('collapses consecutive repeated tools', () => {
      const state = createFormatterState();
      accumulateTool(state, 0, 'Read');
      accumulateTool(state, 0, 'Read');
      accumulateTool(state, 0, 'Read');
      const output = formatSolverComplete(state, 0, 'empirical', 683);
      expect(output).toContain('Read × 3');
      expect(output).toContain('done');
      expect(output).toContain('683 out');
    });

    it('clears tools after completion', () => {
      const state = createFormatterState();
      accumulateTool(state, 0, 'Grep');
      formatSolverComplete(state, 0, 'empirical');
      expect(state.solverTools.has(0)).toBe(false);
    });

    it('handles empty tool list', () => {
      const state = createFormatterState();
      const output = formatSolverComplete(state, 0, 'analytical');
      expect(output).toContain('done');
      expect(output).not.toContain('→ →');
    });

    it('truncates long tool chains', () => {
      const state = createFormatterState();
      for (let i = 0; i < 10; i++) {
        accumulateTool(state, 0, `Tool${i}`);
      }
      const output = formatSolverComplete(state, 0, 'systematic');
      expect(output).toContain('[+');
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
  });

  describe('formatPhaseHeader', () => {
    it('includes phase name', () => {
      const result = formatPhaseHeader('solve');
      expect(result).toContain('solve');
      expect(result).toContain(FORMAT_CONFIG.symbols.phase);
    });

    it('includes suffix when provided', () => {
      const result = formatPhaseHeader('judge', 'gemini-3-flash');
      expect(result).toContain('judge');
      expect(result).toContain('gemini-3-flash');
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
