/**
 * Main prompt execution command.
 */

import { ContextStore } from '../context';
import { getBackend, extractText, getSessionId, getUsage, collectMessages } from '../backend';
import { getDefaults, resolveAgentConfig } from '../agent';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';

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
      try {
        context = await contextStore.serialize();
      } catch (error) {
        // llm_ctx might not be available, build context manually
        context = await buildContextManually(contextStore);
      }
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
 * Build context manually by reading files.
 */
async function buildContextManually(store: ContextStore): Promise<string> {
  const entries = await store.list();
  const parts: string[] = [];
  
  for (const entry of entries) {
    try {
      const file = Bun.file(entry.absolutePath);
      if (await file.exists()) {
        let content = await file.text();
        
        // Apply slice if present
        if (entry.slice.hasSlice) {
          const lines = content.split('\n');
          const start = (entry.slice.start ?? 1) - 1;
          const end = entry.slice.end ?? lines.length;
          content = lines.slice(start, end).join('\n');
        }
        
        parts.push(`## ${entry.original}\n\`\`\`\n${content}\n\`\`\``);
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  return parts.join('\n\n');
}

/**
 * Build context from ad-hoc files.
 */
async function buildAdhocContext(files: string[]): Promise<string> {
  const parts: string[] = [];
  
  for (const path of files) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        const content = await file.text();
        parts.push(`## ${path}\n\`\`\`\n${content}\n\`\`\``);
      }
    } catch {
      // Skip files that can't be read
    }
  }
  
  return parts.join('\n\n');
}
