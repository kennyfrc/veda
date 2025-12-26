import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { SandboxMode } from '../agent/config';
import { spawnCliWithRetry, commandExists, parseNdjsonStream } from './util/spawn';
import { GeminiConfigManager } from './gemini-config';

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
  private configManager: GeminiConfigManager = new GeminiConfigManager();

  /**
   * Clean up stale veda overrides from previous crashed runs.
   * Call this once on veda startup.
   */
  static async cleanupStale(ageHours: number = 24): Promise<number> {
    const manager = new GeminiConfigManager();
    return await manager.cleanupStale(ageHours);
  }

    async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;

    const args: string[] = [];
    const modelName = config.model || 'gemini-3-pro-preview';
    if (config.model) args.push('--model', config.model);
    args.push('--output-format', 'stream-json');
    if (config.sandbox) args.push('--approval-mode', toGeminiApprovalMode(config.sandbox));

    // Gemini lacks --system-prompt, so we inject it into the message
    let input = '';
    if (config.systemPrompt) input += `<system_instructions>\n${config.systemPrompt}\n</system_instructions>\n\n`;
    if (context) input += `${context}\n\n`;
    input += prompt;
    args.push(input);

    // Execute with temporary thinking config override
    // Config manager handles backup/inject/cleanup around subprocess execution
    // Note: This collects all messages first to ensure cleanup happens reliably
    const messages = await this.configManager.withOverride(
      config.reasoning,
      modelName,
      async () => {
        const { stdout, process } = await spawnCliWithRetry({ command: this.command, args, cwd });
        const collected: Message[] = [];
        for await (const msg of this.parseStream(stdout)) {
          collected.push(msg);
        }
        await process.exited;
        return collected;
      }
    );

    // Yield collected messages
    for (const msg of messages) {
      yield msg;
    }
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;

    const args: string[] = ['--resume', sessionId, '--output-format', 'stream-json'];
    if (config.sandbox) args.push('--approval-mode', toGeminiApprovalMode(config.sandbox));
    if (prompt) args.push(prompt);

    const modelName = config.model || 'gemini-3-pro-preview';

    // Execute with temporary thinking config override
    const messages = await this.configManager.withOverride(
      config.reasoning,
      modelName,
      async () => {
        const { stdout, process } = await spawnCliWithRetry({ command: this.command, args, cwd });
        const collected: Message[] = [];
        for await (const msg of this.parseStream(stdout)) {
          collected.push(msg);
        }
        await process.exited;
        return collected;
      }
    );

    for (const msg of messages) {
      yield msg;
    }
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
          toolName: (e.tool_name as string) ?? (e.name as string),
          toolInput: e.parameters ?? e.input,
          raw: event,
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          toolResult: e.output,
          raw: event,
        };

      case 'result': {
        if (e.status === 'error') {
          const errorObj = e.error as { message?: string; type?: string } | undefined;
          let errorMsg = errorObj?.message ?? 'Unknown error';
          
          // Gemini wraps errors: [API Error: {"error":{"message":"{nested json}"}}]
          const jsonMatch = errorMsg.match(/\[API Error: (.+)\]$/);
          if (jsonMatch) {
            try {
              const outer = JSON.parse(jsonMatch[1]) as { error?: { message?: string } };
              if (outer.error?.message) {
                try {
                  const inner = JSON.parse(outer.error.message) as { error?: { message?: string } };
                  if (inner.error?.message) {
                    errorMsg = inner.error.message;
                  }
                } catch {
                  errorMsg = outer.error.message;
                }
              }
            } catch { /* keep original */ }
          }
          
          return { type: 'error', content: errorMsg, raw: event };
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

      case 'error': {
        // Gemini emits severity: 'warning' for non-fatal errors (e.g., loop detection)
        const severity = e.severity as string | undefined;
        if (severity === 'warning') {
          return null;
        }
        
        return {
          type: 'error',
          content: (e.message as string) ?? (e.error as string) ?? 'Unknown error',
          raw: event,
        };
      }

      default:
        return null;
    }
  }
}

export function createGeminiBackend(): GeminiBackend {
  return new GeminiBackend();
}
