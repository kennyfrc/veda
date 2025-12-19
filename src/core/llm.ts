/**
 * Core LLM primitive: plain data types + functions for single LLM calls.
 * No classes, no hidden state - all parameters explicit.
 */

import type { Message, UsageStats } from '../backend';
import {
  getBackend,
  extractText as backendExtractText,
  extractErrors as backendExtractErrors,
  getSessionId as backendGetSessionId,
  getUsage as backendGetUsage,
} from '../backend';

// Re-export types that callers need
export type { Message, UsageStats };

// ============================================================================
// Data Types (plain structs)
// ============================================================================

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
  cwd?: string;
  /** Optional callback for streaming events (tool_start, etc.) */
  onMessage?: (msg: Message) => void;
}

export interface LlmResponse {
  messages: Message[];
  text: string;
  errors: string[];
  sessionId?: string;
  usage?: UsageStats;
}

// ============================================================================
// Functions (data as first param, explicit dependencies)
// ============================================================================

/**
 * Run a single LLM call. Returns collected messages + extracted results.
 * If onMessage callback is provided, it will be called for each message as it arrives.
 */
export async function runLlm(req: LlmRequest): Promise<LlmResponse> {
  const backend = getBackend(req.backend);
  
  const stream = backend.run({
    prompt: req.prompt,
    context: req.context,
    config: {
      model: req.model ?? '',
      reasoning: req.reasoning ?? 'medium',
      sandbox: req.sandbox ?? 'read-only',
      systemPrompt: req.systemPrompt,
    },
    cwd: req.cwd,
  });
  
  // Collect messages, optionally calling callback for each
  const messages: Message[] = [];
  for await (const msg of stream) {
    if (req.onMessage) {
      req.onMessage(msg);
    }
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

/**
 * Run a single LLM call, streaming messages as they arrive.
 */
export async function* streamLlm(req: LlmRequest): AsyncIterable<Message> {
  const backend = getBackend(req.backend);
  
  yield* backend.run({
    prompt: req.prompt,
    context: req.context,
    config: {
      model: req.model ?? '',
      reasoning: req.reasoning ?? 'medium',
      sandbox: req.sandbox ?? 'read-only',
      systemPrompt: req.systemPrompt,
    },
    cwd: req.cwd,
  });
}

/**
 * Check if a backend is available.
 */
export async function isBackendAvailable(backendName: string): Promise<boolean> {
  const backend = getBackend(backendName);
  return backend.isAvailable();
}

// ============================================================================
// Message helpers (re-exported from backend for convenience)
// ============================================================================

/** Extract text content from messages. */
export const extractText = backendExtractText;

/** Extract error messages from messages. */
export const extractErrors = backendExtractErrors;

/** Get session ID from messages (set on 'init' message). */
export const getSessionId = backendGetSessionId;

/** Get usage stats from messages (set on 'done' message). */
export const getUsage = backendGetUsage;

/**
 * Combine multiple usage stats into one.
 */
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

/**
 * Collect all messages from a stream into an array.
 */
export async function collectAllMessages(stream: AsyncIterable<Message>): Promise<Message[]> {
  const messages: Message[] = [];
  for await (const msg of stream) {
    messages.push(msg);
  }
  return messages;
}
