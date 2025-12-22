import { ContextStore, readSliceText, parseSlice } from '../context';
import { runDeepThink, type DeepThinkEvent, type DeepThinkResult } from '../pipelines';
import type { CliOptions } from '../cli';
import { stringify as yamlStringify } from 'yaml';
import { resolve } from 'path';
import { loadGlobalConfig } from '../agent';

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
  
  let finalResult: DeepThinkResult | undefined;
  
  // Run the pipeline
  for await (const event of runDeepThink(prompt, {
    backend: options.backend,
    model: options.model,  // Pass model override (if any)
    k: options.k,
    verify: !options.noVerify,
    context,
    categories: options.categories,
    modules: options.modules,
    cwd: process.cwd(),
    // Per-stage overrides
    solverBackend: options.solverBackend,
    solverModel: options.solverModel,
    judgeBackend: options.judgeBackend,
    judgeModel: options.judgeModel,
    verifierBackend: options.verifierBackend,
    verifierModel: options.verifierModel,
  })) {
    handleEvent(event, options, prompt, globalConfig.notify);
    
    // Capture final result for trace
    if (event.type === 'complete' && event.result) {
      finalResult = event.result;
    }
  }
  
  // Write trace if requested
  if (options.trace && finalResult?.trace) {
    await writeTrace(options.trace, finalResult);
  }
}

function handleEvent(event: DeepThinkEvent, options: CliOptions, prompt: string, globalNotify?: boolean): void {
  const shouldNotify = options.notify ?? globalNotify ?? true;

  switch (event.type) {
    case 'ensemble_complete':
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) => 
          notify({ title: 'Veda Deep', message: `Solvers complete: ${formatNotifyMessage(prompt)}`, session: options.session }));
      }
      break;

    case 'solver_complete': {
      // ID format: solver-${i}-${category}
      const parts = event.source?.split('-') || [];
      const name = parts.length >= 3 ? parts.slice(2).join('-') : (event.source || 'unknown');
      
      if (shouldNotify) {
        import('../util/notify').then(({ notify, formatNotifyMessage }) => 
          notify({ title: 'Veda Deep', message: `Solver '${name}' complete: ${formatNotifyMessage(prompt)}`, session: options.session }));
      }
      if (event.usage) {
        const tokens = event.usage.inputTokens + event.usage.outputTokens;
        console.error(`  [solve] Solver '${name}' complete (${tokens} tokens)`);
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
          notify({ title: 'Veda Deep', message: `${msg}: ${formatNotifyMessage(prompt)}`, session: options.session });
        });
      }
      if (event.usage) {
        console.error(`[${event.stage}] Complete (${event.usage.inputTokens + event.usage.outputTokens} tokens)`);
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
          notify({ title: 'Veda Deep', message: `Complete: ${formatNotifyMessage(prompt)}`, session: options.session }));
      }
      if (event.result) {
        console.error(`\n[complete] Stages: ${event.result.stages.join(' → ')}`);
        console.error(`[complete] Confidence: ${(event.result.confidence * 100).toFixed(0)}%`);
        if (event.result.wasRevised) {
          console.error('[complete] Answer was revised by verification');
        }
        console.error(`[complete] Total tokens: ${event.result.usage.inputTokens + event.result.usage.outputTokens}`);
        console.error('');
        
        // Output final answer
        if (options.output) {
          Bun.write(options.output, event.result.answer);
          console.error(`Response saved to ${options.output}`);
        } else if (options.json) {
          console.log(JSON.stringify(event.result, null, 2));
        } else {
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
  
  // Build YAML-friendly trace document
  const doc = {
    trace_version: 1,
    run: {
      timestamp: new Date().toISOString(),
      confidence: result.confidence,
      was_revised: result.wasRevised,
      stages: result.stages,
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
