/**
 * CLI Parsing - Tokenize argv into raw flags and positionals.
 */

import type { RawFlags, ParsedPositionals } from './types';
import { CliValidationError } from './types';
import { DEFAULT_SESSION, isValidSessionId } from '../util/paths';

// =============================================================================
// Flag Definitions
// =============================================================================

const FLAGS_WITH_VALUES = new Set([
  '-S', '--session',
  '-p', '--persona',
  '-b', '--backend',
  '-m', '--model',
  '-r', '--reasoning',
  '--sandbox',
  '-o', '--output',
  '-f', '--files',
  '-k',
  '--categories',
  '--modules',
  '--trace',
  '--solver-backend', '--solver-model',
  '--judge-backend', '--judge-model',
  '--verifier-backend', '--verifier-model',
  '--revision-backend', '--revision-model',
  '--solver-reasoning', '--judge-reasoning',
  '--verifier-reasoning', '--revision-reasoning',
  '--solver-backends',
  '--limit',  // For stats command
  '--era',    // For stats command era selection
]);

const BOOLEAN_FLAGS = new Set([
  '--no-sel',
  '--deep', '-d',
  '--no-verify',
  '--force-verify',
  '--distribute-solvers',
  '--json',
  '--notify',
  '--no-notify',
  '--help', '-h',
  '--version', '-v',
  '--dry-run',
  // Stats command grouping modes
  '--by-module',
  '--by-category',
  '--by-model',
  '--by-judge',
]);

// All known flags for suggestion matching
const ALL_FLAGS = new Set([...FLAGS_WITH_VALUES, ...BOOLEAN_FLAGS]);

/**
 * Suggest a similar flag using Levenshtein distance.
 * Returns undefined if no close match found.
 */
function suggestSimilarFlag(unknown: string): string | undefined {
  // Normalize: strip leading dashes for comparison
  const normalizedUnknown = unknown.replace(/^-+/, '');
  
  let bestMatch: string | undefined;
  let bestDistance = Infinity;
  const threshold = 3;  // Max edit distance to suggest
  
  for (const known of ALL_FLAGS) {
    // Only compare long-form flags (--foo) for better suggestions
    if (!known.startsWith('--')) continue;
    
    const normalizedKnown = known.replace(/^-+/, '');
    const distance = levenshteinDistance(normalizedUnknown, normalizedKnown);
    
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      bestMatch = known;
    }
  }
  
  return bestMatch ? `Did you mean ${bestMatch}?` : undefined;
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix: number[][] = [];
  
  // Initialize first column
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  
  // Initialize first row
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill in the rest
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[a.length][b.length];
}

// =============================================================================
// Tokenize Argv
// =============================================================================

export function tokenizeArgv(argv: string[]): { flags: RawFlags; positionals: string[] } {
  const args = argv.slice(2);  // Skip node and script path
  
  const flags: RawFlags = {
    files: [],
    noSel: false,
    json: false,
    deep: false,
    noVerify: false,
    forceVerify: false,
    distributeSolvers: undefined,  // undefined = not set by CLI, use config
    statsModule: false,
    statsCategory: false,
    statsModel: false,
    statsJudge: false,
    help: false,
    version: false,
    dryRun: false,
  };
  
  const positionals: string[] = [];
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    // Handle -- separator: everything after is literal prompt
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    
    // Handle flags with values
    if (FLAGS_WITH_VALUES.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new CliValidationError(
          `Flag ${arg} requires a value`,
          'FLAG_REQUIRES_VALUE'
        );
      }
      
      parseFlagWithValue(flags, arg, value);
      i += 2;
      continue;
    }
    
    // Handle boolean flags
    if (BOOLEAN_FLAGS.has(arg)) {
      parseBooleanFlag(flags, arg);
      i++;
      continue;
    }
    
    // Check for unknown flags (anything starting with -)
    if (arg.startsWith('-')) {
      const suggestion = suggestSimilarFlag(arg);
      throw new CliValidationError(
        `Unknown flag: ${arg}`,
        'UNKNOWN_FLAG',
        suggestion
      );
    }
    
    // Anything else is a positional
    positionals.push(arg);
    i++;
  }
  
  // Validate session ID
  const session = flags.session ?? process.env.VEDA_SESSION ?? DEFAULT_SESSION;
  if (!isValidSessionId(session)) {
    throw new CliValidationError(
      `Invalid session ID: ${session}`,
      'INVALID_SESSION_ID',
      'Session IDs must be alphanumeric with dashes/underscores'
    );
  }
  flags.session = session;
  
  return { flags, positionals };
}

function parseFlagWithValue(flags: RawFlags, flag: string, value: string): void {
  switch (flag) {
    case '-S':
    case '--session':
      flags.session = value;
      break;
    case '-p':
    case '--persona':
      flags.persona = value;
      break;
    case '-b':
    case '--backend':
      flags.backend = value;
      break;
    case '-m':
    case '--model':
      flags.model = value;
      break;
    case '-r':
    case '--reasoning':
      flags.reasoning = value;
      break;
    case '--sandbox':
      flags.sandbox = value;
      break;
    case '-o':
    case '--output':
      flags.output = value;
      break;
    case '-f':
    case '--files':
      flags.files.push(value);
      break;
    case '-k':
      flags.k = parseInt(value, 10);
      break;
    case '--categories':
      flags.categories = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      break;
    case '--modules':
      flags.modules = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      break;
    case '--trace':
      flags.trace = value;
      break;
    case '--solver-backend':
      flags.solverBackend = value;
      break;
    case '--solver-model':
      flags.solverModel = value;
      break;
    case '--judge-backend':
      flags.judgeBackend = value;
      break;
    case '--judge-model':
      flags.judgeModel = value;
      break;
    case '--verifier-backend':
      flags.verifierBackend = value;
      break;
    case '--verifier-model':
      flags.verifierModel = value;
      break;
    case '--revision-backend':
      flags.revisionBackend = value;
      break;
    case '--revision-model':
      flags.revisionModel = value;
      break;
    case '--solver-backends':
      flags.solverBackends = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      break;
    case '--solver-reasoning':
      flags.solverReasoning = value;
      break;
    case '--judge-reasoning':
      flags.judgeReasoning = value;
      break;
    case '--verifier-reasoning':
      flags.verifierReasoning = value;
      break;
    case '--revision-reasoning':
      flags.revisionReasoning = value;
      break;
    case '--limit':
      flags.limit = parseInt(value, 10);
      break;
    case '--era':
      flags.era = value;
      break;
  }
}

function parseBooleanFlag(flags: RawFlags, flag: string): void {
  switch (flag) {
    case '--no-sel':
      flags.noSel = true;
      break;
    case '--deep':
    case '-d':
      flags.deep = true;
      break;
    case '--no-verify':
      flags.noVerify = true;
      break;
    case '--force-verify':
      flags.forceVerify = true;
      break;
    case '--distribute-solvers':
      flags.distributeSolvers = true;
      break;
    case '--json':
      flags.json = true;
      break;
    case '--notify':
      flags.notify = true;
      break;
    case '--no-notify':
      flags.notify = false;
      break;
    case '--help':
    case '-h':
      flags.help = true;
      break;
    case '--version':
    case '-v':
      flags.version = true;
      break;
    case '--dry-run':
      flags.dryRun = true;
      break;
    case '--by-module':
      flags.statsModule = true;
      break;
    case '--by-category':
      flags.statsCategory = true;
      break;
    case '--by-model':
      flags.statsModel = true;
      break;
    case '--by-judge':
      flags.statsJudge = true;
      break;
  }
}

// =============================================================================
// Classify Command
// =============================================================================

export function classifyCommand(positionals: string[], flags: RawFlags): ParsedPositionals {
  // Handle meta commands first
  if (flags.help) {
    return { command: 'help', args: [] };
  }
  if (flags.version) {
    return { command: 'version', args: [] };
  }
  
  const firstWord = positionals[0] ?? '';
  
  // Explicit commands
  switch (firstWord) {
    case 'sel':
    case 'selection':
      return {
        command: 'sel',
        subcommand: positionals[1],
        args: positionals.slice(2),
      };
    
    case 'resume': {
      // Only accept single positional after 'resume'; 2+ will be rejected by validation
      const resumeArgs = positionals.slice(1);
      return {
        command: 'resume',
        args: [],
        prompt: resumeArgs.length === 1 ? resumeArgs[0] : undefined,
      };
    }
    
    case 'deep': {
      // Only accept single positional after 'deep'; 2+ will be rejected by validation
      const deepArgs = positionals.slice(1);
      return {
        command: 'prompt',
        args: [],
        prompt: deepArgs.length === 1 ? deepArgs[0] : undefined,
        subcommand: 'deep',  // Use subcommand to indicate deep mode
      };
    }
    
    case 'init':
      return { command: 'init', args: [] };
    
    case 'personas':
      return {
        command: 'personas',
        subcommand: positionals[1],
        args: positionals.slice(2),
      };
    
    case 'stats':
      return {
        command: 'stats',
        subcommand: positionals[1],  // --module, --category, or --backend
        args: positionals.slice(2),
      };
  }
  
  // Implicit prompt command
  // If --deep flag is set, mode is deep
  // Only accept single positional as prompt; 2+ positionals will be rejected by validation
  const prompt = positionals.length === 1 ? positionals[0] : undefined;
  
  return {
    command: 'prompt',
    args: [],
    prompt,
    subcommand: flags.deep ? 'deep' : undefined,
  };
}
