// Gemini backend - injects system prompt into first message (no --system-prompt flag).

import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { SandboxMode } from '../agent/config';
import { spawnCli, commandExists, parseNdjsonStream } from './util/spawn';

function toGeminiApprovalMode(sandbox: SandboxMode): string {
  switch (sandbox) {
    case 'read-only': return 'default';
    case 'workspace-write': return 'auto_edit';
    case 'full': return 'yolo';
  }
}

export class GeminiBackend implements Backend {
  readonly name = 'gemini-cli';
  readonly command = 'gemini';
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;
    
    const args: string[] = [];
    if (config.model) args.push('--model', config.model);
    args.push('--output-format', 'stream-json');
    if (config.sandbox) args.push('--approval-mode', toGeminiApprovalMode(config.sandbox));
    
    // Inject system prompt into first message since Gemini lacks --system-prompt flag
    let input = '';
    if (config.systemPrompt) input += `<system_instructions>\n${config.systemPrompt}\n</system_instructions>\n\n`;
    if (context) input += `${context}\n\n`;
    input += prompt;
    
    // Use positional argument for headless mode (--prompt is deprecated)
    args.push(input);
    
    const { stdout, process } = spawnCli({ command: this.command, args, cwd });
    yield* this.parseStream(stdout);
    await process.exited;
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;
    
    const args: string[] = ['--resume', sessionId, '--output-format', 'stream-json'];
    if (config.sandbox) args.push('--approval-mode', toGeminiApprovalMode(config.sandbox));
    if (prompt) args.push(prompt);
    
    const { stdout, process } = spawnCli({ command: this.command, args, cwd });
    yield* this.parseStream(stdout);
    await process.exited;
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
        if (msg.type === 'init' && msg.sessionId) sessionId = msg.sessionId;
        if (msg.type === 'done' && msg.usage) usage = msg.usage;
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
        // Check for error status first
        if (e.status === 'error') {
          const errorObj = e.error as { message?: string; type?: string } | undefined;
          let errorMsg = errorObj?.message ?? 'Unknown error';
          
          // Try to extract readable message from nested API error JSON
          // Format: "[API Error: {\"error\":{\"message\":\"{nested json}\",\"code\":400}}]"
          const jsonMatch = errorMsg.match(/\[API Error: (.+)\]$/);
          if (jsonMatch) {
            try {
              const outer = JSON.parse(jsonMatch[1]) as { error?: { message?: string } };
              if (outer.error?.message) {
                try {
                  // The message field may contain another JSON string
                  const inner = JSON.parse(outer.error.message) as { error?: { message?: string } };
                  if (inner.error?.message) {
                    errorMsg = inner.error.message;
                  }
                } catch {
                  // Inner parse failed, use outer message as-is
                  errorMsg = outer.error.message;
                }
              }
            } catch {
              // JSON parse failed, keep original message
            }
          }
          
          return {
            type: 'error',
            content: errorMsg,
            raw: event,
          };
        }
        
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

export function createGeminiBackend(): GeminiBackend {
  return new GeminiBackend();
}
