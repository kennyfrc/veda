/**
 * Minimal ANSI color utilities for terminal output.
 * 
 * Respects:
 * - NO_COLOR env (https://no-color.org/)
 * - TERM=dumb
 * - TTY detection on stderr (where progress goes)
 */

const enabled =
  process.stderr.isTTY &&
  !('NO_COLOR' in process.env) &&
  process.env.TERM !== 'dumb';

const codes = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
} as const;

/** Color helper — wraps text in ANSI codes if colors are enabled. */
export const c = {
  dim: (s: string) => (enabled ? `${codes.dim}${s}${codes.reset}` : s),
  cyan: (s: string) => (enabled ? `${codes.cyan}${s}${codes.reset}` : s),
  green: (s: string) => (enabled ? `${codes.green}${s}${codes.reset}` : s),
  yellow: (s: string) => (enabled ? `${codes.yellow}${s}${codes.reset}` : s),
  red: (s: string) => (enabled ? `${codes.red}${s}${codes.reset}` : s),
};
