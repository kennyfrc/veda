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
  '--solver-backends',
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
]);

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
    distributeSolvers: false,
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
    case '--solver-backends':
      flags.solverBackends = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
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
    
    case 'resume':
      return {
        command: 'resume',
        args: [],
        prompt: positionals.slice(1).join(' ') || undefined,
      };
    
    case 'deep':
      return {
        command: 'prompt',
        args: [],
        prompt: positionals.slice(1).join(' ') || undefined,
        subcommand: 'deep',  // Use subcommand to indicate deep mode
      };
    
    case 'init':
      return { command: 'init', args: [] };
    
    case 'personas':
      return {
        command: 'personas',
        subcommand: positionals[1],
        args: positionals.slice(2),
      };
  }
  
  // Implicit prompt command
  // If --deep flag is set, mode is deep
  const prompt = positionals.join(' ') || undefined;
  
  return {
    command: 'prompt',
    args: [],
    prompt,
    subcommand: flags.deep ? 'deep' : undefined,
  };
}
