import type { Message, UsageStats } from '../backend';
import {
  getBackend,
  extractText as backendExtractText,
  extractErrors as backendExtractErrors,
  getSessionId as backendGetSessionId,
  getUsage as backendGetUsage,
} from '../backend';

export type { Message, UsageStats };

export type Reasoning = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type Sandbox = 'read-only' | 'workspace-write' | 'full';

export interface LlmRequest {
  backend: string;
  prompt: string;
  context?: string;
  systemPrompt: string;
  model?: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  /** Optional tool allowlist. Undefined uses backend defaults; [] requests no tools. */
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

export async function runLlm(req: LlmRequest): Promise<LlmResponse> {
  const backend = getBackend(req.backend);
  
  const stream = backend.run({
    prompt: req.prompt,
    context: req.context,
    config: {
      model: req.model ?? '',
      reasoning: req.reasoning ?? 'medium',
      sandbox: req.sandbox ?? 'read-only',
      tools: req.tools,
      systemPrompt: req.systemPrompt,
    },
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
    config: {
      model: req.model ?? '',
      reasoning: req.reasoning ?? 'medium',
      sandbox: req.sandbox ?? 'read-only',
      tools: req.tools,
      systemPrompt: req.systemPrompt,
    },
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
