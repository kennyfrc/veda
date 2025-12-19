import { getBackend, extractText, extractErrors, getSessionId, getUsage, collectMessages } from '../backend';
import { getDefaults, resolveAgentConfig, loadGlobalConfig } from '../agent';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';

export async function handleResume(
  prompt: string | undefined,
  options: CliOptions
): Promise<void> {
  // Load saved thread
  const conversationStore = new ConversationStore({ sessionId: options.session });
  const threadInfo = await conversationStore.load();
  
  if (!threadInfo) {
    console.error(`No conversation found for session '${options.session}'.`);
    console.error('Start a new conversation first with: veda -S <session> <prompt>');
    process.exit(1);
  }
  
  // Use the original backend from the saved thread
  const backendName = threadInfo.backend;
  
  // Get defaults and config
  const defaults = await getDefaults();
  const globalConfig = await loadGlobalConfig();
  const config = await resolveAgentConfig(
    {
      persona: options.persona,
      model: options.model,
      reasoning: options.reasoning,
      sandbox: options.sandbox,
      backend: backendName,  // Use saved backend for resolution
    },
    defaults,
    globalConfig
  );
  const backend = getBackend(backendName);
  
  // Check backend availability
  if (!await backend.isAvailable()) {
    console.error(`Backend '${backendName}' is not available. Is it installed?`);
    process.exit(1);
  }
  
  // Resume the conversation
  const messages = await collectMessages(
    backend.resume({
      sessionId: threadInfo.threadId,
      prompt,
      config,
    })
  );
  
  // Extract results
  const text = extractText(messages);
  const errors = extractErrors(messages);
  const sessionId = getSessionId(messages);
  const usage = getUsage(messages);
  
  // Update thread info with new session ID if available
  if (sessionId) {
    await conversationStore.save({
      backend: backendName,
      threadId: sessionId,
    });
  }
  
  // Check for backend errors
  if (errors.length > 0) {
    if (options.json) {
      console.log(JSON.stringify({
        text,
        error: errors.join('\n'),
        sessionId,
        usage,
      }, null, 2));
    } else {
      for (const err of errors) {
        console.error(`Error: ${err}`);
      }
    }
    process.exit(1);
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
