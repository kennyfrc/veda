import { DEFAULT_SESSION, isValidSessionId } from './util/paths';
import { listModelAliases } from './agent/model-aliases';

export interface CliOptions {
  session: string;
  persona?: string;
  backend?: string;
  model?: string;
  reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
  noTools?: boolean;
  /** Tool opt-in allowlist (--tools read,grep). Off by default; personas default to no tools. */
  tools?: string[];
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
  /** Listed mode: fully-resolved per-slot solver identities (from --solver-models / DEEP_SOLVER_MODELS).
   *  Populated by the adapter after stage resolution; legacy parseArgs cannot produce it. */
  solverSlots?: Array<{ backend: string; model: string; reasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }>;
  uniform?: boolean;  // Disable Thompson Sampling, use uniform random selection
  lowCountModules?: boolean;  // Bias selection toward low-appearance modules (single-judge only)
  
  // Deep mode per-stage reasoning
  solverReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  judgeReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  verifierReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  revisionReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  
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
  '--tools',
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
  // Listed mode: one solver per model entry (resolved by parseAndValidate only)
  '--solver-models',
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
        case '--tools':
          options.tools = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
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
        case '--solver-models':
          throw new Error(
            '--solver-models is not supported by the legacy parser; use parseAndValidate (src/cli/index.ts)'
          );
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
      case '--no-tools':
      case '-nt':
        options.noTools = true;
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
  } else if (command === 'skills') {
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
  console.log(`veda - Pair Programming CLI with multi-backend support

veda pairs you (the Driver) with AI collaborators (Navigator + Verifier + Worker) using
a driver-navigator workflow inspired by pair programming best practices.

  You (Driver)     explore, edit, implement, run tests
  Navigator        plans, stress-tests, directs (read-only tools, no edits)
  Verifier         adversarially verifies finished work (tools on, after implementation)
  Worker           executes a delegated implementation task (writes your repo)

== Quick Start ==

  # 1. Set context for the Navigator
  veda -S impl-my-task sel add "src/auth/" "src/api/users.ts"

  # 2. Plan with Navigator (commit to a position, get alternatives + kill criteria)
  veda -S impl-my-task -m sol -p navigator-plan \\
    'Goal: add JWT auth. Approach: jwt.sign in login, verify middleware. Non-goal: OAuth.'

  # 3. Discuss follow-ups (same session)
  veda -S impl-my-task -m sol -p navigator-chat \\
    'What about edge case X?'

  # 4. Implement (you do this, not the Navigator) — or delegate a bounded slice
  veda -S impl-my-task -m sol -p worker \\
    'Implement slice 1 of design.json; run the slice tests; report via worker_report.'

  # 5. Verify with Verifier
  git diff > /tmp/changes.diff
  veda -S review-my-task sel add /tmp/changes.diff src/auth/
  veda -S review-my-task -m sol -p reviewer \\
    'Implementation complete. Review the diff against the design and report P0/P1/P2 findings.'

== Commands ==

  veda <prompt>                    Run a prompt (default persona: navigator-chat)
  veda guide                       Print the full pair programming guide
  veda personas                    List personas (with descriptions)
  veda personas <name>             Show a persona's system prompt
  veda sel <cmd> [args]            Manage file selection (add, rm, ls, clear, tokens)
  veda skills <cmd>             Install agent skills (install, uninstall, list)
  veda resume [prompt]             Resume a conversation
  veda deep <prompt>               Deep thinking mode (multi-solver + judge + verify)
  veda stats [options]             View judge statistics
  veda init                        Initialize config and personas

== Options ==

  -S, --session <id>        Session ID (isolates selection + conversation)
  -p, --persona <name>      Persona: navigator-plan, navigator-chat, reviewer, worker
  -b, --backend <name>      Backend: codex, claude-code, droid, pi
  -m, --model <name>        Model or alias (auto-selects backend if -b omitted)
                            Aliases: ${listModelAliases().join(', ')}
  -r, --reasoning <level>   Reasoning: minimal, low, medium, high, xhigh, max
  --sandbox <mode>          Sandbox: read-only, workspace-write, full
  --no-tools, -nt           Disable all tools (context-only response)
  --tools <list>            Opt IN to tools (e.g. read,grep,glob; off by default)
  -o, --output <file>       Save response to file
  -f, --files <file>        Ad-hoc files (doesn't modify selection)
  --no-sel                  Ignore selection for this run
  --notify / --no-notify    Toggle system notifications (default: on)
  --notify-sound <name>     Notification sound (macOS)
  --json                    Output raw JSON
  --help, -h                Show this help
  --version, -v             Show version

== Deep Mode ==

  --deep, -d                Enable deep thinking mode
  -k <num>                  Parallel solvers (default: 6, max: 12)
  --categories <list>       Reasoning categories (comma-separated)
  --modules <list>           Module specifiers (category/module format)
  --no-verify               Disable verifier + revision (now the default)
  --verify                  Run verifier + revision (opt-in; skipped when off)
  --force-verify            Run verification even at high confidence (implies --verify)
  --trace <file>            Save trace to YAML
  --resume                  Resume from checkpoint
  --distribute-solvers       Distribute solvers across backends (round-robin)
  --solver-backends <list>  Backends for distribution
  --solver-models <list>    One solver per model (aliases/IDs), same prompt for each
                            e.g. sol,k3,fable. Add --modules <list> (same length) to
                            zip a module onto each slot. k = list length.

  Per-stage overrides:
  --solver-backend/--model   --judge-backend/--model
  --verifier-backend/--model --revision-backend/--model
  --solver-reasoning         --judge-reasoning
  --verifier-reasoning       --revision-reasoning

== Selection ==

  sel add <files...>        Add files (supports globs and slices: file.ts:10-20)
  sel rm <files...>         Remove files
  sel ls                    List selected files with token counts
  sel clear                 Clear selection
  sel tokens                Show total token count

== Skills ==

  skills install             Install bundled skills into ~/.agents/skills/ +
                             ~/.claude/skills/ (discovered by pi, Codex CLI,
                             Claude Code). Also run by 'veda init'.
  Bundled skills             veda-plan, veda-plan-implement, veda-plan-implement-review,
                                                     veda-deep-plan,
                             veda-worker
  skills uninstall           Remove the installed skills
  skills list                Show install status and symlink health

== Stats ==

  stats                      View ratings (group by module)
  stats --by-category        Group by reasoning category
  stats --by-model           Group by solver model
  stats --by-judge           Group by judge
  stats --limit <n>          Show top N (default: 20)
  stats --json               Output as JSON

== File Slices ==

  file.ts:10-20              Lines 10-20
  file.ts:15-                Line 15 to EOF
  file.ts:8                  Single line 8
  "src/*.ts:1-50"            First 50 lines of each matched file

== Examples ==

  # Plan a task
  veda -S plan-auth sel add "src/*.ts"
  veda -S plan-auth -m sol -p navigator-plan "Design a caching layer"

  # Quick discussion
  veda -S plan-auth -m sol -p navigator-chat "Quick question about X"

  # Model aliases (auto-selects backend)
  veda -m opus "Explain this code"

  # View the full guide
  veda guide

  # View a persona's prompt
  veda personas navigator-plan

For the full pair programming workflow, run: veda guide
`);
}

export function showVersion(): void {
  const pkg = require('../package.json');
  console.log(`veda ${pkg.version}`);
}
