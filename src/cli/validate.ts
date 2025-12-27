/**
 * CLI Validation - Check flag applicability and detect conflicts.
 */

import type { RawFlags, ParsedPositionals } from './types';
import { CliValidationError } from './types';

// =============================================================================
// Flag Applicability
// =============================================================================

/** Flags that only apply to deep mode */
const DEEP_ONLY_FLAGS = [
  'k',
  'categories',
  'modules',
  'noVerify',
  'forceVerify',
  'trace',
  'solverBackend',
  'solverModel',
  'judgeBackend',
  'judgeModel',
  'verifierBackend',
  'verifierModel',
  'distributeSolvers',
  'solverBackends',
] as const;

/** Human-readable flag names for error messages */
const FLAG_DISPLAY_NAMES: Record<string, string> = {
  k: '-k',
  categories: '--categories',
  modules: '--modules',
  noVerify: '--no-verify',
  forceVerify: '--force-verify',
  trace: '--trace',
  solverBackend: '--solver-backend',
  solverModel: '--solver-model',
  judgeBackend: '--judge-backend',
  judgeModel: '--judge-model',
  verifierBackend: '--verifier-backend',
  verifierModel: '--verifier-model',
  distributeSolvers: '--distribute-solvers',
  solverBackends: '--solver-backends',
  persona: '--persona',
  reasoning: '--reasoning',
  sandbox: '--sandbox',
};

/** Flags that only apply to simple prompt or resume (not deep) */
const SIMPLE_ONLY_FLAGS = [
  'persona',
  'reasoning',
  'sandbox',
] as const;

// =============================================================================
// Validate Applicability
// =============================================================================

export function validateApplicability(
  parsed: ParsedPositionals,
  flags: RawFlags
): void {
  const isDeepMode = parsed.command === 'prompt' && parsed.subcommand === 'deep';
  const isSimplePrompt = parsed.command === 'prompt' && parsed.subcommand !== 'deep';
  const isSel = parsed.command === 'sel';
  const isInit = parsed.command === 'init';
  const isPersonas = parsed.command === 'personas';
  
  // Check deep-only flags in non-deep modes
  if (!isDeepMode) {
    for (const flag of DEEP_ONLY_FLAGS) {
      if (hasFlag(flags, flag)) {
        const displayName = FLAG_DISPLAY_NAMES[flag] ?? `--${flag}`;
        throw new CliValidationError(
          `${displayName} requires deep mode`,
          'FLAG_NOT_APPLICABLE',
          'Add --deep or use "veda deep <prompt>"'
        );
      }
    }
  }
  
  // Check simple-only flags in deep mode
  if (isDeepMode) {
    for (const flag of SIMPLE_ONLY_FLAGS) {
      if (hasFlag(flags, flag)) {
        const displayName = FLAG_DISPLAY_NAMES[flag] ?? `--${flag}`;
        throw new CliValidationError(
          `${displayName} is not used in deep mode`,
          'FLAG_NOT_APPLICABLE',
          'Deep mode uses fixed reasoning/sandbox per stage'
        );
      }
    }
  }
  
  // Flags not applicable to sel/init/personas
  if (isSel || isInit || isPersonas) {
    const inapplicable = [
      'backend', 'model', 'persona', 'reasoning', 'sandbox',
      'files', 'output', 'deep', 'k', ...DEEP_ONLY_FLAGS
    ];
    for (const flag of inapplicable) {
      if (hasFlag(flags, flag)) {
        const displayName = FLAG_DISPLAY_NAMES[flag] ?? `--${flag}`;
        throw new CliValidationError(
          `${displayName} is not applicable to "${parsed.command}" command`,
          'FLAG_NOT_APPLICABLE'
        );
      }
    }
  }
  
  // Validate -k range (1-8)
  if (isDeepMode && flags.k !== undefined) {
    if (!Number.isInteger(flags.k) || flags.k < 1 || flags.k > 8) {
      throw new CliValidationError(
        `-k must be an integer between 1 and 8, got ${flags.k}`,
        'INVALID_K_VALUE'
      );
    }
  }
  
  // Check for missing prompt
  if ((isSimplePrompt || isDeepMode) && !parsed.prompt) {
    throw new CliValidationError(
      'No prompt provided',
      'MISSING_PROMPT',
      'Provide a prompt after the command or flags'
    );
  }
}

function hasFlag(flags: RawFlags, key: string): boolean {
  const value = (flags as unknown as Record<string, unknown>)[key];
  if (value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// =============================================================================
// Detect Conflicts
// =============================================================================

export function detectConflicts(flags: RawFlags): void {
  // --no-verify vs --force-verify
  if (flags.noVerify && flags.forceVerify) {
    throw new CliValidationError(
      'Cannot use --no-verify and --force-verify together',
      'MUTUALLY_EXCLUSIVE_FLAGS'
    );
  }
  
  // --solver-backend vs --distribute-solvers
  if (flags.solverBackend && flags.distributeSolvers) {
    throw new CliValidationError(
      'Cannot use --solver-backend and --distribute-solvers together',
      'MUTUALLY_EXCLUSIVE_FLAGS',
      'Use --solver-backends to specify backends for distribution'
    );
  }
  
  // --notify vs --no-notify (last one wins, but flag both if explicit)
  // This is actually fine - we'll use the last value. No conflict.
}
