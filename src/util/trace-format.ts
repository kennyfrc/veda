/**
 * Trace formatting utilities for deep-think output.
 * 
 * Provides progressive disclosure format:
 * - Phase markers with dotted separators
 * - Collapsed tool chains per solver
 * - Smart truncation with char counts
 * - Humanized token counts
 */

import { c } from './colors';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const FORMAT_CONFIG = {
  lineWidth: 80,
  truncateAt: 60,
  maxToolsInChain: 6,
  symbols: {
    phase: '▸',
    done: '✓',
    arrow: '→',
    ellipsis: '···',
    separator: '─',
    doubleSeparator: '═',
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Formatter State
// ─────────────────────────────────────────────────────────────────────────────

export type PhaseState = 'solve' | 'judge' | 'verify' | 'complete' | null;

export interface FormatterState {
  phase: PhaseState;
  solverTools: Map<number, string[]>;  // index → tool names
  candidateCount: number;
}

export function createFormatterState(): FormatterState {
  return {
    phase: null,
    solverTools: new Map(),
    candidateCount: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a phase header with dotted separator.
 * Example: "▸ solve ···································"
 */
export function formatPhaseHeader(
  phase: string,
  suffix?: string,
  width: number = FORMAT_CONFIG.lineWidth
): string {
  const { symbols } = FORMAT_CONFIG;
  const prefix = `${symbols.phase} ${phase}`;
  const fullPrefix = suffix ? `${prefix} (${suffix})` : prefix;
  const dotsNeeded = Math.max(0, width - fullPrefix.length - 1);
  const dots = symbols.separator.repeat(dotsNeeded);
  return c.cyan(`${fullPrefix} ${dots}`);
}

/**
 * Format a phase completion summary.
 * Example: "✓ 6 candidates ready"
 */
export function formatPhaseSummary(message: string): string {
  return c.dim(`  ${FORMAT_CONFIG.symbols.done} ${message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Solver Tool Chain Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accumulate a tool for a solver. Call on each tool_start event.
 */
export function accumulateTool(
  state: FormatterState,
  solverIndex: number,
  toolName: string
): void {
  if (!state.solverTools.has(solverIndex)) {
    state.solverTools.set(solverIndex, []);
  }
  state.solverTools.get(solverIndex)!.push(toolName);
}

/**
 * Collapse consecutive repeated tools.
 * ['Read', 'Read', 'Read', 'Grep'] → ['Read × 3', 'Grep']
 */
function collapseConsecutive(tools: string[]): string[] {
  if (tools.length === 0) return [];
  
  const result: string[] = [];
  let current = tools[0];
  let count = 1;
  
  for (let i = 1; i < tools.length; i++) {
    if (tools[i] === current) {
      count++;
    } else {
      result.push(count > 1 ? `${current} × ${count}` : current);
      current = tools[i];
      count = 1;
    }
  }
  result.push(count > 1 ? `${current} × ${count}` : current);
  
  return result;
}

/**
 * Format a collapsed tool chain for solver completion.
 * Example: "[solver:0] empirical → Grep → Read × 2 → done (683 out)"
 */
export function formatSolverComplete(
  state: FormatterState,
  solverIndex: number,
  module: string,
  outputTokens?: number
): string {
  const { symbols, maxToolsInChain } = FORMAT_CONFIG;
  const tools = state.solverTools.get(solverIndex) ?? [];
  
  // Collapse consecutive repeats
  const collapsed = collapseConsecutive(tools);
  
  // Truncate if too many tools
  let toolChain: string;
  if (collapsed.length === 0) {
    toolChain = 'done';
  } else if (collapsed.length <= maxToolsInChain) {
    toolChain = collapsed.join(` ${symbols.arrow} `) + ` ${symbols.arrow} done`;
  } else {
    const shown = collapsed.slice(0, maxToolsInChain);
    const hidden = collapsed.length - maxToolsInChain;
    toolChain = shown.join(` ${symbols.arrow} `) + ` ${symbols.ellipsis}[+${hidden}] ${symbols.arrow} done`;
  }
  
  // Format tokens if available
  const tokenSuffix = outputTokens !== undefined ? ` (${outputTokens} out)` : '';
  
  // Clear the tools for this solver
  state.solverTools.delete(solverIndex);
  
  return c.dim(`  [solver:${solverIndex}] ${module} ${symbols.arrow} ${toolChain}${tokenSuffix}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Truncation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncate text with Unicode ellipsis and char count.
 * Example: "long text here···[+42]"
 */
export function truncateWithCount(
  text: string,
  maxLength: number = FORMAT_CONFIG.truncateAt
): string {
  if (text.length <= maxLength) return text;
  
  const { symbols } = FORMAT_CONFIG;
  // Reserve space for "···[+NNN]" suffix (worst case ~10 chars)
  const reservedSpace = 10;
  const visibleLength = Math.max(0, maxLength - reservedSpace);
  const hidden = text.length - visibleLength;
  
  return `${text.slice(0, visibleLength)}${symbols.ellipsis}[+${hidden}]`;
}

/**
 * Format a shell command with truncation.
 * Example: "→ shell: rg -n "SolverId···[+18]"
 */
export function formatToolStart(
  toolName: string,
  toolInput?: unknown,
  maxLength: number = FORMAT_CONFIG.truncateAt
): string {
  if (toolName === 'shell' && toolInput && typeof toolInput === 'object') {
    const input = toolInput as { command?: string };
    const cmd = input.command ?? '';
    return `shell: ${truncateWithCount(cmd, maxLength)}`;
  }
  
  if (toolName === 'file_change') {
    return 'file change';
  }
  
  if (toolName.startsWith('mcp:')) {
    return toolName;
  }
  
  return toolName;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a candidate separator.
 * Example: "#1 ─────────────────────────────────────────"
 */
export function formatCandidateSeparator(
  index: number,
  width: number = FORMAT_CONFIG.lineWidth
): string {
  const { symbols } = FORMAT_CONFIG;
  const prefix = `#${index + 1} `;
  const dashes = symbols.separator.repeat(Math.max(0, width - prefix.length - 2));
  return c.dim(`\n  ${prefix}${dashes}`);
}

/**
 * Format candidate content with truncation.
 */
export function formatCandidateContent(
  content: string,
  maxLength: number = 200
): string {
  const truncated = truncateWithCount(content, maxLength);
  // Normalize whitespace for single-line display
  const normalized = truncated.replace(/\s+/g, ' ').trim();
  return `  ${normalized}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Judge/Verify Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format judge selection result.
 * Example: "→ selected #3 (90%)"
 */
export function formatSelection(
  candidateIndex: number,
  confidence: number
): string {
  const { symbols } = FORMAT_CONFIG;
  const pct = (confidence * 100).toFixed(0);
  return c.cyan(`  ${symbols.arrow} selected #${candidateIndex + 1} (${pct}%)`);
}

/**
 * Format verification revision summary.
 * Example: "✓ revised: Clarified default catalog, added non-default IDs"
 */
export function formatRevision(changes: string): string {
  const { symbols } = FORMAT_CONFIG;
  return c.dim(`  ${symbols.done} revised: ${truncateWithCount(changes, 70)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Humanize token count with K/M suffix.
 * 941 → "941", 236236 → "236K", 1500000 → "1.5M"
 */
export function humanizeTokens(count: number): string {
  if (count >= 1_000_000) {
    const m = count / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${Math.round(count / 1000)}K`;
  }
  return String(count);
}

/**
 * Format usage stats in compact form.
 * Example: "236K in, 5K out"
 */
export function formatUsageCompact(inputTokens: number, outputTokens: number): string {
  return `${humanizeTokens(inputTokens)} in, ${humanizeTokens(outputTokens)} out`;
}

/**
 * Format stage usage summary.
 * Example: "✓ 236K in, 5K out"
 */
export function formatStageUsage(inputTokens: number, outputTokens: number): string {
  const { symbols } = FORMAT_CONFIG;
  return c.dim(`  ${symbols.done} ${formatUsageCompact(inputTokens, outputTokens)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Completion Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format the final separator line.
 * Example: "═══════════════════════════════════════════════════════"
 */
export function formatFinalSeparator(width: number = FORMAT_CONFIG.lineWidth): string {
  const { symbols } = FORMAT_CONFIG;
  return c.dim(symbols.doubleSeparator.repeat(width));
}

/**
 * Format the dense completion status line.
 * Example: "✓ complete | solve → judge → verify | 90% confidence | revised"
 */
export function formatCompletionStatus(
  stages: string[],
  confidence: number,
  wasRevised: boolean
): string {
  const { symbols } = FORMAT_CONFIG;
  const stageList = stages.join(` ${symbols.arrow} `);
  const pct = (confidence * 100).toFixed(0);
  const revised = wasRevised ? ' | revised' : '';
  return c.green(`${symbols.done} complete | ${stageList} | ${pct}% confidence${revised}`);
}

/**
 * Format the final token summary.
 * Example: "Tokens: 509K in, 22K out"
 */
export function formatFinalTokens(inputTokens: number, outputTokens: number): string {
  return `  Tokens: ${formatUsageCompact(inputTokens, outputTokens)}`;
}
