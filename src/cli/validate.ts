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
  'solverReasoning',
  'judgeReasoning',
  'verifierReasoning',
  'revisionReasoning',
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
  revisionBackend: '--revision-backend',
  revisionModel: '--revision-model',
  solverReasoning: '--solver-reasoning',
  judgeReasoning: '--judge-reasoning',
  verifierReasoning: '--verifier-reasoning',
  revisionReasoning: '--revision-reasoning',
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
  flags: RawFlags,
  positionals: string[] = []
): void {
  const isDeepMode = parsed.command === 'prompt' && parsed.subcommand === 'deep';
  const isSimplePrompt = parsed.command === 'prompt' && parsed.subcommand !== 'deep';
  const isImplicitPrompt = isSimplePrompt && !flags.deep;
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
        const hint = flag === 'reasoning'
          ? 'Use --solver-reasoning, --judge-reasoning, --verifier-reasoning, --revision-reasoning instead'
          : 'Deep mode uses fixed sandbox per stage';
        throw new CliValidationError(
          `${displayName} is not used in deep mode`,
          'FLAG_NOT_APPLICABLE',
          hint
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
  
  // Check for ambiguous prompt (2+ positionals where prompt is expected)
  // This must come before the missing prompt check to give a more specific error
  const isResume = parsed.command === 'resume';
  
  // For implicit prompt: positionals.length >= 2 means ambiguous
  // For deep/resume: positionals after the command word, so >= 2 means the prompt part has 2+ words
  if (isImplicitPrompt && positionals.length >= 2) {
    throw new CliValidationError(
      'Ambiguous prompt: multiple positional arguments',
      'AMBIGUOUS_PROMPT',
      'Did you mean to quote your prompt? Use: veda "your prompt here"'
    );
  }
  
  // For 'deep' command: check if there are 2+ positionals after 'deep'
  if (isDeepMode && positionals.length >= 1 && positionals[0] === 'deep' && positionals.length >= 3) {
    throw new CliValidationError(
      'Ambiguous prompt: multiple positional arguments',
      'AMBIGUOUS_PROMPT',
      'Did you mean to quote your prompt? Use: veda deep "your prompt here"'
    );
  }
  
  // For 'resume' command: check if there are 2+ positionals after 'resume'
  if (isResume && positionals.length >= 1 && positionals[0] === 'resume' && positionals.length >= 3) {
    throw new CliValidationError(
      'Ambiguous prompt: multiple positional arguments',
      'AMBIGUOUS_PROMPT',
      'Did you mean to quote your prompt? Use: veda resume "your prompt here"'
    );
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
  
  // --solver-backends requires --distribute-solvers
  if (flags.solverBackends && flags.solverBackends.length > 0 && !flags.distributeSolvers) {
    throw new CliValidationError(
      '--solver-backends requires --distribute-solvers',
      'FLAG_NOT_APPLICABLE',
      'Add --distribute-solvers to enable round-robin backend distribution'
    );
  }
  
  // --notify vs --no-notify (last one wins, but flag both if explicit)
  // This is actually fine - we'll use the last value. No conflict.
}

// =============================================================================
// Config-Aware Conflicts
// =============================================================================

/**
 * Detect conflicts between CLI flags and config file settings.
 * Called after config is loaded.
 */
export function detectConfigConflicts(
  flags: RawFlags,
  globalConfig?: { deep?: { distributeSolvers?: boolean } }
): void {
  // --solver-backend conflicts with distributeSolvers from config
  // (unless user explicitly disables it with --distribute-solvers=false, but we don't support that syntax)
  // If user didn't pass --distribute-solvers flag, but config enables it, warn about --solver-backend
  // 
  // EXCEPTION: When -b or -m is passed, config-driven distribution is suppressed,
  // so --solver-backend is valid in that case.
  const basePinned = flags.backend !== undefined || flags.model !== undefined;
  
  if (
    flags.solverBackend &&
    flags.distributeSolvers === undefined &&
    globalConfig?.deep?.distributeSolvers &&
    !basePinned  // Don't error if base is pinned (distribution will be suppressed)
  ) {
    throw new CliValidationError(
      '--solver-backend is ignored when distributeSolvers is enabled in config',
      'MUTUALLY_EXCLUSIVE_FLAGS',
      'Use --solver-backends to override distributed backends, or remove distributeSolvers from config'
    );
  }
}
