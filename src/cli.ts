import { DEFAULT_SESSION, isValidSessionId } from './util/paths';

export interface CliOptions {
  session: string;
  persona?: string;
  backend?: string;
  model?: string;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'full';
  output?: string;
  noSel?: boolean;
  files?: string[];
  deep?: boolean;
  k?: number;
  noVerify?: boolean;
  forceVerify?: boolean;
  categories?: string[];
  modules?: string[];
  json?: boolean;
  trace?: string;
  notify?: boolean;
  help?: boolean;
  version?: boolean;
  
  solverBackend?: string;
  solverModel?: string;
  judgeBackend?: string;
  judgeModel?: string;
  verifierBackend?: string;
  verifierModel?: string;
  revisionBackend?: string;
  revisionModel?: string;

  distributeSolvers?: boolean;
  solverBackends?: string[];
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
  '--categories',
  '--modules',
  '--trace',
  // Per-stage overrides for deep mode
  '--solver-backend', '--solver-model',
  '--judge-backend', '--judge-model',
  '--verifier-backend', '--verifier-model',
  '--revision-backend', '--revision-model',
  // Randomization options for deep mode
  '--solver-backends',
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  
  const options: CliOptions = {
    session: process.env.VEDA_SESSION ?? DEFAULT_SESSION,
  };
  
  const positional: string[] = [];
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    
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
        case '--categories':
          options.categories = value.split(',').map(s => s.trim());
          break;
        case '--modules':
          options.modules = value.split(',').map(s => s.trim());
          break;
        case '--trace':
          options.trace = value;
          break;
        case '--solver-backend':
          options.solverBackend = value;
          break;
        case '--solver-model':
          options.solverModel = value;
          break;
        case '--judge-backend':
          options.judgeBackend = value;
          break;
        case '--judge-model':
          options.judgeModel = value;
          break;
        case '--verifier-backend':
          options.verifierBackend = value;
          break;
        case '--verifier-model':
          options.verifierModel = value;
          break;
        case '--revision-backend':
          options.revisionBackend = value;
          break;
        case '--revision-model':
          options.revisionModel = value;
          break;
        case '--solver-backends':
          options.solverBackends = value.split(',').map(s => s.trim());
          break;
      }
      i += 2;
      continue;
    }

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
      case '--force-verify':
        options.forceVerify = true;
        i++;
        continue;
      case '--distribute-solvers':
        options.distributeSolvers = true;
        i++;
        continue;
      case '--json':
        options.json = true;
        i++;
        continue;
      case '--notify':
        options.notify = true;
        i++;
        continue;
      case '--no-notify':
        options.notify = false;
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
    
    // Everything after -- is literal prompt
    if (arg === '--') {
      const rest = args.slice(i + 1);
      if (rest.length > 0) {
        const existingCommand = positional[0] ?? 'prompt';
        
        if (existingCommand === 'resume') {
          return {
            command: 'resume',
            subcommand: undefined,
            args: [],
            options,
            prompt: rest.join(' '),
          };
        } else if (existingCommand === 'deep') {
          return {
            command: 'deep',
            subcommand: undefined,
            args: [],
            options,
            prompt: rest.join(' '),
          };
        } else {
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
    
    positional.push(arg);
    i++;
  }
  
  if (!isValidSessionId(options.session)) {
    throw new Error(`Invalid session ID: ${options.session}`);
  }
  
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
  -b, --backend <name>    Backend: codex, claude-code, gemini-cli (default: codex)
  -m, --model <name>      Model: opus, sonnet, haiku, gpt, gemini-pro, gemini-flash
                          (auto-selects backend if not specified with -b)
  -r, --reasoning <level> Reasoning: minimal, low, medium, high, xhigh
  --sandbox <mode>        Sandbox: read-only, workspace-write, full
  -o, --output <file>     Save response to file
  -f, --files <file>      Ad-hoc files (doesn't modify selection)
  --no-sel                Ignore selection for this run
  --notify                Enable system notifications (default: on)
  --no-notify             Disable system notifications
  --deep, -d              Enable deep thinking mode
  -k <num>                Number of parallel solvers (default: 4, max: 8)
  --categories <list>     Reasoning categories (comma-separated)
  --modules <list>        Module specifiers (comma-separated)
                          Formats: category/module, category (random), module_id
                          Example: analytical/so_what_test,creative,systematic
  --no-verify             Skip verification in deep mode
  --force-verify          Run verification even with high confidence (≥70%)
  --trace <file>          Save trace to YAML file (deep mode)
  --json                  Output raw JSON
  --dry-run               Show resolved config without executing
  --help, -h              Show help
  --version, -v           Show version

Deep Mode Stage Overrides:
  --solver-backend <name>   Backend for solvers (default: -b value)
  --solver-model <name>     Model for solvers (default: -m value)
  --judge-backend <name>    Backend for judge (default: -b value)
  --judge-model <name>      Model for judge (default: -m value)
  --verifier-backend <name> Backend for verifier (default: -b value)
  --verifier-model <name>   Model for verifier (default: -m value)
  --revision-backend <name> Backend for revision (default: verifier value)
  --revision-model <name>   Model for revision (default: verifier value)

Deep Mode Backends:
  --distribute-solvers      Distribute solver backends evenly (round-robin)
  --solver-backends <list>  Comma-separated backends for --distribute-solvers

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
  veda -S agent-1 --backend claude-code "Explain this code"
  veda --no-sel "What is the CAP theorem?"
`);
}

export function showVersion(): void {
  const pkg = require('../package.json');
  console.log(`veda ${pkg.version}`);
}
