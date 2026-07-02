/**
 * Trace formatting utilities for deep-think output.
 * 
 * Provides progressive disclosure format:
 * - Phase markers with dotted separators
 * - Streamed tool events per solver with backend/model info
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

export type PhaseState = 'solve' | 'judge' | 'verify' | 'revise' | 'complete' | null;

export interface FormatterState {
  phase: PhaseState;
  candidateCount: number;
  /** Judge mode for multi-judge display */
  judgeMode?: 'single' | 'multi' | 'pairwise';
  /** List of judge backends (for multi-judge, determines which judges evaluated each candidate) */
  judgeBackends?: string[];
}

export function createFormatterState(): FormatterState {
  return {
    phase: null,
    candidateCount: 0,
    judgeMode: undefined,
    judgeBackends: undefined,
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
// Solver Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a solver tool event for streaming display.
 * Example: "[solver-1:codex:gpt-5.2:analytical] → shell: rg -n "test""
 * Note: solverIndex is 0-based internally, but displayed as 1-based for user clarity.
 */
export function formatSolverToolEvent(
  solverIndex: number,
  backend: string,
  model: string,
  module: string,
  toolName: string,
  toolInput?: unknown
): string {
  const { symbols } = FORMAT_CONFIG;
  const toolContent = formatToolStart(toolName, toolInput);
  const safeModule = module?.trim() ? module : 'unknown';
  return c.dim(`  [solver-${solverIndex + 1}:${backend}:${model}:${safeModule}] ${symbols.arrow} ${toolContent}`);
}

/**
 * Format solver completion summary.
 * Example: "[solver-1:codex:gpt-5.2:analytical] → done (683 out)"
 * Note: solverIndex is 0-based internally, but displayed as 1-based for user clarity.
 */
export function formatSolverComplete(
  solverIndex: number,
  backend: string,
  model: string,
  module: string,
  outputTokens?: number
): string {
  const { symbols } = FORMAT_CONFIG;
  const tokenSuffix = outputTokens !== undefined ? ` (${outputTokens} out)` : '';
  const safeModule = module?.trim() ? module : 'unknown';
  return c.dim(`  [solver-${solverIndex + 1}:${backend}:${model}:${safeModule}] ${symbols.arrow} done${tokenSuffix}`);
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
  solverInfo?: string,
  width: number = FORMAT_CONFIG.lineWidth
): string {
  const { symbols } = FORMAT_CONFIG;
  const prefix = solverInfo ? `#${index + 1} ${solverInfo} ` : `#${index + 1} `;
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
 * Format judge reasoning (not truncated - full reasoning displayed).
 * Example: "  reason: Candidate 3 provides complete list with correct ordering"
 */
export function formatJudgeReasoning(reasoning: string): string {
  return c.dim(`  reason: ${reasoning}`);
}

/**
 * Format judge consensus analysis.
 */
export function formatConsensusAnalysis(analysis: string): string {
  return c.dim(`  consensus: ${analysis}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Chat Formatting (single-agent sessions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a chat session header.
 * Example: "▸ navigator-chat (claude-code/opus) ───────────────────────────────"
 */
export function formatChatHeader(
  persona: string | undefined,
  backend: string,
  model: string | undefined,
  width: number = FORMAT_CONFIG.lineWidth
): string {
  const { symbols } = FORMAT_CONFIG;
  
  // Build the identifier: "persona (backend/model)" or "backend/model" or just "backend"
  let identifier: string;
  if (persona && model) {
    identifier = `${persona} (${backend}/${model})`;
  } else if (persona) {
    identifier = `${persona} (${backend})`;
  } else if (model) {
    // Strip redundant backend prefix from model display (e.g. jdc/wafer/glm-5.1 → wafer/glm-5.1)
    const displayModel = model.startsWith(`${backend}/`) ? model.slice(backend.length + 1) : model;
    identifier = `${backend}/${displayModel}`;
  } else {
    identifier = backend;
  }
  
  const prefix = `${symbols.phase} ${identifier}`;
  const dashes = Math.max(0, width - prefix.length - 1);
  return c.cyan(`${prefix} ${symbols.separator.repeat(dashes)}`);
}

/**
 * Format a chat tool event for display.
 * Example: "  → Read src/util/index.ts"
 * Example: "  → shell: rg -n "export"···[+12]"
 */
export function formatChatToolEvent(toolName: string, toolInput?: unknown): string {
  const { symbols } = FORMAT_CONFIG;
  const formatted = formatToolStart(toolName, toolInput);
  return c.dim(`  ${symbols.arrow} ${formatted}`);
}

/**
 * Format chat completion summary.
 * Example: "  ✓ complete (1.2K in, 450 out)"
 */
export function formatChatComplete(inputTokens?: number, outputTokens?: number): string {
  const { symbols } = FORMAT_CONFIG;
  if (inputTokens !== undefined && outputTokens !== undefined) {
    return c.dim(`  ${symbols.done} complete (${formatUsageCompact(inputTokens, outputTokens)})`);
  }
  return c.dim(`  ${symbols.done} complete`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace Parsing Guide
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a parsing guide for the trace YAML file.
 * Shows yq commands to extract the final answer.
 * 
 * Example output:
 *   [trace] Parsing guide → trace.yaml
 *     yq '.final.answer' trace.yaml                         # always the final answer
 *     yq '.run.was_revised' trace.yaml                      # true if revised
 *     yq '.verify.revision.revised' trace.yaml              # revised text (if was_revised)
 *     idx=$(yq '.judge.selected_index' trace.yaml)          # winning candidate index
 *     yq ".solve.candidates[$idx].response" trace.yaml      # winning candidate (if not revised)
 */
export function formatTraceParsingGuide(tracePath: string): string {
  const p = tracePath;
  const lines = [
    c.dim(`[trace] Parsing guide ${FORMAT_CONFIG.symbols.arrow} ${p}`),
    c.dim(`  yq '.final.answer' ${p}                         # always the final answer`),
    c.dim(`  yq '.run.was_revised' ${p}                      # true if revised`),
    c.dim(`  yq '.verify.revision.revised' ${p}              # revised text (if was_revised)`),
    c.dim(`  idx=$(yq '.judge.selected_index' ${p})          # winning candidate index`),
    c.dim(`  yq ".solve.candidates[$idx].response" ${p}      # winning candidate (if not revised)`),
  ];
  return lines.join('\n');
}
