import { ContextStore, readSliceText, serializeAllFileContextBlocks } from '../context';
import { parseSlice } from '../context/slice';
import { runLlm, isBackendAvailable } from '../core';
import { getDefaults, resolveAgentConfig, loadGlobalConfig, resolveBackendModel } from '../agent';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { resolve } from 'path';

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
  
  const response = await runLlm({
    backend: backendName,
    prompt,
    context,
    systemPrompt: config.systemPrompt,
    model: config.model,
    reasoning: config.reasoning,
    sandbox: config.sandbox,
    cwd: process.cwd(),
  });
  
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
  
  if (options.output) {
    await Bun.write(options.output, response.text);
    console.error(`Response saved to ${options.output}`);
    if (response.usage) {
      console.error(`Tokens: ${response.usage.inputTokens} in, ${response.usage.outputTokens} out`);
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
    notify({ title: 'Veda', message: formatNotifyMessage(prompt), subtitle: options.session, backend: backendName, model: resolved.model });
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
