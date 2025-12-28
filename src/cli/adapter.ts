/**
 * Adapter functions to convert new discriminated union types to legacy CliOptions.
 * This enables gradual migration of command handlers.
 */

import type { CliOptions } from '../cli';
import type { 
  SimpleConfig, 
  DeepConfig, 
  ResumeConfig,
  OutputConfig,
} from './types';

/**
 * Convert SimpleConfig to legacy CliOptions.
 */
export function simpleConfigToCliOptions(config: SimpleConfig): CliOptions {
  return {
    session: config.session,
    backend: config.backend,
    model: config.model,
    persona: config.persona,
    reasoning: config.reasoning,
    sandbox: config.sandbox,
    files: config.context.adhocFiles,
    noSel: !config.context.useSelection,
    output: outputConfigToPath(config.output),
    json: config.output.format === 'json',
    notify: config.notify,
    // Deep mode flags are not applicable
    deep: false,
    noVerify: false,
    forceVerify: false,
    distributeSolvers: undefined,
    help: false,
    version: false,
  };
}

/**
 * Convert DeepConfig to legacy CliOptions.
 */
export function deepConfigToCliOptions(config: DeepConfig): CliOptions {
  const options: CliOptions = {
    session: config.session,
    files: config.context.adhocFiles,
    noSel: !config.context.useSelection,
    output: outputConfigToPath(config.output),
    json: config.output.format === 'json',
    notify: config.notify,
    deep: true,
    k: config.k,
    trace: config.trace,
    noVerify: !config.verify.enabled,
    forceVerify: config.verify.enabled && config.verify.forced,
    help: false,
    version: false,
    distributeSolvers: undefined,
  };

  // Handle solver config
  if (config.stages.solver.mode === 'fixed') {
    options.solverBackend = config.stages.solver.backend;
    options.solverModel = config.stages.solver.model;
  } else {
    options.distributeSolvers = true;
    options.solverBackends = config.stages.solver.backends;
    // For distributed mode, pass the first backend's model as solverModel
    // This is used for notifications and as default for backend model resolution
    const firstBackend = config.stages.solver.backends[0];
    if (firstBackend && config.stages.solver.modelPerBackend.has(firstBackend)) {
      options.solverModel = config.stages.solver.modelPerBackend.get(firstBackend);
    }
  }

  // Handle judge config
  options.judgeBackend = config.stages.judge.backend;
  options.judgeModel = config.stages.judge.model;

  // Handle verifier config
  options.verifierBackend = config.stages.verifier.backend;
  options.verifierModel = config.stages.verifier.model;

  // Handle revision config
  options.revisionBackend = config.stages.revision.backend;
  options.revisionModel = config.stages.revision.model;

  return options;
}

/**
 * Convert ResumeConfig to legacy CliOptions.
 */
export function resumeConfigToCliOptions(config: ResumeConfig): CliOptions {
  return {
    session: config.session,
    model: config.model,
    persona: config.persona,
    reasoning: config.reasoning,
    sandbox: config.sandbox,
    output: outputConfigToPath(config.output),
    json: config.output.format === 'json',
    notify: config.notify,
    // Not applicable to resume
    deep: false,
    noVerify: false,
    forceVerify: false,
    distributeSolvers: undefined,
    noSel: false,
    files: [],
    help: false,
    version: false,
  };
}

function outputConfigToPath(output: OutputConfig): string | undefined {
  return output.format === 'file' ? output.path : undefined;
}
