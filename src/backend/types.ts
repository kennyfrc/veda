// Backend protocol: each CLI adapter normalizes output to Message events.

import type { AgentConfig } from '../agent';

export interface Message {
  type: 'init' | 'text' | 'reasoning' | 'tool_use' | 'tool_result' | 'tool_start' | 'error' | 'done';
  content?: string;
  sessionId?: string;
  usage?: UsageStats;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  raw?: unknown;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}

export interface RunOptions {
  prompt: string;
  context?: string;
  config: AgentConfig;
  cwd?: string;
}

export interface ResumeOptions {
  sessionId: string;
  prompt?: string;
  config: AgentConfig;
  cwd?: string;
}

export interface Backend {
  readonly name: string;
  readonly command: string;
  readonly systemPromptFile?: string;
  run(options: RunOptions): AsyncIterable<Message>;
  resume(options: ResumeOptions): AsyncIterable<Message>;
  isAvailable(): Promise<boolean>;
}

export type BackendFactory = () => Backend;

export function extractText(messages: Message[]): string {
  return messages
    .filter(m => m.type === 'text')
    .map(m => m.content ?? '')
    .join('');
}

export function getSessionId(messages: Message[]): string | undefined {
  return messages.find(m => m.type === 'init')?.sessionId;
}

export function getUsage(messages: Message[]): UsageStats | undefined {
  return messages.find(m => m.type === 'done')?.usage;
}

export function extractErrors(messages: Message[]): string[] {
  return messages
    .filter(m => m.type === 'error')
    .map(m => m.content ?? '')
    .filter(c => c.length > 0);
}

export async function collectMessages(stream: AsyncIterable<Message>): Promise<Message[]> {
  const messages: Message[] = [];
  for await (const msg of stream) {
    messages.push(msg);
  }
  return messages;
}
