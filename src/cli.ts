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
  notifySound?: string;
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
  uniform?: boolean;  // Disable Thompson Sampling, use uniform random selection
  lowCountModules?: boolean;  // Bias selection toward low-appearance modules (single-judge only)
  
  // Deep mode per-stage reasoning
  solverReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  judgeReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  verifierReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  revisionReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  
  // Deep mode resume/checkpoint flags
  resume?: boolean;        // Resume from checkpoint
  force?: boolean;         // Overwrite existing checkpoint on new run
  forceResume?: boolean;   // Resume despite run identity mismatch
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
  '--notify-sound',
  // Per-stage overrides for deep mode
  '--solver-backend', '--solver-model',
  '--judge-backend', '--judge-model',
  '--verifier-backend', '--verifier-model',
  '--revision-backend', '--revision-model',
  // Per-stage reasoning for deep mode
  '--solver-reasoning', '--judge-reasoning',
  '--verifier-reasoning', '--revision-reasoning',
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
        case '--notify-sound':
          options.notifySound = value;
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
        case '--solver-reasoning':
          options.solverReasoning = value as CliOptions['solverReasoning'];
          break;
        case '--judge-reasoning':
          options.judgeReasoning = value as CliOptions['judgeReasoning'];
          break;
        case '--verifier-reasoning':
          options.verifierReasoning = value as CliOptions['verifierReasoning'];
          break;
        case '--revision-reasoning':
          options.revisionReasoning = value as CliOptions['revisionReasoning'];
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
      case '--uniform':
        options.uniform = true;
        i++;
        continue;
      case '--low-count-modules':
        options.lowCountModules = true;
        i++;
        continue;
      case '--resume':
        options.resume = true;
        i++;
        continue;
      case '--force':
        options.force = true;
        i++;
        continue;
      case '--force-resume':
        options.forceResume = true;
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
    // Only accept single positional after 'resume'; 2+ will be rejected by validation
    prompt = commandArgs.length === 1 ? commandArgs[0] : undefined;
  } else if (command === 'deep') {
    // Only accept single positional after 'deep'; 2+ will be rejected by validation
    const deepArgs = positional.slice(1);
    prompt = deepArgs.length === 1 ? deepArgs[0] : undefined;
  } else if (command === 'init') {
    // No args
  } else if (command && !command.startsWith('-')) {
    // Only accept single positional as prompt; 2+ positionals will be rejected by validation
    prompt = positional.length === 1 ? positional[0] : undefined;
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
  veda stats [options]                 View judge statistics
  veda init                            Initialize config

Options:
  -S, --session <id>      Session ID (or use VEDA_SESSION env)
  -p, --persona <name>    Persona: navigator-plan, navigator-chat, reviewer, advisor
  -b, --backend <name>    Backend: codex, claude-code, gemini-cli, droid, jdc
  -m, --model <name>      Model or alias (auto-selects backend if -b omitted)
                          Aliases: opus, sonnet, haiku, gpt, gemini-pro, gemini-flash,
                                   glm-5.2, makora
                          Backend-specific: jdc/<provider>/<model>, custom:Makora-GLM-5.2-NVFP4-9
  -r, --reasoning <level> Reasoning: minimal, low, medium, high, xhigh
  --sandbox <mode>        Sandbox: read-only, workspace-write, full
  -o, --output <file>     Save response to file
  -f, --files <file>      Ad-hoc files (doesn't modify selection)
  --no-sel                Ignore selection for this run
  --notify                Enable system notifications (default: on)
  --no-notify             Disable system notifications
  --notify-sound <name>    Notification sound name or path (macOS)
  --deep, -d              Enable deep thinking mode
  -k <num>                Number of parallel solvers (default: 6, max: 12)
  --categories <list>     Reasoning categories (comma-separated)
  --modules <list>        Module specifiers (comma-separated)
                          Formats: category/module, category (random), module_id
                          Example: analytical/so_what_test,creative,systematic
  --uniform               Disable Thompson Sampling, use uniform random selection
  --low-count-modules     Bias module selection toward low-appearance modules (single-judge)
  --no-verify             Skip verification in deep mode
  --force-verify          Run verification even with high confidence (≥70%)
  --trace <file>          Save trace to YAML file (deep mode)
  --resume                Resume from checkpoint (deep mode)
  --force                 Overwrite existing checkpoint on new run
  --force-resume          Resume despite run identity mismatch
  --json                  Output raw JSON
  --dry-run               Show resolved config without executing
  --help, -h              Show help
  --version, -v           Show version

Personas:
  navigator-plan          High-reasoning planning (use for initial architecture, once per task)
  navigator-chat          Medium-reasoning discussion (use for follow-up Q&A)
  reviewer                Code review with [P0]-[P3] findings
  advisor                 Second-opinion reviewer (outputs <advisory> blocks)

Backends:
  codex                   OpenAI Codex (default)
  claude-code             Anthropic Claude Code
  gemini-cli              Google Gemini CLI
  droid                   Factory Droid (droid exec, --auto for sandbox)
  jdc                     jdc CLI (jdc/<provider>/<model> format)

Deep Mode Stage Overrides:
  --solver-backend <name>   Backend for solvers (default: -b value)
  --solver-model <name>     Model for solvers (default: -m value)
  --judge-backend <name>    Backend for judge (default: -b value)
  --judge-model <name>      Model for judge (default: -m value)
  --verifier-backend <name> Backend for verifier (default: -b value)
  --verifier-model <name>   Model for verifier (default: -m value)
  --revision-backend <name> Backend for revision (default: verifier value)
  --revision-model <name>   Model for revision (default: verifier value)

Deep Mode Reasoning:
  --solver-reasoning <level>    Reasoning for solvers (default: high)
  --judge-reasoning <level>     Reasoning for judge (default: medium)
  --verifier-reasoning <level>  Reasoning for verifier (default: high)
  --revision-reasoning <level>  Reasoning for revision (default: verifier value)

Deep Mode Backends:
  --distribute-solvers      Distribute solver backends evenly (round-robin)
  --solver-backends <list>  Comma-separated backends for --distribute-solvers

Selection Commands:
  sel add <files...>      Add files to selection (supports globs)
  sel rm <files...>       Remove files from selection
  sel ls                  List selected files with token counts
  sel clear               Clear selection
  sel tokens              Show total token count

Stats Commands (Glicko-2 Ratings):
  stats                   View ratings (group by module)
  stats --by-category     Group by reasoning category
  stats --by-model        Group by solver model (backend:model)
  stats --by-judge        Group by judge (backend:model)
  stats --limit <n>       Show top N entities (default: 20)
  stats --json            Output as JSON

File Slices:
  file.ts:10-20           Lines 10-20
  file.ts:15-             Line 15 to EOF
  file.ts:8               Single line 8

Examples:
  # Plan a task with navigator-plan (always pass -b and -m)
  veda -S plan-auth sel add "src/*.ts"
  veda -S plan-auth -b droid -m glm-5.2 -p navigator-plan "Design a caching layer"
  veda -S plan-auth -b jdc -m jdc/crof/glm-5.2 resume "What about LRU?"

  # Quick discussion with navigator-chat
  veda -S plan-auth -b droid -m glm-5.2 -p navigator-chat "Quick question about X"

  # Advisor review (second opinion)
  veda -b droid -m glm-5.2 --persona advisor "Review this transcript"

  # Model aliases auto-select backend (no -b needed)
  veda -m opus "Explain this code"
  veda -m glm-5.2 "Quick summary"

  # No-selection quick query
  veda --no-sel "What is the CAP theorem?"
`);
}

export function showVersion(): void {
  const pkg = require('../package.json');
  console.log(`veda ${pkg.version}`);
}
