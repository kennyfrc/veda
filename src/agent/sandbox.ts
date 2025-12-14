/**
 * Sandbox notice for tool-restricted mode.
 * 
 * All veda backends run in a sandboxed environment where agents should not
 * attempt to use tools. This notice is prepended to all system prompts to
 * ensure the model understands its constraints.
 */

export const SANDBOX_NOTICE = `## Sandbox Notice

You are an AI assistant running in a sandboxed environment with **no access to tools, file system, or external commands**. You cannot execute code, read files, run shell commands, or make any tool calls. Respond immediately based solely on the context provided in this conversation.

---

`;

/**
 * Prepend sandbox notice to a system prompt.
 * Ensures the model knows it cannot use tools.
 */
export function withSandboxNotice(systemPrompt: string): string {
  // Don't double-add if already present
  if (systemPrompt.includes('## Sandbox Notice')) {
    return systemPrompt;
  }
  return SANDBOX_NOTICE + systemPrompt;
}
