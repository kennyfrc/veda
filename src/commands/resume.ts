import { getBackend, extractText, extractErrors, getSessionId, getUsage, type Message } from '../backend';
import { getDefaults, loadGlobalConfig } from '../agent/config';
import { resolveAgentConfig } from '../agent/persona';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { formatUsageStats, formatChatHeader, formatChatToolEvent, formatChatComplete } from '../util';

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
  
  // Show progress unless --json mode
  const showProgress = !options.json;
  let headerEmitted = false;
  let hasToolEvents = false;
  
  // Stream messages with progress
  const messages: Message[] = [];
  for await (const msg of backend.resume({
    sessionId: threadInfo.threadId,
    prompt,
    config,
    cwd: process.cwd(),
  })) {
    messages.push(msg);
    
    if (showProgress) {
      // Handle both tool_start (codex) and tool_use (claude) events
      const isToolEvent = msg.type === 'tool_start' || msg.type === 'tool_use';
      
      // Emit header on first tool event
      if (isToolEvent && !headerEmitted) {
        // For resume, show "resume (session)" in header
        console.error(formatChatHeader(`resume`, backendName, config.model));
        headerEmitted = true;
      }
      
      // Show tool events
      if (isToolEvent && msg.toolName) {
        console.error(formatChatToolEvent(msg.toolName, msg.toolInput));
        hasToolEvents = true;
      }
    }
  }
  
  // Extract results
  const text = extractText(messages);
  const errors = extractErrors(messages);
  const sessionId = getSessionId(messages);
  const usage = getUsage(messages);
  
  // Emit completion if we showed any tool events
  if (showProgress && hasToolEvents) {
    console.error(formatChatComplete(usage?.inputTokens, usage?.outputTokens));
    console.error('');  // Blank line before response
  }
  
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
      console.error(formatUsageStats(usage));
    }
  } else if (options.json) {
    console.log(JSON.stringify({ text, sessionId, usage }, null, 2));
  } else {
    console.log(text);
  }

  // Notify on completion
  if (options.notify ?? globalConfig.notify ?? true) {
    const { notify, formatNotifyMessage } = await import('../util/notify');
    notify({ title: 'Veda', message: formatNotifyMessage(prompt), subtitle: options.session, backend: backendName, model: config.model });
  }
}
