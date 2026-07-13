import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { SandboxMode, ReasoningLevel } from '../agent/config';
import { spawnCliWithRetry, commandExists, parseNdjsonStream } from './util/spawn';

export function parseJdcModel(model: string): { provider: string; model: string } {
  if (!model.startsWith('jdc/')) {
    throw new Error(`Model string must start with jdc/: ${model}`);
  }
  const rest = model.slice('jdc/'.length);
  const firstSlash = rest.indexOf('/');
  if (firstSlash === -1) {
    throw new Error(`Model string must start with jdc/ and contain provider/model: ${model}`);
  }
  const provider = rest.slice(0, firstSlash);
  const modelName = rest.slice(firstSlash + 1);
  return { provider, model: modelName };
}

export function toJdcThinking(reasoning: ReasoningLevel): string {
  switch (reasoning) {
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'xhigh':
      return 'high';
  }
}

export function toJdcTools(sandbox: SandboxMode): string {
  // Base tools always include bash for jdc (user preference)
  // Note: apply_patch and exec_command are GPT-specific, not included for jdc models
  const baseTools = 'read,bash,grep,glob,list_threads,read_thread,read_image,todo_write,compact';
  switch (sandbox) {
    case 'read-only':
      return baseTools;
    case 'workspace-write':
      return `${baseTools},edit,write`;
    case 'full':
      return `${baseTools},edit,write`;
  }
}

export class JdcBackend implements Backend {
  readonly name = 'jdc';
  readonly command = 'jdc';
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;

    const { provider, model } = parseJdcModel(config.model);

    const args: string[] = [
      '--mode', 'json',
      '--no-session',
      '-p',
      '--provider', provider,
      '--model', model,
      '--thinking', toJdcThinking(config.reasoning),
      '--tools', toJdcTools(config.sandbox),
    ];

    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    }

    if (context) {
      args.push(`${context}\n\n${prompt}`);
    } else {
      args.push(prompt);
    }

    const { stdout, process } = await spawnCliWithRetry({
      command: this.command,
      args,
      cwd,
    });

    yield* this.parseStream(stdout);
    await process.exited;
  }

  async *resume(_options: ResumeOptions): AsyncIterable<Message> {
    throw new Error('Resume not supported for jdc backend');
  }

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  private async *parseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<Message> {
    let sessionId: string | undefined;
    let usage: UsageStats | undefined;

    for await (const event of parseNdjsonStream(stream)) {
      const msg = this.normalizeEvent(event);
      if (msg) {
        if (msg.type === 'init' && msg.sessionId) {
          sessionId = msg.sessionId;
        }
        if (msg.type === 'done' && msg.usage) {
          usage = msg.usage;
        }
        yield msg;
      }
    }

    if (!usage) {
      yield { type: 'done', sessionId, usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }

  private normalizeEvent(event: unknown): Message | null {
    if (!event || typeof event !== 'object') return null;

    const e = event as Record<string, unknown>;
    const type = e.type as string;

    switch (type) {
      case 'agent_start': {
        // Synthesize a sessionId since jdc JSON mode lacks session_meta
        return {
          type: 'init',
          sessionId: crypto.randomUUID(),
          raw: event,
        };
      }

      case 'message_update': {
        const assistantEvent = e.assistantMessageEvent as Record<string, unknown> | undefined;
        if (!assistantEvent) return null;

        const updateType = assistantEvent.type as string;

        if (updateType === 'text_delta') {
          const delta = assistantEvent.delta as string;
          if (delta) {
            return { type: 'text', content: delta, raw: event };
          }
          return null;
        }

        if (updateType === 'thinking_delta') {
          const delta = assistantEvent.delta as string;
          return { type: 'reasoning', content: delta ?? '', raw: event };
        }

        return null;
      }

      case 'turn_end': {
        const message = e.message as Record<string, unknown> | undefined;
        const msgUsage = message?.usage as Record<string, unknown> | undefined;
        const cost = msgUsage?.cost as Record<string, unknown> | undefined;

        return {
          type: 'done',
          usage: msgUsage
            ? {
                inputTokens: (msgUsage.input as number) ?? 0,
                outputTokens: (msgUsage.output as number) ?? 0,
                cachedTokens: (msgUsage.cacheRead as number) ?? undefined,
                costUsd: (cost?.total as number) ?? undefined,
              }
            : { inputTokens: 0, outputTokens: 0 },
          raw: event,
        };
      }

      case 'agent_end': {
        // agent_end signals completion but turn_end already carries usage.
        // Only emit done if we haven't seen turn_end (no usage yet).
        return null;
      }

      case 'tool_execution_start': {
        return {
          type: 'tool_start',
          toolName: e.toolName as string | undefined,
          toolInput: e.args,
          raw: event,
        };
      }

      case 'tool_execution_end': {
        return {
          type: 'tool_result',
          toolName: e.toolName as string | undefined,
          toolResult: e.result,
          raw: event,
        };
      }

      case 'message_start':
      case 'message_end':
      case 'turn_start': {
        // Structural events — no action needed
        return null;
      }

      default:
        return null;
    }
  }
}

export function createJdcBackend(): JdcBackend {
  return new JdcBackend();
}
