/**
 * Gemini Backend - Google's CLI agent.
 * 
 * JSON Format (with --output-format stream-json):
 * - Init: {"type":"init","session_id":"UUID","model":"..."}
 * - Message: {"type":"message","role":"assistant","content":"...","delta":true}
 * - Done: {"type":"result","status":"success","stats":{"input_tokens":N,"output_tokens":M}}
 * 
 * Notes:
 * - Uses positional prompt (--prompt is deprecated)
 * - Positional prompt makes it non-interactive by default (one-shot)
 * - Uses --sandbox boolean flag (no value needed)
 * 
 * System Prompt: Injected into first message (not file-based).
 * Unlike Claude which has --system-prompt flag, Gemini only supports GEMINI.md file.
 * We inject the system prompt into the first user message to keep sessions resumable.
 */

import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import { spawnCli, commandExists, parseNdjsonStream } from './util/spawn';

export class GeminiBackend implements Backend {
  readonly name = 'gemini';
  readonly command = 'gemini';
  // We inject system prompt into first message, not via file
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;
    
    const args: string[] = [];
    
    // Model
    if (config.model) {
      args.push('--model', config.model);
    }
    
    // JSON streaming output mode (not 'json' which is single object)
    args.push('--output-format', 'stream-json');
    
    // Sandbox mode - Gemini uses boolean --sandbox flag
    // Enable sandbox for read-only and workspace-write modes (not for 'full')
    if (config.sandbox && config.sandbox !== 'full') {
      args.push('--sandbox');
    }
    
    // Build input: system prompt + context + prompt
    // Gemini doesn't have a --system-prompt flag, so we inject it into the first message
    let input = '';
    if (config.systemPrompt) {
      input += `[System Instructions]\n${config.systemPrompt}\n\n[User Request]\n`;
    }
    if (context) {
      input += `${context}\n\n`;
    }
    input += prompt;
    
    // Positional prompt at the end - no --non-interactive needed, positional makes it one-shot
    args.push(input);
    
    const { stdout, process } = spawnCli({
      command: this.command,
      args,
      cwd,
    });

    yield* this.parseStream(stdout);
    
    await process.exited;
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;
    
    const args: string[] = [];
    
    // Resume with session ID or 'latest'
    // Gemini uses index-based resume or 'latest'
    args.push('--resume', sessionId);
    
    // JSON streaming output mode
    args.push('--output-format', 'stream-json');
    
    // Sandbox mode - Gemini uses boolean --sandbox flag
    // Enable sandbox for read-only and workspace-write modes (not for 'full')
    if (config.sandbox && config.sandbox !== 'full') {
      args.push('--sandbox');
    }
    
    // Positional prompt if provided
    if (prompt) {
      args.push(prompt);
    }
    
    const { stdout, process } = spawnCli({
      command: this.command,
      args,
      cwd,
    });

    yield* this.parseStream(stdout);
    
    await process.exited;
  }

  async isAvailable(): Promise<boolean> {
    return commandExists(this.command);
  }

  /**
   * Parse Gemini NDJSON stream into normalized messages.
   */
  private async *parseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<Message> {
    let sessionId: string | undefined;
    let usage: UsageStats | undefined;

    for await (const event of parseNdjsonStream(stream)) {
      const msg = this.normalizeEvent(event);
      if (msg) {
        // Track session ID from init
        if (msg.type === 'init' && msg.sessionId) {
          sessionId = msg.sessionId;
        }
        // Track usage from done
        if (msg.type === 'done' && msg.usage) {
          usage = msg.usage;
        }
        yield msg;
      }
    }

    // Ensure we emit a done message with usage
    if (!usage) {
      yield {
        type: 'done',
        sessionId,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  /**
   * Normalize a Gemini event to our Message type.
   */
  private normalizeEvent(event: unknown): Message | null {
    if (!event || typeof event !== 'object') return null;
    
    const e = event as Record<string, unknown>;
    const type = e.type as string;

    switch (type) {
      case 'init':
        return {
          type: 'init',
          sessionId: e.session_id as string,
          raw: event,
        };

      case 'message': {
        const role = e.role as string;
        const content = e.content as string;
        
        if (role === 'assistant' && content) {
          return {
            type: 'text',
            content,
            raw: event,
          };
        }
        
        return null;
      }

      case 'tool_use':
        return {
          type: 'tool_use',
          toolName: e.name as string,
          toolInput: e.input,
          raw: event,
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          toolResult: e.output,
          raw: event,
        };

      case 'result': {
        // Gemini stream-json format has stats at top level with input_tokens, output_tokens
        const stats = e.stats as Record<string, unknown> | undefined;
        
        return {
          type: 'done',
          sessionId: e.session_id as string,
          usage: stats ? {
            inputTokens: (stats.input_tokens as number) ?? 0,
            outputTokens: (stats.output_tokens as number) ?? 0,
          } : { inputTokens: 0, outputTokens: 0 },
          raw: event,
        };
      }

      case 'error':
        return {
          type: 'error',
          content: (e.message as string) ?? (e.error as string) ?? 'Unknown error',
          raw: event,
        };

      default:
        return null;
    }
  }
}

/**
 * Create a Gemini backend instance.
 */
export function createGeminiBackend(): GeminiBackend {
  return new GeminiBackend();
}
