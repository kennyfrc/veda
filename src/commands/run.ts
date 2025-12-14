/**
 * Main prompt execution command.
 */

import { ContextStore, readSliceText, serializeAllFileContextBlocks } from '../context';
import { parseSlice } from '../context/slice';
import { getBackend, extractText, getSessionId, getUsage, collectMessages } from '../backend';
import { getDefaults, resolveAgentConfig } from '../agent';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { resolve } from 'path';

export async function handleRun(
  prompt: string,
  options: CliOptions
): Promise<void> {
  // Get defaults
  const defaults = await getDefaults();
  
  // Resolve backend
  const backendName = options.backend ?? defaults.backend;
  const backend = getBackend(backendName);
  
  // Check backend availability
  if (!await backend.isAvailable()) {
    console.error(`Backend '${backendName}' is not available. Is it installed?`);
    process.exit(1);
  }
  
  // Resolve agent config
  const config = await resolveAgentConfig(
    {
      persona: options.persona,
      model: options.model,
      reasoning: options.reasoning,
      sandbox: options.sandbox,
    },
    defaults
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
  
  // Run the prompt
  const messages = await collectMessages(
    backend.run({
      prompt,
      context,
      config,
    })
  );
  
  // Extract results
  const text = extractText(messages);
  const sessionId = getSessionId(messages);
  const usage = getUsage(messages);
  
  // Save thread ID for resume
  if (sessionId) {
    const conversationStore = new ConversationStore({ sessionId: options.session });
    await conversationStore.save({
      backend: backendName,
      threadId: sessionId,
    });
  }
  
  // Output
  if (options.output) {
    await Bun.write(options.output, text);
    console.error(`Response saved to ${options.output}`);
    if (usage) {
      console.error(`Tokens: ${usage.inputTokens} in, ${usage.outputTokens} out`);
    }
  } else if (options.json) {
    console.log(JSON.stringify({ text, sessionId, usage }, null, 2));
  } else {
    console.log(text);
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
