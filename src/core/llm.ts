import type { Message, UsageStats } from '../backend';
import {
  getBackend,
  extractText as backendExtractText,
  extractErrors as backendExtractErrors,
  getSessionId as backendGetSessionId,
  getUsage as backendGetUsage,
} from '../backend';

export type { Message, UsageStats };

export type Reasoning = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type Sandbox = 'read-only' | 'workspace-write' | 'full';

export interface LlmRequest {
  backend: string;
  prompt: string;
  context?: string;
  systemPrompt: string;
  model?: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  /** Tool policy. `undefined` = the backend's full toolset (e.g. the worker
   *  persona's `tools: all`). `[]` = no tools (the advisory personas).
   *  A non-empty list = an explicit allowlist. */
  tools?: string[];
  cwd?: string;
  onMessage?: (msg: Message) => void;
}

export interface LlmResponse {
  messages: Message[];
  text: string;
  errors: string[];
  sessionId?: string;
  usage?: UsageStats;
}

/**
 * Build the backend AgentConfig from a request. Single derivation point for
 * tool policy: `tools: undefined` (worker's `tools: all`) reaches the backend
 * intact; `[]` stays "no tools" for the advisory personas. Never coerce
 * undefined to [] here — that silently strips the worker of its toolset.
 */
export function buildBackendConfig(req: LlmRequest) {
  return {
    model: req.model ?? '',
    reasoning: req.reasoning ?? ('medium' as Reasoning),
    sandbox: req.sandbox ?? ('read-only' as Sandbox),
    tools: req.tools,
    systemPrompt: req.systemPrompt,
  };
}

export async function runLlm(req: LlmRequest): Promise<LlmResponse> {
  const backend = getBackend(req.backend);
  
  const stream = backend.run({
    prompt: req.prompt,
    context: req.context,
    config: buildBackendConfig(req),
    cwd: req.cwd,
  });
  
  const messages: Message[] = [];
  for await (const msg of stream) {
    if (req.onMessage) req.onMessage(msg);
    messages.push(msg);
  }
  
  return {
    messages,
    text: backendExtractText(messages),
    errors: backendExtractErrors(messages),
    sessionId: backendGetSessionId(messages),
    usage: backendGetUsage(messages),
  };
}

export async function* streamLlm(req: LlmRequest): AsyncIterable<Message> {
  const backend = getBackend(req.backend);
  
  yield* backend.run({
    prompt: req.prompt,
    context: req.context,
    config: buildBackendConfig(req),
    cwd: req.cwd,
  });
}

export async function isBackendAvailable(backendName: string): Promise<boolean> {
  const backend = getBackend(backendName);
  return backend.isAvailable();
}

export const extractText = backendExtractText;
export const extractErrors = backendExtractErrors;
export const getSessionId = backendGetSessionId;
export const getUsage = backendGetUsage;

export function combineUsage(usages: (UsageStats | undefined)[]): UsageStats {
  return usages.reduce<UsageStats>(
    (acc, u) => {
      if (!u) return acc;
      return {
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        cachedTokens: (acc.cachedTokens ?? 0) + (u.cachedTokens ?? 0) || undefined,
        costUsd: (acc.costUsd ?? 0) + (u.costUsd ?? 0) || undefined,
      };
    },
    { inputTokens: 0, outputTokens: 0 }
  );
}

export async function collectAllMessages(stream: AsyncIterable<Message>): Promise<Message[]> {
  const messages: Message[] = [];
  for await (const msg of stream) {
    messages.push(msg);
  }
  return messages;
}
