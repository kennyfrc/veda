/**
 * CLI Entry Point - Parse, validate, resolve, construct.
 * 
 * This module implements "parse, don't validate" - the output types
 * make impossible states unrepresentable.
 */

export * from './types';
export { tokenizeArgv, classifyCommand } from './parse';
export { validateApplicability, detectConflicts, detectConfigConflicts } from './validate';
export { resolveBackendModel, resolveDeepStages, resolveVerifyConfig } from './resolve';
export { simpleConfigToCliOptions, deepConfigToCliOptions, resumeConfigToCliOptions } from './adapter';

import type {
  VedaInput,
  RawFlags,
  ParsedPositionals,
  SimpleConfig,
  DeepConfig,
  ResumeConfig,
  StatsConfig,
  StatsGroupBy,
  ContextConfig,
  OutputConfig,
  SelSubcommand,
  SkillsSubcommand,
} from './types';
import { CliValidationError } from './types';
import { tokenizeArgv, classifyCommand } from './parse';
import { validateApplicability, detectConflicts, detectConfigConflicts } from './validate';
import { resolveBackendModel, resolveDeepStages, resolveVerifyConfig } from './resolve';
import { loadGlobalConfig } from '../agent/config';

// =============================================================================
// Main Parse Function
// =============================================================================

/**
 * Parse argv into a fully validated VedaInput.
 * Throws CliValidationError on invalid input.
 */
export async function parseAndValidate(argv: string[]): Promise<VedaInput> {
  // Step 1: Tokenize
  const { flags, positionals } = tokenizeArgv(argv);
  
  // Step 2: Classify command
  const parsed = classifyCommand(positionals, flags);
  
  // Step 3: Handle meta commands early
  if (parsed.command === 'help') {
    return { command: 'help' };
  }
  if (parsed.command === 'version') {
    return { command: 'version' };
  }
  if (parsed.command === 'init') {
    return { command: 'init' };
  }
  if (parsed.command === 'guide') {
    return { command: 'guide' };
  }
  if (parsed.command === 'personas') {
    return { command: 'personas', subcommand: parsed.subcommand };
  }
  if (parsed.command === 'sel') {
    const subcommand = parsed.subcommand as SelSubcommand | undefined;
    if (!subcommand || !['add', 'rm', 'ls', 'clear', 'tokens'].includes(subcommand)) {
      throw new CliValidationError(
        `Unknown sel subcommand: ${subcommand ?? '(none)'}`,
        'UNKNOWN_COMMAND',
        'Available: add, rm, ls, clear, tokens'
      );
    }
    return {
      command: 'sel',
      subcommand: subcommand as SelSubcommand,
      args: parsed.args,
      session: flags.session!,
    };
  }
  if (parsed.command === 'skills') {
    const sub = parsed.subcommand as SkillsSubcommand | undefined;
    if (!sub || !['install', 'uninstall', 'list'].includes(sub)) {
      throw new CliValidationError(
        `Unknown skills subcommand: ${sub ?? '(none)'}`,
        'UNKNOWN_COMMAND',
        'Available: install, uninstall, list'
      );
    }
    return { command: 'skills', subcommand: sub as SkillsSubcommand };
  }
  if (parsed.command === 'stats') {
    return constructStatsInput(flags);
  }
  
  // Step 4: Validate applicability
  validateApplicability(parsed, flags, positionals);
  
  // Step 5: Detect conflicts
  detectConflicts(flags);
  
  // Step 6: Load global config
  const globalConfig = await loadGlobalConfig();
  
  // Step 7: Detect config-aware conflicts
  const isDeepMode = parsed.command === 'prompt' && parsed.subcommand === 'deep';
  if (isDeepMode) {
    detectConfigConflicts(flags, globalConfig);
  }
  
  // Step 8: Resolve and construct
  
  if (isDeepMode) {
    return constructDeepInput(parsed, flags, globalConfig);
  }
  
  if (parsed.command === 'resume') {
    return constructResumeInput(parsed, flags, globalConfig);
  }
  
  // Simple prompt mode
  return constructSimpleInput(parsed, flags, globalConfig);
}

// =============================================================================
// Construct Functions
// =============================================================================

function constructSimpleInput(
  parsed: ParsedPositionals,
  flags: RawFlags,
  globalConfig: Awaited<ReturnType<typeof loadGlobalConfig>>
): VedaInput {
  const resolved = resolveBackendModel({
    explicitBackend: flags.backend,
    explicitModel: flags.model,
    globalConfig,
  });
  
  // Handle --dry-run
  if (flags.dryRun) {
    return {
      command: 'dry-run',
      resolved: {
        command: 'prompt',
        mode: 'simple',
        session: flags.session!,
        backend: resolved,
        flags: extractFlagsForDryRun(flags),
      },
    };
  }
  
  const config: SimpleConfig = {
    session: flags.session!,
    prompt: parsed.prompt!,
    backend: resolved.backend,
    model: resolved.model,
    persona: flags.persona,
    reasoning: flags.reasoning as SimpleConfig['reasoning'],
    sandbox: flags.sandbox as SimpleConfig['sandbox'],
    noTools: flags.noTools || undefined,
    tools: flags.tools,
    context: constructContextConfig(flags),
    output: constructOutputConfig(flags),
    notify: flags.notify ?? globalConfig.notify ?? true,
    notifySound: flags.notifySound ?? globalConfig.notifySound,
  };
  
  return { command: 'prompt', mode: 'simple', config };
}

function constructDeepInput(
  parsed: ParsedPositionals,
  flags: RawFlags,
  globalConfig: Awaited<ReturnType<typeof loadGlobalConfig>>
): VedaInput {
  const baseResolved = resolveBackendModel({
    explicitBackend: flags.backend,
    explicitModel: flags.model,
    globalConfig,
  });
  
  const stages = resolveDeepStages({
    flags,
    baseResolved,
    globalConfig,
  });
  
  // Handle --dry-run
  if (flags.dryRun) {
    const solverBackends = stages.solver.mode === 'distributed'
      ? stages.solver.backends
      : stages.solver.mode === 'listed'
        ? stages.solver.slots.map(s => s.backend)
        : [stages.solver.backend];
    const solverModels: Record<string, string> = {};
    let solverSlots: Array<{ index: number; backend: string; model: string; reasoning?: string; prompt: 'uniform' | 'module' }> | undefined;
    if (stages.solver.mode === 'distributed') {
      for (const [k, v] of stages.solver.modelPerBackend) {
        solverModels[k] = v;
      }
    } else if (stages.solver.mode === 'listed') {
      // Listed mode: per-slot models can repeat backends, so a backend→model map
      // cannot represent the roster. Emit the slot list instead.
      solverSlots = stages.solver.slots.map((s, i) => ({
        index: i + 1,
        backend: s.backend,
        model: s.model,
        reasoning: s.reasoning,
        prompt: flags.modules && flags.modules.length > 0 ? 'module' as const : 'uniform' as const,
      }));
    } else {
      solverModels[stages.solver.backend] = stages.solver.model;
    }
    
    return {
      command: 'dry-run',
      resolved: {
        command: 'prompt',
        mode: 'deep',
        session: flags.session!,
        backend: baseResolved,
        stages: {
          solver: {
            mode: stages.solver.mode,
            backends: solverBackends,
            models: solverModels,
            slots: solverSlots,
          },
          judge: {
            backend: stages.judge.backend,
            model: stages.judge.model,
            source: 'explicit',  // Simplified for dry-run
          },
          verifier: {
            backend: stages.verifier.backend,
            model: stages.verifier.model,
            source: 'explicit',
          },
          revision: {
            backend: stages.revision.backend,
            model: stages.revision.model,
            source: 'explicit',
          },
        },
        flags: extractFlagsForDryRun(flags),
      },
    };
  }
  
  const config: DeepConfig = {
    session: flags.session!,
    prompt: parsed.prompt!,
    k: flags.k ?? (stages.solver.mode === 'listed' ? stages.solver.slots.length : 6),
    categories: flags.categories,
    modules: flags.modules,
    uniform: flags.uniform,
    lowCountModules: flags.lowCountModules,
    context: constructContextConfig(flags),
    output: constructOutputConfig(flags),
    verify: resolveVerifyConfig(flags),
    stages,
    trace: flags.trace,
    notify: flags.notify ?? globalConfig.notify ?? true,
    notifySound: flags.notifySound ?? globalConfig.notifySound,
  };
  
  return { command: 'prompt', mode: 'deep', config };
}

function constructResumeInput(
  parsed: ParsedPositionals,
  flags: RawFlags,
  globalConfig: Awaited<ReturnType<typeof loadGlobalConfig>>
): VedaInput {
  // Handle --dry-run
  if (flags.dryRun) {
    return {
      command: 'dry-run',
      resolved: {
        command: 'resume',
        session: flags.session!,
        backend: { backend: '(from saved session)', model: flags.model ?? '(from saved session)', source: 'explicit' },
        flags: extractFlagsForDryRun(flags),
      },
    };
  }
  
  const config: ResumeConfig = {
    session: flags.session!,
    prompt: parsed.prompt,
    model: flags.model,
    persona: flags.persona,
    reasoning: flags.reasoning as ResumeConfig['reasoning'],
    sandbox: flags.sandbox as ResumeConfig['sandbox'],
    noTools: flags.noTools || undefined,
    tools: flags.tools,
    output: constructOutputConfig(flags),
    notify: flags.notify ?? globalConfig.notify ?? true,
    notifySound: flags.notifySound ?? globalConfig.notifySound,
  };
  
  return { command: 'resume', config };
}

// =============================================================================
// Helper Functions
// =============================================================================

function constructContextConfig(flags: RawFlags): ContextConfig {
  return {
    useSelection: !flags.noSel,
    adhocFiles: flags.files,
  };
}

function constructOutputConfig(flags: RawFlags): OutputConfig {
  if (flags.output) {
    return { format: 'file', path: flags.output };
  }
  if (flags.json) {
    return { format: 'json' };
  }
  return { format: 'text' };
}

function extractFlagsForDryRun(flags: RawFlags): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  // Only include non-default values
  if (flags.persona) result.persona = flags.persona;
  if (flags.reasoning) result.reasoning = flags.reasoning;
  if (flags.sandbox) result.sandbox = flags.sandbox;
  if (flags.noTools) result.noTools = true;
  if (flags.tools) result.tools = flags.tools;
  if (flags.files.length > 0) result.files = flags.files;
  if (flags.noSel) result.noSel = true;
  if (flags.output) result.output = flags.output;
  if (flags.json) result.json = true;
  if (flags.notify !== undefined) result.notify = flags.notify;
  if (flags.notifySound) result.notifySound = flags.notifySound;
  if (flags.k !== undefined) result.k = flags.k;
  if (flags.categories) result.categories = flags.categories;
  if (flags.modules) result.modules = flags.modules;
  if (flags.noVerify) result.noVerify = true;
  if (flags.verify) result.verify = true;
  if (flags.forceVerify) result.forceVerify = true;
  if (flags.trace) result.trace = flags.trace;
  if (flags.distributeSolvers) result.distributeSolvers = true;
  if (flags.solverBackends) result.solverBackends = flags.solverBackends;
  if (flags.solverModels) result.solverModels = flags.solverModels;
  if (flags.uniform) result.uniform = true;
  if (flags.lowCountModules) result.lowCountModules = true;
  
  return result;
}

function constructStatsInput(flags: RawFlags): VedaInput {
  // Determine groupBy mode from flags (--module is default)
  let groupBy: StatsGroupBy = 'module';
  if (flags.statsCategory) groupBy = 'category';
  else if (flags.statsModel) groupBy = 'model';
  else if (flags.statsJudge) groupBy = 'judge';
  // --module is already the default

  const config: StatsConfig = {
    groupBy,
    limit: flags.limit ?? 20,
    json: flags.json,
    era: flags.era ?? 'current',
  };

  return { command: 'stats', config };
}

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * Legacy parseArgs for backward compatibility.
 * @deprecated Use parseAndValidate instead.
 */
export { parseArgs, showHelp, showVersion } from '../cli';
