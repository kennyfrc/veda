import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { ReasoningLevel, SandboxMode } from '../agent/config';
import { spawnCliWithRetry, commandExists, parseNdjsonStream } from './util/spawn';

/**
 * Map veda ReasoningLevel → droid `-r` flag value.
 * droid supports: off, low, medium, high, max.
 */
export function toDroidReasoning(reasoning: ReasoningLevel): string {
  switch (reasoning) {
    case 'minimal':
      return 'off';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'high';
  }
}

/**
 * Map veda SandboxMode → droid `--auto` flag.
 * read-only: no --auto (droid defaults to read-only).
 * workspace-write: --auto low
 * full: --auto high
 */
export function toDroidAutoArgs(sandbox: SandboxMode): string[] {
  switch (sandbox) {
    case 'read-only':
      return [];
    case 'workspace-write':
      return ['--auto', 'low'];
    case 'full':
      return ['--auto', 'high'];
  }
}

export class DroidBackend implements Backend {
  readonly name = 'droid';
  readonly command = 'droid';
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;

    if (!prompt || !prompt.trim()) {
      yield { type: 'error', content: 'Empty prompt — droid produces no output for empty input.', raw: null };
      yield { type: 'done', sessionId: undefined, usage: { inputTokens: 0, outputTokens: 0 } };
      return;
    }

    const args: string[] = ['exec'];

    if (config.model) {
      args.push('-m', config.model);
    }

    args.push('-r', toDroidReasoning(config.reasoning));

    args.push(...toDroidAutoArgs(config.sandbox ?? 'read-only'));

    if (config.systemPrompt) {
      args.push('--append-system-prompt', config.systemPrompt);
    } else if (config.systemPromptPath) {
      args.push('--append-system-prompt-file', config.systemPromptPath);
    }

    if (cwd) {
      args.push('--cwd', cwd);
    }

    args.push('--output-format', 'stream-json');

    // Build the prompt input: context + prompt (systemPrompt goes via flag).
    const input = context ? `${context}\n\n${prompt}` : prompt;

    const { stdout, stderr, process } = await spawnCliWithRetry({
      command: this.command,
      args,
      cwd,
      stdin: input,
    });

    yield* this.parseStream(stdout, stderr, process);
    await process.exited;
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;

    const args: string[] = ['exec'];

    if (config.model) {
      args.push('-m', config.model);
    }

    args.push('-r', toDroidReasoning(config.reasoning));

    args.push(...toDroidAutoArgs(config.sandbox ?? 'read-only'));

    if (config.systemPrompt) {
      args.push('--append-system-prompt', config.systemPrompt);
    } else if (config.systemPromptPath) {
      args.push('--append-system-prompt-file', config.systemPromptPath);
    }

    if (cwd) {
      args.push('--cwd', cwd);
    }

    args.push('--output-format', 'stream-json');

    args.push('-s', sessionId);

    const stdin = prompt || undefined;
    const { stdout, stderr, process } = await spawnCliWithRetry({
      command: this.command,
      args,
      cwd,
      stdin,
    });

    yield* this.parseStream(stdout, stderr, process);
    await process.exited;
  }

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  private async *parseStream(
    stream: ReadableStream<Uint8Array>,
    stderr: ReadableStream<Uint8Array>,
    _process: { exited: Promise<number> }
  ): AsyncIterable<Message> {
    let sessionId: string | undefined;
    let usage: UsageStats | undefined;
    let hadEvents = false;

    for await (const event of parseNdjsonStream(stream)) {
      hadEvents = true;
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

    // No events emitted at all — droid exits silently on empty/invalid input.
    // Surface any stderr content (e.g. invalid model list) as an error.
    if (!hadEvents) {
      const stderrText = await this.readStderr(stderr);
      if (stderrText.trim()) {
        yield { type: 'error', content: stderrText.trim(), raw: null };
      }
    }

    if (!usage) {
      yield { type: 'done', sessionId, usage: { inputTokens: 0, outputTokens: 0 } };
    }
  }

  private async readStderr(stream: ReadableStream<Uint8Array>): Promise<string> {
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text;
    } catch {
      return '';
    }
  }

  private normalizeEvent(event: unknown): Message | null {
    if (!event || typeof event !== 'object') return null;

    const e = event as Record<string, unknown>;
    const type = e.type as string;

    switch (type) {
      case 'system': {
        // subtype "init" — carries session_id, model, tools, reasoning_effort
        return {
          type: 'init',
          sessionId: e.session_id as string | undefined,
          raw: event,
        };
      }

      case 'message': {
        const role = e.role as string;
        if (role === 'assistant') {
          // Complete text (not a delta) in stream-json mode.
          return {
            type: 'text',
            content: (e.text as string) ?? '',
            raw: event,
          };
        }
        // role === 'user' is an echo of the input prompt — skip.
        return null;
      }

      case 'reasoning': {
        // Reasoning/thinking text (observed in stream-json with tool use).
        return {
          type: 'reasoning',
          content: (e.text as string) ?? '',
          raw: event,
        };
      }

      case 'tool_call': {
        return {
          type: 'tool_start',
          toolName: (e.toolName as string) ?? (e.toolId as string) ?? 'tool',
          toolInput: e.parameters,
          raw: event,
        };
      }

      case 'tool_result': {
        return {
          type: 'tool_result',
          toolName: e.toolId as string | undefined,
          toolResult: e.value,
          raw: event,
        };
      }

      case 'completion': {
        const usage = e.usage as Record<string, unknown> | undefined;
        return {
          type: 'done',
          sessionId: e.session_id as string | undefined,
          usage: usage
            ? {
                inputTokens: (usage.input_tokens as number) ?? 0,
                outputTokens: (usage.output_tokens as number) ?? 0,
                cachedTokens: usage.cache_read_input_tokens as number | undefined,
              }
            : { inputTokens: 0, outputTokens: 0 },
          raw: event,
        };
      }

      case 'error': {
        const errorMsg =
          (e.message as string) ??
          (e.error as string) ??
          'Unknown droid error';
        return {
          type: 'error',
          content: errorMsg,
          raw: event,
        };
      }

      default:
        return null;
    }
  }
}

export function createDroidBackend(): DroidBackend {
  return new DroidBackend();
}
