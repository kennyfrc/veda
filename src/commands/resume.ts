import { getBackend, extractText, extractErrors, getSessionId, getUsage, type Message } from '../backend';
import { getDefaults, loadGlobalConfig } from '../agent/config';
import { resolveAgentConfig } from '../agent/persona';
import { ConversationStore } from '../conversation';
import type { CliOptions } from '../cli';
import { formatUsageStats, formatChatHeader, formatChatToolEvent, formatChatComplete, saveResponseYaml, c } from '../util';

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
  
  // Always emit header at start
  if (showProgress) {
    console.error(formatChatHeader('resume', backendName, config.model));
  }
  
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
      
      // Show tool events
      if (isToolEvent && msg.toolName) {
        console.error(formatChatToolEvent(msg.toolName, msg.toolInput));
      }
    }
  }
  
  // Extract results
  const text = extractText(messages);
  const errors = extractErrors(messages);
  const sessionId = getSessionId(messages);
  const usage = getUsage(messages);
  
  // Emit completion summary
  if (showProgress) {
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
  
  // Save full response to YAML (stdout may truncate long responses)
  let responsePath: string | undefined;
  if (!options.json) {
    responsePath = await saveResponseYaml({
      session: options.session,
      persona: options.persona,
      backend: backendName,
      model: config.model,
      prompt,
      response: text,
      usage,
    });
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

  if (responsePath) {
    console.error(`${c.dim('[response]')} ${c.cyan(responsePath)}`);
  }

  // Notify on completion
  if (options.notify ?? globalConfig.notify ?? true) {
    const { notify, formatNotifyMessage } = await import('../util/notify');
    notify({
      title: 'Veda',
      message: formatNotifyMessage(prompt),
      subtitle: options.session,
      backend: backendName,
      model: config.model,
      sound: options.notifySound ?? globalConfig.notifySound,
    });
  }
}
