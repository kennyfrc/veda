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
  // Get defaults and global config
  const defaults = await getDefaults();
  const globalConfig = await loadGlobalConfig();
  
  // Resolve backend and model together (supports model aliases)
  // This enables `-m opus` (without -b) to auto-select claude-code backend
  const resolved = resolveBackendModel({
    explicitBackend: options.backend,
    explicitModel: options.model,
    fallbackBackend: defaults.backend,
    globalConfig,
  });
  
  const backendName = resolved.backend;
  
  // Check backend availability
  if (!await isBackendAvailable(backendName)) {
    console.error(`Backend '${backendName}' is not available. Is it installed?`);
    process.exit(1);
  }
  
  // Resolve agent config with the resolved backend/model
  const config = await resolveAgentConfig(
    {
      persona: options.persona,
      model: resolved.model,  // Use resolved model (may be from alias)
      reasoning: options.reasoning,
      sandbox: options.sandbox,
      backend: backendName,
    },
    defaults,
    globalConfig
  );
  
  // Build context from selection (unless --no-sel)
  let context: string | undefined;
  if (!options.noSel) {
    const contextStore = new ContextStore({ sessionId: options.session });
    const entries = await contextStore.list();
    
    if (entries.length > 0) {
      // serialize() is best-effort and non-throwing
      context = await contextStore.serialize();
    }
  }
  
  // Add ad-hoc files if provided
  if (options.files && options.files.length > 0) {
    const adhocContext = await buildAdhocContext(options.files);
    context = context ? `${context}\n\n${adhocContext}` : adhocContext;
  }
  
  // Run the prompt using core/llm primitive
  const response = await runLlm({
    backend: backendName,
    prompt,
    context,
    systemPrompt: config.systemPrompt,
    model: config.model,
    reasoning: config.reasoning,
    sandbox: config.sandbox,
  });
  
  // Save thread ID for resume
  if (response.sessionId) {
    const conversationStore = new ConversationStore({ sessionId: options.session });
    await conversationStore.save({
      backend: backendName,
      threadId: response.sessionId,
    });
  }
  
  // Check for backend errors
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
  
  // Output
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

  // Notify on completion
  if (options.notify ?? globalConfig.notify ?? true) {
    const { notify } = await import('../util/notify');
    notify({ title: 'Veda', message: 'Response complete' });
  }
}

/**
 * Build context from ad-hoc files.
 * Uses the same format as ContextStore.serialize().
 */
async function buildAdhocContext(files: string[]): Promise<string> {
  const cwd = process.cwd();
  const results = [];
  
  for (const path of files) {
    const slice = parseSlice(path);
    const absolutePath = resolve(cwd, slice.path);
    
    const result = await readSliceText({
      cwd,
      slice: { ...slice, path: absolutePath },
    });
    
    if (result) {
      results.push(result);
    }
  }
  
  return serializeAllFileContextBlocks(results);
}
