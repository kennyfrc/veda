import { ContextStore, readSliceText, serializeAllFileContextBlocks } from '../context';
import { parseSlice } from '../context/slice';
import { runLlm, isBackendAvailable } from '../core';
import { getDefaults, loadGlobalConfig, resolveBackendModel } from '../agent/config';
import { resolveAgentConfig } from '../agent/persona';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import type { Message } from '../backend';
import { resolve } from 'path';
import { formatUsageStats, formatChatHeader, formatChatToolEvent, formatChatComplete, saveResponseYaml, c } from '../util';

export async function handleRun(
  prompt: string,
  options: CliOptions
): Promise<void> {
  const defaults = await getDefaults();
  const globalConfig = await loadGlobalConfig();
  
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
  
  // Show progress unless --json mode
  const showProgress = !options.json;
  
  // Always emit header at start
  if (showProgress) {
    console.error(formatChatHeader(options.persona, backendName, config.model));
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
    console.error(formatChatComplete(response.usage?.inputTokens, response.usage?.outputTokens));
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
    }, null, 2));
  } else {
    console.log(response.text);
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
