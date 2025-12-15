/**
 * Sandbox notices for different tool access levels.
 * 
 * Veda backends can run in different sandbox modes. The notice prepended to
 * system prompts should match the actual runtime capabilities to avoid
 * prompt/capability mismatch.
 */

/**
 * No tools sandbox notice - completely restricted.
 * Use when the agent should not attempt any tool calls.
 */
export const SANDBOX_NOTICE = `## Sandbox Notice

You are an AI assistant running in a sandboxed environment with **no access to tools, file system, or external commands**. You cannot execute code, read files, run shell commands, or make any tool calls. Respond immediately based solely on the context provided in this conversation.

---

`;

/**
 * Read-only sandbox notice - allows repository inspection.
 * Use when the agent can read files and search but cannot modify anything.
 */
export const SANDBOX_NOTICE_READONLY = `## Sandbox Notice

You are an AI assistant with **read-only access** to the local repository. You may:
- Read files and inspect their contents
- Search the codebase (e.g., grep, find)
- List directories and check file existence

You **cannot**:
- Modify, create, or delete any files
- Execute code or run arbitrary commands
- Make network requests

When answering questions about the codebase, **use your read-only tools to gather evidence**. Cite the files and content you inspected. If you cannot access the information needed, say so explicitly.

---

`;

/**
 * Read-only sandbox notice (context-first) - prefers provided context, tools as fallback.
 * Use when the agent should primarily work from context but can inspect files if needed.
 */
export const SANDBOX_NOTICE_READONLY_CONTEXTFIRST = `## Sandbox Notice

You have **read-only access** to the local repository, but prefer answering from the provided context. You may:
- Read files and inspect their contents
- Search the codebase (e.g., grep, find)
- List directories and check file existence

You **cannot**:
- Modify, create, or delete any files
- Execute code or run arbitrary commands
- Make network requests

**Prefer working from the context provided.** Only use tools to inspect files if the context is insufficient to answer the question.

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

/**
 * Prepend read-only sandbox notice to a system prompt.
 * Ensures the model knows it can read but not write.
 */
export function withReadOnlySandboxNotice(systemPrompt: string): string {
  // Don't double-add if already present
  if (systemPrompt.includes('## Sandbox Notice')) {
    return systemPrompt;
  }
  return SANDBOX_NOTICE_READONLY + systemPrompt;
}

/**
 * Prepend read-only (context-first) sandbox notice to a system prompt.
 * Ensures the model prefers context but can use tools as fallback.
 */
export function withReadOnlyContextFirstNotice(systemPrompt: string): string {
  // Don't double-add if already present
  if (systemPrompt.includes('## Sandbox Notice')) {
    return systemPrompt;
  }
  return SANDBOX_NOTICE_READONLY_CONTEXTFIRST + systemPrompt;
}
