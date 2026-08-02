// Sandbox notices prepended to system prompts to match runtime capabilities.
// Mismatch between notice and actual sandbox mode causes model confusion.

import type { SandboxMode } from './config';

export const SANDBOX_NOTICE = `## Sandbox Notice

You are an AI assistant running in a sandboxed environment with **no access to tools, file system, or external commands**. You cannot execute code, read files, run shell commands, or make any tool calls. Respond immediately based solely on the context provided in this conversation.

---

`;

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

export const SANDBOX_NOTICE_WRITE = `## Sandbox Notice

You are an AI assistant with **workspace-write access** to the local repository. You may:
- Read, create, edit, and delete files inside the workspace
- Run shell commands (tests, typecheck, build, scratch probes) in the workspace
- Drive the running surface to verify your work (a browser, a terminal session, an API)

You **cannot**:
- Touch the network unless granted the \`full\` sandbox
- Modify files outside the workspace
- Restart services you did not start

Make changes through the narrowest effect channel, verify them against real state, and report back through the worker_report protocol.

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

export function withWriteSandboxNotice(systemPrompt: string): string {
  if (systemPrompt.includes('## Sandbox Notice')) return systemPrompt;
  return SANDBOX_NOTICE_WRITE + systemPrompt;
}

/**
 * Select the sandbox notice that matches an effective (tools, sandbox) pair.
 *
 * The notice must match runtime reality: an empty tool allowlist means no
 * tools exist (the no-access notice); an *undefined* allowlist means the
 * backend's full toolset is granted (undefined vs [] — see resolveAgentConfig);
 * and a workspace-write sandbox with tools granted gets the write notice.
 */
export function withSandboxModeNotice(
  systemPrompt: string,
  opts: { tools: string[] | undefined; sandbox: SandboxMode }
): string {
  if (opts.tools === undefined) {
    // Full toolset granted (backend default) — e.g. the worker persona.
    return opts.sandbox === 'workspace-write'
      ? withWriteSandboxNotice(systemPrompt)
      : systemPrompt;
  }
  if (opts.tools.length === 0) {
    // Explicitly no tools — no-access notice matches runtime.
    return withSandboxNotice(systemPrompt);
  }
  // A specific tool allowlist is granted. workspace-write sandbox still gets
  // the write notice so the notice mirrors runtime capability (the design's
  // "notice must match runtime reality" rule); read-only stays unchanged.
  return opts.sandbox === 'workspace-write'
    ? withWriteSandboxNotice(systemPrompt)
    : systemPrompt;
}
