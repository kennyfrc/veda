/**
 * CLI argument parsing.
 */

import { DEFAULT_SESSION, isValidSessionId } from './util/paths';

export interface CliOptions {
  /** Session ID */
  session: string;
  /** Persona name */
  persona?: string;
  /** Backend name */
  backend?: string;
  /** Model override */
  model?: string;
  /** Reasoning level override */
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Sandbox mode */
  sandbox?: 'read-only' | 'workspace-write' | 'full';
  /** Output file */
  output?: string;
  /** Skip selection for this run */
  noSel?: boolean;
  /** Ad-hoc files (doesn't modify selection) */
  files?: string[];
  /** Enable deep/pro mode */
  deep?: boolean;
  /** Number of solvers for ensemble (k) */
  k?: number;
  /** Skip verification in deep mode */
  noVerify?: boolean;
  /** Pass through JSON output */
  json?: boolean;
  /** Show help */
  help?: boolean;
  /** Show version */
  version?: boolean;
}

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  args: string[];
  options: CliOptions;
  prompt?: string;
}

const FLAGS_WITH_VALUES = new Set([
  '-S', '--session',
  '-p', '--persona',
  '-b', '--backend',
  '-m', '--model',
  '-r', '--reasoning',
  '--sandbox',
  '-o', '--output',
  '-f', '--files',
  '-k', '--k',
]);

/**
 * Parse CLI arguments.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // Skip bun and script path
  
  const options: CliOptions = {
    session: process.env.VEDA_SESSION ?? DEFAULT_SESSION,
  };
  
  const positional: string[] = [];
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
    // Handle flags with values
    if (FLAGS_WITH_VALUES.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) {
        throw new Error(`Flag ${arg} requires a value`);
      }
      
      switch (arg) {
        case '-S':
        case '--session':
          options.session = value;
          break;
        case '-p':
        case '--persona':
          options.persona = value;
          break;
        case '-b':
        case '--backend':
          options.backend = value;
          break;
        case '-m':
        case '--model':
          options.model = value;
          break;
        case '-r':
        case '--reasoning':
          options.reasoning = value as CliOptions['reasoning'];
          break;
        case '--sandbox':
          options.sandbox = value as CliOptions['sandbox'];
          break;
        case '-o':
        case '--output':
          options.output = value;
          break;
        case '-f':
        case '--files':
          options.files = options.files ?? [];
          options.files.push(value);
          break;
        case '-k':
        case '--k':
          options.k = parseInt(value, 10);
          break;
      }
      i += 2;
      continue;
    }
    
    // Handle boolean flags
    switch (arg) {
      case '--no-sel':
        options.noSel = true;
        i++;
        continue;
      case '--deep':
      case '-d':
        options.deep = true;
        i++;
        continue;
      case '--no-verify':
        options.noVerify = true;
        i++;
        continue;
      case '--json':
        options.json = true;
        i++;
        continue;
      case '--help':
      case '-h':
        options.help = true;
        i++;
        continue;
      case '--version':
      case '-v':
        options.version = true;
        i++;
        continue;
    }
    
    // Handle -- separator (everything after is literal prompt)
    if (arg === '--') {
      const rest = args.slice(i + 1);
      if (rest.length > 0) {
        // Check if we already have a command in positional
        const existingCommand = positional[0] ?? 'prompt';
        
        if (existingCommand === 'resume') {
          // veda resume -- "prompt with dashes"
          return {
            command: 'resume',
            subcommand: undefined,
            args: [],
            options,
            prompt: rest.join(' '),
          };
        } else if (existingCommand === 'deep') {
          // veda deep -- "prompt with dashes"
          return {
            command: 'deep',
            subcommand: undefined,
            args: [],
            options,
            prompt: rest.join(' '),
          };
        } else {
          // Default: treat as prompt command
          return {
            command: 'prompt',
            subcommand: undefined,
            args: [],
            options,
            prompt: rest.join(' '),
          };
        }
      }
      break;
    }
    
    // Positional argument
    positional.push(arg);
    i++;
  }
  
  // Validate session ID
  if (!isValidSessionId(options.session)) {
    throw new Error(`Invalid session ID: ${options.session}`);
  }
  
  // Parse command structure
  const command = positional[0] ?? '';
  let subcommand: string | undefined;
  let commandArgs: string[] = [];
  let prompt: string | undefined;
  
  if (command === 'sel' || command === 'selection') {
    subcommand = positional[1];
    commandArgs = positional.slice(2);
  } else if (command === 'personas') {
    subcommand = positional[1];
    commandArgs = positional.slice(2);
  } else if (command === 'resume') {
    commandArgs = positional.slice(1);
    prompt = commandArgs.join(' ') || undefined;
  } else if (command === 'deep') {
    prompt = positional.slice(1).join(' ') || undefined;
  } else if (command === 'init') {
    // No args
  } else if (command && !command.startsWith('-')) {
    // First positional is the prompt
    prompt = positional.join(' ');
  }
  
  return {
    command: command || 'prompt',
    subcommand,
    args: commandArgs,
    options,
    prompt,
  };
}

/**
 * Show help message.
 */
export function showHelp(): void {
  console.log(`veda - AI CLI wrapper with multi-backend support

Usage:
  veda [options] <prompt>              Run a prompt
  veda sel <cmd> [args...]             Manage file selection
  veda personas                        List personas
  veda resume [prompt]                 Resume conversation
  veda deep <prompt>                   Deep thinking mode
  veda init                            Initialize config

Options:
  -S, --session <id>      Session ID (or use VEDA_SESSION env)
  -p, --persona <name>    Use persona (default: navigator-chat)
  -b, --backend <name>    Backend: codex, claude, gemini (default: codex)
  -m, --model <name>      Model override
  -r, --reasoning <level> Reasoning: minimal, low, medium, high, xhigh
  --sandbox <mode>        Sandbox: read-only, workspace-write, full
  -o, --output <file>     Save response to file
  -f, --files <file>      Ad-hoc files (doesn't modify selection)
  --no-sel                Ignore selection for this run
  --deep, -d              Enable deep thinking mode
  -k <num>                Number of parallel solvers (default: 3)
  --no-verify             Skip verification in deep mode
  --json                  Output raw JSON
  --help, -h              Show help
  --version, -v           Show version

Selection Commands:
  sel add <files...>      Add files to selection (supports globs)
  sel rm <files...>       Remove files from selection
  sel ls                  List selected files with token counts
  sel clear               Clear selection
  sel tokens              Show total token count

File Slices:
  file.ts:10-20           Lines 10-20
  file.ts:15-             Line 15 to EOF
  file.ts:8               Single line 8

Examples:
  veda -S agent-1 sel add "src/*.ts"
  veda -S agent-1 -p navigator-plan "Design a caching layer"
  veda -S agent-1 resume "What about LRU?"
  veda -S agent-1 --backend claude "Explain this code"
  veda --no-sel "What is the CAP theorem?"
`);
}

/**
 * Show version.
 */
export function showVersion(): void {
  console.log('veda 0.1.0 (TypeScript)');
}
