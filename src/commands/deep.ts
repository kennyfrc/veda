import { ContextStore, readSliceText, parseSlice } from '../context';
import { runDeepThink, getDeepThinkStages, type DeepThinkEvent, type DeepThinkResult } from '../pipelines';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { stringify as yamlStringify } from 'yaml';
import { resolve } from 'path';
import { loadGlobalConfig, resolveBackendModel } from '../agent';
import { formatUsageStats } from '../util';

/**
 * Select solver backends deterministically based on options.
 *
 * Precedence:
 * 1. If options.solverBackend is set, use it for all solvers.
 * 2. If options.distributeSolvers is true:
 *    - Use options.solverBackends if provided, otherwise use available backends.
 *    - Distribute k backends in round-robin order (even distribution).
 * 3. Otherwise, use baseBackend (inherited from resolved base backend), or fallback to 'codex'.
 */
export async function selectSolverBackends(options: {
  k: number;
  distributeSolvers?: boolean;
  solverBackend?: string;
  solverBackends?: string[];
  baseBackend?: string;
}): Promise<{ backends: string[]; mode: 'fixed' | 'distributed' }> {
  const { k, distributeSolvers, solverBackend, solverBackends, baseBackend } = options;

  // Validate k bounds (defensive, in addition to CLI validation)
  if (k < 1 || k > 8) {
    throw new Error(`k must be between 1 and 8, got ${k}`);
  }

  // Precedence 1: Explicit single backend override
  if (solverBackend) {
    return {
      backends: Array(k).fill(solverBackend),
      mode: 'fixed',
    };
  }

  // Precedence 2: Round-robin distribution
  if (distributeSolvers) {
    const candidates = await resolveCandidates(solverBackends);

    // Round-robin distribution: cycle through candidates k times
    const selected: string[] = [];
    const n = candidates.length;
    for (let i = 0; i < k; i++) {
      selected.push(candidates[i % n]);
    }

    return {
      backends: selected,
      mode: 'distributed',
    };
  }

  // Precedence 3: Fixed single backend (default behavior)
  // Use baseBackend if nothing specified, fallback to 'codex'
  const fallbackBackend = baseBackend ?? 'codex';
  return {
    backends: Array(k).fill(fallbackBackend),
    mode: 'fixed',
  };
}

/**
 * Resolve candidate backends for distribution.
 *
 * Uses explicit user list if provided, otherwise gets available backends.
 * Performs validation against registered backends and normalizes names.
 */
async function resolveCandidates(userBackends?: string[]): Promise<string[]> {
  const { listBackends, getAvailableBackends } = await import('../backend');
  const registeredBackends = listBackends();

  let candidates: string[];

  if (userBackends && userBackends.length > 0) {
    // User provided explicit list
    candidates = userBackends
      .map(name => name.trim())
      .filter(name => name.length > 0)
      .map(name => name.toLowerCase());

    // Deduplicate
    candidates = Array.from(new Set(candidates));

    // Sort for determinism
    candidates.sort();

    // Validate: check if flag resolved to empty after filtering
    if (candidates.length === 0) {
      throw new Error('No backends specified in --solver-backends. Provide at least one backend or remove the flag.');
    }

    // Validate: check against registered backends (case-insensitive)
    const registeredLower = registeredBackends.map(b => b.toLowerCase());
    const unknown = candidates.filter(c => !registeredLower.includes(c));
    if (unknown.length > 0) {
      throw new Error(`Unknown backend(s): ${unknown.join(', ')}. Available: ${registeredBackends.join(', ')}`);
    }

    // Optional: warn about unavailable backends (but don't throw)
    const available = await getAvailableBackends();
    const unavailable = candidates.filter(c => !available.includes(c));
    if (unavailable.length > 0) {
      console.error(`[warning] Backend(s) ${unavailable.join(', ')} are registered but not available. Check configuration.`);
    }
  } else {
    // Use available backends from registry
    candidates = await getAvailableBackends();
    candidates.sort();

    if (candidates.length === 0) {
      throw new Error('No backends available for distribution. Install/configure at least one backend or use --solver-backend.');
    }
  }

  return candidates;
}

export async function handleDeep(
  prompt: string,
  options: CliOptions
): Promise<void> {
  const globalConfig = await loadGlobalConfig();

  // Build context from selection (unless --no-sel)
  let context: string | undefined;
  if (!options.noSel) {
    const contextStore = new ContextStore({ sessionId: options.session });
    const entries = await contextStore.list();

    if (entries.length > 0) {
      context = await buildContext(contextStore);
    }
  }

  // Add ad-hoc files if provided
  if (options.files && options.files.length > 0) {
    const adhocContext = await buildAdhocContext(options.files);
    context = context ? `${context}\n\n${adhocContext}` : adhocContext;
  }

  console.error('[deep] Starting deep thinking mode...\n');

  // Resolve backend/model for notifications upfront
  // These values are used for notifications throughout the pipeline
  const base = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: options.backend ?? globalConfig.backend,
    globalConfig,
  });

  // Handle solver backend selection (potentially distributed)
  const solverBackendsResult = await selectSolverBackends({
    k: options.k ?? 4,
    distributeSolvers: options.distributeSolvers,
    solverBackend: options.solverBackend,
    solverBackends: options.solverBackends,
    baseBackend: base.backend,
  });

  // Log distribution mode (only when multiple backends)
  if (solverBackendsResult.mode === 'distributed') {
    const uniqueBackends = new Set(solverBackendsResult.backends);
    if (uniqueBackends.size > 1) {
      console.error(`[deep] Distributed solver backends (round-robin): ${solverBackendsResult.backends.join(', ')}`);
    }
  }

  // Resolve single backend for notifications (use first if randomized)
  const solverBackendForNotification = solverBackendsResult.backends[0] ?? base.backend;
  const solverModelForNotification = options.solverModel ?? base.model;

  const judge = resolveBackendModel({
    explicitBackend: options.judgeBackend,
    explicitModel: options.judgeModel,
    fallbackBackend: base.backend,
    fallbackModel: base.model,
    globalConfig,
  });

  let finalResult: DeepThinkResult | undefined;

  // Run the pipeline
  for await (const event of runDeepThink(prompt, {
    backend: base.backend,  // Pass resolved backend to avoid duplicate resolution
    model: base.model,  // Pass resolved model to avoid duplicate resolution
    k: options.k,
    verify: !options.noVerify,
    context,
    categories: options.categories,
    modules: options.modules,
    cwd: process.cwd(),
    // Per-stage overrides
    solverBackends: solverBackendsResult.backends,
    solverModel: options.solverModel,
    judgeBackend: options.judgeBackend,
    judgeModel: options.judgeModel,
    verifierBackend: options.verifierBackend,
    verifierModel: options.verifierModel,
  })) {
    await handleEvent(event, options, prompt, globalConfig.notify, solverBackendForNotification, solverModelForNotification, judge.backend, judge.model);

    // Capture final result for trace
    if (event.type === 'complete' && event.result) {
      finalResult = event.result;
    }
  }

  // Write trace if requested
  if (options.trace && finalResult?.trace) {
    await writeTrace(options.trace, finalResult);
  }

  // Persist session for resumability
  if (finalResult?.sessionId && finalResult?.sessionBackend) {
    const conversationStore = new ConversationStore({ sessionId: options.session });
    await conversationStore.save({
      backend: finalResult.sessionBackend,
      threadId: finalResult.sessionId,
    });
  } else if (!finalResult?.sessionId) {
    // Log warning if backend doesn't support sessions
    const stageName = finalResult?.wasRevised ? 'verifier' : 'judge';
    const backendName = finalResult?.sessionBackend ?? options.backend ?? 'unknown';
    console.error(`[warn] Backend '${backendName}' (${stageName}) does not support resumability (no sessionId returned)`);  }
}

async function handleEvent(
  event: DeepThinkEvent,
  options: CliOptions,
  prompt: string,
  globalNotify?: boolean,
  solverBackend?: string,
  solverModel?: string,
  judgeBackend?: string,
  judgeModel?: string
): Promise<void> {
  const shouldNotify = options.notify ?? globalNotify ?? true;

  switch (event.type) {
    case 'ensemble_complete':
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Solvers complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend: solverBackend, model: solverModel }));
      }
      break;

    case 'solver_complete': {
      // ID format: solver-${i}-${category}
      const parts = event.source?.split('-') || [];
      const name = parts.length >= 3 ? parts.slice(2).join('-') : (event.source || 'unknown');

      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Solver '${name}' complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend: solverBackend, model: solverModel }));
      }
      if (event.usage) {
        console.error(`  [solve] Solver '${name}' complete (${formatUsageStats(event.usage)})`);
      } else {
        console.error(`  [solve] Solver '${name}' complete`);
      }
      break;
    }

    case 'stage_start':
      console.error(`[${event.stage}] Starting...`);
      break;

    case 'tool_start':
      // Show tool execution progress
      console.error(`  [${event.source}] → ${formatToolStart(event.content, event.toolInput)}`);
      break;

    case 'candidate':
      console.error(`  ${event.content}`);
      break;

    case 'selected':
      console.error(`\n[${event.stage}] Selected answer (confidence: ${((event.confidence ?? 0) * 100).toFixed(0)}%)`);
      break;

    case 'stage_complete':
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) => {
          const msg = event.stage === 'solve' ? 'Judge complete' : 'Verifier complete';
          const backend = event.stage === 'solve' ? judgeBackend : undefined;
          const model = event.stage === 'solve' ? judgeModel : undefined;
          notify({ title: 'Veda Deep', message: `${msg}: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend, model });
        });
      }
      if (event.usage) {
        console.error(`[${event.stage}] Complete (${formatUsageStats(event.usage)})`);
      } else {
        console.error(`[${event.stage}] Complete`);
      }
      break;

    case 'verified':
      console.error(`[verify] ${event.content}`);
      break;

    case 'error':
      console.error(`Error: ${event.content}`);
      process.exit(1);
      break;

    case 'complete':
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) =>
          notify({ title: 'Veda Deep', message: `Complete: ${formatNotifyMessage(prompt)}`, subtitle: options.session, backend: solverBackend, model: solverModel }));
      }
      if (event.result) {
        const stages = getDeepThinkStages(event.result.trace);
        console.error(`\n[complete] Stages: ${stages.join(' → ')}`);
        console.error(`[complete] Confidence: ${(event.result.confidence * 100).toFixed(0)}%`);
        if (event.result.wasRevised) {
          console.error('[complete] Answer was revised by verification');
        }
        console.error(`[complete] ${formatUsageStats(event.result.usage)}`);
        console.error('');

        // Output final answer
        if (options.output) {
          Bun.write(options.output, event.result.answer);
          console.error(`Response saved to ${options.output}`);
        } else if (options.json) {
          console.log(JSON.stringify(event.result, null, 2));
        } else {
          // Flush stderr before writing stdout to maintain output order
          // Write empty string to stderr and await callback to ensure buffer flushes
          await new Promise<void>((resolve) => {
            process.stderr.write('', () => resolve());
          });
          console.log(event.result.answer);
        }
      }
      break;
  }
}

/**
 * Format a tool_start event for display.
 */
function formatToolStart(toolName?: string, toolInput?: unknown): string {
  if (!toolName) return 'tool call';
  
  // Format based on tool type
  if (toolName === 'shell' && toolInput && typeof toolInput === 'object') {
    const input = toolInput as { command?: string };
    const cmd = input.command ?? '';
    // Truncate long commands
    const displayCmd = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    return `shell: ${displayCmd}`;
  }
  
  if (toolName === 'file_change') {
    return 'file change';
  }
  
  if (toolName.startsWith('mcp:')) {
    return toolName;
  }
  
  return toolName;
}

async function buildContext(store: ContextStore): Promise<string> {
  const cwd = process.cwd();
  const entries = await store.list();
  
  const results = await Promise.all(
    entries.map(entry => readSliceText({
      cwd,
      slice: entry.slice,
    }))
  );

  const parts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const res = results[i];
    
    if (res.ok) {
      parts.push(`## ${entry.original}\n\`\`\`\n${res.value.content}\n\`\`\``);
    }
  }
  
  return parts.join('\n\n');
}

async function buildAdhocContext(files: string[]): Promise<string> {
  const cwd = process.cwd();
  
  const results = await Promise.all(
    files.map(path => {
      const slice = parseSlice(path);
      const absolutePath = resolve(cwd, slice.path);
      return readSliceText({
        cwd,
        slice: { ...slice, path: absolutePath },
      });
    })
  );

  const parts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    const res = results[i];
    
    if (res.ok) {
      parts.push(`## ${path}\n\`\`\`\n${res.value.content}\n\`\`\``);
    }
  }
  
  return parts.join('\n\n');
}

/**
 * Write trace to YAML file.
 */
async function writeTrace(path: string, result: DeepThinkResult): Promise<void> {
  if (!result.trace) return;

  const trace = result.trace;
  const stages = getDeepThinkStages(trace);

  // Build YAML-friendly trace document
  const doc = {
    trace_version: 1,
    run: {
      timestamp: new Date().toISOString(),
      confidence: result.confidence,
      was_revised: result.wasRevised,
      stages: stages,
    },
    prompt: trace.prompt,
    ...(trace.context && { context: trace.context }),
    options: trace.options,
    solve: {
      candidates: trace.solve.candidates.map(c => ({
        id: c.id,
        module: c.module,
        response: c.response,
      })),
    },
    judge: {
      selected_index: trace.judge.selectedIndex,
      confidence: trace.judge.confidence,
      ...(trace.judge.reasoning && { reasoning: trace.judge.reasoning }),
    },
    ...(trace.verify && {
      verify: {
        checks: trace.verify.checks,
        results: trace.verify.results,
        ...(trace.verify.revision && { revision: trace.verify.revision }),
      },
    }),
    final: {
      answer: result.answer,
    },
    usage: {
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
    },
  };

  try {
    const yaml = yamlStringify(doc, {
      lineWidth: 120,
      defaultKeyType: 'PLAIN',
      blockQuote: 'literal',
      // Use block style for long strings, flow for short
      collectionStyle: 'block',
    });
    await Bun.write(path, yaml);
    console.error(`[trace] Saved to ${path}`);
  } catch (error) {
    console.error(`[trace] Warning: failed to write trace to ${path}: ${error instanceof Error ? error.message : error}`);
  }
}
