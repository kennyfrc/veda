/**
 * Backend Protocol - Defines the contract for all CLI backend adapters.
 * 
 * Each backend (codex, claude, gemini) must implement this protocol to be
 * usable as an interchangeable agent.
 */

import type { AgentConfig } from '../agent';

// ============================================================================
// Message Types - Normalized streaming output
// ============================================================================

export interface Message {
  /** Message type */
  type: 'init' | 'text' | 'reasoning' | 'tool_use' | 'tool_result' | 'error' | 'done';
  /** Text content (for text, reasoning, error types) */
  content?: string;
  /** Session/thread ID (MUST be set on 'init' message) */
  sessionId?: string;
  /** Usage statistics (MUST be set on 'done' message) */
  usage?: UsageStats;
  /** Tool name (for tool_use type) */
  toolName?: string;
  /** Tool input (for tool_use type) */
  toolInput?: unknown;
  /** Tool result (for tool_result type) */
  toolResult?: unknown;
  /** Raw backend-specific event data */
  raw?: unknown;
}

export interface UsageStats {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens generated */
  outputTokens: number;
  /** Cached tokens (if applicable) */
  cachedTokens?: number;
  /** Total cost in USD (if known) */
  costUsd?: number;
}

// ============================================================================
// Backend Options
// ============================================================================

export interface RunOptions {
  /** User prompt */
  prompt: string;
  /** Context string (file selection) */
  context?: string;
  /** Agent configuration */
  config: AgentConfig;
  /** Working directory */
  cwd?: string;
}

export interface ResumeOptions {
  /** Session/thread ID to resume */
  sessionId: string;
  /** Optional follow-up prompt */
  prompt?: string;
  /** Agent configuration */
  config: AgentConfig;
  /** Working directory */
  cwd?: string;
}

// ============================================================================
// Backend Interface
// ============================================================================

export interface Backend {
  /** Backend identifier (e.g., 'codex', 'claude', 'gemini') */
  readonly name: string;
  
  /** CLI command name (e.g., 'codex', 'claude', 'gemini') */
  readonly command: string;
  
  /** System prompt file name (if file-based, e.g., 'AGENTS.md') */
  readonly systemPromptFile?: string;
  
  /**
   * Run a new prompt.
   * Yields normalized Message events as the backend streams output.
   */
  run(options: RunOptions): AsyncIterable<Message>;
  
  /**
   * Resume an existing conversation.
   * Yields normalized Message events as the backend streams output.
   */
  resume(options: ResumeOptions): AsyncIterable<Message>;
  
  /**
   * Check if this backend CLI is available (installed and in PATH).
   */
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Backend Factory
// ============================================================================

export type BackendFactory = () => Backend;

// ============================================================================
// Helper Types
// ============================================================================

/** Extracts all text content from a stream of messages */
export function extractText(messages: Message[]): string {
  return messages
    .filter(m => m.type === 'text')
    .map(m => m.content ?? '')
    .join('');
}

/** Gets session ID from init message */
export function getSessionId(messages: Message[]): string | undefined {
  const init = messages.find(m => m.type === 'init');
  return init?.sessionId;
}

/** Gets usage stats from done message */
export function getUsage(messages: Message[]): UsageStats | undefined {
  const done = messages.find(m => m.type === 'done');
  return done?.usage;
}

/** Collects all messages from an async iterable */
export async function collectMessages(stream: AsyncIterable<Message>): Promise<Message[]> {
  const messages: Message[] = [];
  for await (const msg of stream) {
    messages.push(msg);
  }
  return messages;
}
