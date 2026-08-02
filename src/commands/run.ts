import { ContextStore, readSliceText, serializeAllFileContextBlocks } from '../context';
import { parseSlice } from '../context/slice';
import { runLlm, isBackendAvailable } from '../core';
import { getDefaults, loadGlobalConfig, resolveBackendModel } from '../agent/config';
import { resolveAgentConfig } from '../agent/persona';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import type { Message } from '../backend';
import { resolve } from 'path';
import { formatUsageStats, formatChatHeader, formatChatToolEvent, formatChatComplete, saveResponseYaml, saveWorkerReport, parseWorkerReport, type WorkerReport, c } from '../util';

export async function handleRun(
  prompt: string,
  options: CliOptions
): Promise<void> {
  const defaults = await getDefaults();
  const globalConfig = await loadGlobalConfig();
  const personaName = options.persona ?? defaults.persona;
  const isWorker = personaName === 'worker';
  
  // supports model aliases: `-m opus` auto-selects claude-code backend
  const resolved = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: options.backend ?? globalConfig.backend,
    globalConfig,
  });
  
  const backendName = resolved.backend;
  
  if (!await isBackendAvailable(backendName)) {
    console.error(`Backend '${backendName}' is not available. Is it installed?`);
    process.exit(1);
  }
  
  const config = await resolveAgentConfig(
    {
      persona: options.persona,
      model: resolved.model,
      reasoning: options.reasoning,
      sandbox: options.sandbox,
      backend: backendName,
      noTools: options.noTools,
      tools: options.tools,
      aliasReasoning: resolved.aliasReasoning,
    },
    defaults,
    globalConfig
  );
  
  let context: string | undefined;
  if (!options.noSel) {
    const contextStore = new ContextStore({ sessionId: options.session });
    const entries = await contextStore.list();
    
    if (entries.length > 0) {
      context = await contextStore.serialize();
    }
  }
  
  if (options.files && options.files.length > 0) {
    const adhocContext = await buildAdhocContext(options.files);
    context = context ? `${context}\n\n${adhocContext}` : adhocContext;
  }
  
  // Program-design auto-attach: when the verifier or worker persona runs and a
  // design.json exists for this session, append it as context. The verifier uses
  // it to check implementation against the design's signatures/invariants; the
  // worker uses it as the contract it implements. (The veda-worker skill relies
  // on this — the worker must not guess the design contents or path.)
  if (personaName === 'verifier' || personaName === 'worker') {
    const { getSessionDir } = await import('../util/paths');
    const { existsSync, readFileSync } = await import('fs');
    const designPath = `${getSessionDir(options.session)}/design.json`;
    if (existsSync(designPath)) {
      const designContext = `<program_design src="${designPath}">
${readFileSync(designPath, 'utf-8')}
</program_design>

${
  personaName === 'worker'
    ? 'This is the program design you must implement — read it and treat it as the contract (do not guess or approximate it).'
    : 'Check the implementation against this design\'s signatures, call stacks, and invariants.'
}`;
      context = context ? `${context}\n\n${designContext}` : designContext;
    }
  }
  
  // Show progress unless --json mode
  const showProgress = !options.json;
  
  // Always emit header at start. The worker is the first write-capable
  // persona, so its header must display the sandbox mode (workspace-write)
  // before the run starts — the blast-radius change is visible up front.
  if (showProgress) {
    console.error(formatChatHeader(
      options.persona,
      backendName,
      config.model,
      undefined,
      isWorker ? config.sandbox : undefined
    ));
  }
  
  const onMessage = showProgress ? (msg: Message) => {
    // Handle both tool_start (codex) and tool_use (claude) events
    const isToolEvent = msg.type === 'tool_start' || msg.type === 'tool_use';
    
    // Show tool events
    if (isToolEvent && msg.toolName) {
      console.error(formatChatToolEvent(msg.toolName, msg.toolInput));
    }
  } : undefined;
  
  const response = await runLlm({
    backend: backendName,
    prompt,
    context,
    systemPrompt: config.systemPrompt,
    model: config.model,
    reasoning: config.reasoning,
    sandbox: config.sandbox,
    tools: config.tools,
    cwd: process.cwd(),
    onMessage,
  });
  
  // Emit completion summary
  if (showProgress) {
    console.error(formatChatComplete(
      response.usage?.inputTokens,
      response.usage?.outputTokens,
      isWorker ? config.sandbox : undefined
    ));
    console.error('');  // Blank line before response
  }
  
  if (response.sessionId) {
    const conversationStore = new ConversationStore({ sessionId: options.session });
    await conversationStore.save({
      backend: backendName,
      threadId: response.sessionId,
    });
  }
  
  if (response.errors.length > 0) {
    if (options.json) {
      console.log(JSON.stringify({
        text: response.text,
        error: response.errors.join('\n'),
        sessionId: response.sessionId,
        usage: response.usage,
      }, null, 2));
    } else {
      for (const err of response.errors) {
        console.error(`Error: ${err}`);
      }
    }
    process.exit(1);
  }
  
  // Save full response to YAML (stdout may truncate long responses)
  let responsePath: string | undefined;
  if (!options.json) {
    responsePath = await saveResponseYaml({
      session: options.session,
      persona: options.persona,
      backend: backendName,
      model: config.model,
      prompt,
      response: response.text,
      usage: response.usage,
    });
  }

  // Emit the saved path BEFORE the body so it's always visible even when
  // stdout truncates the response (long responses get cut off mid-sentence).
  if (responsePath) {
    console.error(`${c.dim('[response]')} ${c.cyan(responsePath)}`);
  }

  // Program-design protocol: when the navigator-design persona responds,
  // parse and validate any <program> block, then write artifacts to the
  // session dir for the caller (pi, a human, another agent) to implement.
  // Veda stays read-only — this only writes to the session dir, never the repo.
  let designResult: { ok: boolean; path?: string; errors?: string[] } | undefined;
  if (personaName === 'navigator-plan') {
    const { parseProgramDesign, validateDesign, writeDesign } =
      await import('../core/design');
    const parseResult = parseProgramDesign(response.text);
    if (parseResult.ok) {
      const validation = validateDesign(parseResult.design);
      if (validation.ok) {
        const paths = await writeDesign(parseResult.design, validation, options.session);
        designResult = { ok: true, path: paths.xml, errors: [] };
        if (!options.json) {
          console.error(`${c.dim('[design]')} ${c.cyan(paths.xml)}`);
          console.error(`${c.dim('[design]')} ${c.cyan(paths.json)}`);
        }
      } else {
        // Validation failure: print errors, write nothing, exit nonzero.
        const errorMessages = validation.errors.map(e => `[${e.kind}] ${e.message}`);
        if (options.json) {
          console.log(JSON.stringify({
            text: response.text,
            sessionId: response.sessionId,
            usage: response.usage,
            design: { ok: false, errors: errorMessages },
          }, null, 2));
        } else {
          console.error(`${c.red('[design]')} validation failed:`);
          for (const msg of errorMessages) {
            console.error(`  ${c.red(msg)}`);
          }
        }
        process.exit(1);
      }
    } else {
      // No <program> block is a hard failure for this persona.
      if (options.json) {
        console.log(JSON.stringify({
          text: response.text,
          sessionId: response.sessionId,
          usage: response.usage,
          design: { ok: false, errors: ['no <program> block found in response'] },
        }, null, 2));
      } else {
        console.error(`${c.red('[design]')} no <program> block found in response`);
      }
      process.exit(1);
    }
  }

  // Worker protocol: the worker persona's final message MUST be a single
  // <worker_report> block. Parse it, persist report.yaml, and apply the
  // §7 parse-failure ladder:
  //   well-formed            → persist + echo block, exit 0 (even if status
  //                            is failed/blocked — a truthful verdict is a
  //                            successful delegation)
  //   missing required field → persist what parsed, warn to stderr, exit 0
  //   no block / malformed  → protocol error with the tail, exit non-zero
  let workerResult:
    | { ok: true; block: string; report: WorkerReport; path?: string; warnings: string[] }
    | { ok: false; reason: 'no-block' | 'malformed'; detail?: string; tail: string }
    | undefined;
  if (personaName === 'worker') {
    const parsed = parseWorkerReport(response.text);
    if (parsed.ok) {
      const reportPath = await saveWorkerReport({
        session: options.session,
        model: config.model,
        usage: response.usage,
        report: parsed.report,
        block: parsed.block,
      });
      workerResult = {
        ok: true,
        block: parsed.block,
        report: parsed.report,
        path: reportPath,
        warnings: parsed.warnings,
      };
      if (!options.json) {
        console.error(`${c.dim('[report]')} ${c.cyan(reportPath ?? '(failed to write)')}`);
        for (const w of parsed.warnings) {
          console.error(`${c.yellow('report warning:')} ${w}`);
        }
      }
    } else {
      workerResult = parsed;
      if (!options.json) {
        console.error(`${c.red('[worker]')} worker protocol error (${parsed.reason}): no valid <worker_report> block`);
        if (parsed.detail) console.error(`  ${parsed.detail}`);
        console.error(parsed.tail);
      }
    }
  }

  if (options.output) {
    await Bun.write(options.output, response.text);
    console.error(`Response saved to ${options.output}`);
    if (response.usage) {
      console.error(formatUsageStats(response.usage));
    }
  } else if (options.json) {
    console.log(JSON.stringify({
      text: response.text,
      sessionId: response.sessionId,
      usage: response.usage,
      ...(designResult ? { design: designResult } : {}),
      ...(workerResult
        ? workerResult.ok
          ? { worker: { ok: true, status: workerResult.report.status, path: workerResult.path, warnings: workerResult.warnings } }
          : { worker: { ok: false, reason: workerResult.reason, detail: workerResult.detail } }
        : {}),
    }, null, 2));
  } else if (workerResult) {
    // In text mode the <worker_report> block is the only thing on stdout — a
    // Driver can pipe stdout straight into a parser while the trace runs to
    // stderr. On protocol failure nothing is echoed; the error is on stderr.
    if (workerResult.ok) {
      console.log(workerResult.block);
    }
  } else {
    console.log(response.text);
  }

  // Protocol health controls the exit code, not the task outcome: a
  // well-formed report that truthfully says failed/blocked exits 0; a missing
  // or malformed block is a failure of the run itself.
  if (isWorker && workerResult && !workerResult.ok) {
    process.exit(1);
  }

  if (options.notify ?? globalConfig.notify ?? true) {
    const { notify, formatNotifyMessage } = await import('../util/notify');
    notify({
      title: 'Veda',
      message: formatNotifyMessage(prompt),
      subtitle: options.session,
      backend: backendName,
      model: resolved.model,
      sound: options.notifySound ?? globalConfig.notifySound,
    });
  }
}

/**
 * Build context from ad-hoc files using the same format as ContextStore.serialize().
 */
async function buildAdhocContext(files: string[]): Promise<string> {
  const cwd = process.cwd();
  const results = [];
  
  for (const path of files) {
    const slice = parseSlice(path);
    const absolutePath = resolve(cwd, slice.path);
    
    const res = await readSliceText({
      cwd,
      slice: { ...slice, path: absolutePath },
    });
    
    if (res.ok) {
      results.push(res.value);
    }
  }
  
  return serializeAllFileContextBlocks(results);
}
