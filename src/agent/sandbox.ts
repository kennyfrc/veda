// Sandbox notices prepended to system prompts to match runtime capabilities.
// Mismatch between notice and actual sandbox mode causes model confusion.

/** No tool access */
export const SANDBOX_NOTICE = `## Sandbox Notice

You are an AI assistant running in a sandboxed environment with **no access to tools, file system, or external commands**. You cannot execute code, read files, run shell commands, or make any tool calls. Respond immediately based solely on the context provided in this conversation.

---

`;

/** Read-only: can inspect files, encouraged to use tools */
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

/** Read-only: prefers context, tools as fallback */
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

export function withSandboxNotice(systemPrompt: string): string {
  if (systemPrompt.includes('## Sandbox Notice')) return systemPrompt;
  return SANDBOX_NOTICE + systemPrompt;
}

export function withReadOnlySandboxNotice(systemPrompt: string): string {
  if (systemPrompt.includes('## Sandbox Notice')) return systemPrompt;
  return SANDBOX_NOTICE_READONLY + systemPrompt;
}

export function withReadOnlyContextFirstNotice(systemPrompt: string): string {
  if (systemPrompt.includes('## Sandbox Notice')) return systemPrompt;
  return SANDBOX_NOTICE_READONLY_CONTEXTFIRST + systemPrompt;
}
