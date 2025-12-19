import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import { spawnCli, commandExists, parseNdjsonStream } from './util/spawn';
import { toCodexSandbox } from '../agent';

export class CodexBackend implements Backend {
  readonly name = 'codex';
  readonly command = 'codex';
  readonly systemPromptFile = 'AGENTS.md';

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;
    
    const args: string[] = ['exec'];
    
    if (config.model) {
      args.push('-m', config.model);
    }
    
    args.push('-c', `model_reasoning_effort="${config.reasoning}"`);
    args.push('-c', 'model_reasoning_summary="concise"');
    args.push('--sandbox', toCodexSandbox(config.sandbox ?? 'read-only'));
    
    if (cwd) {
      args.push('--cd', cwd);
      args.push('--skip-git-repo-check');
    }
    
    args.push('--json');
    
    let input = '';
    if (config.systemPrompt) input += `<system_instructions>\n${config.systemPrompt}\n</system_instructions>\n\n`;
    if (context) input += `${context}\n\n`;
    input += prompt;
    args.push('-'); // stdin avoids arg length limits
    
    const { stdout, process } = spawnCli({
      command: this.command,
      args,
      cwd,
      stdin: input,
    });

    yield* this.parseStream(stdout);
    
    await process.exited;
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, cwd } = options;
    
    const args: string[] = ['exec', '--json', 'resume', sessionId];
    if (prompt) args.push('--', prompt);
    
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
      case 'thread.started':
        return {
          type: 'init',
          sessionId: e.thread_id as string,
          raw: event,
        };

      case 'item.started': {
        const item = e.item as Record<string, unknown> | undefined;
        if (!item) return null;
        
        const itemType = item.type as string;
        
        if (itemType === 'command_execution') {
          return {
            type: 'tool_start',
            toolName: 'shell',
            toolInput: { command: item.command as string },
            raw: event,
          };
        }
        
        if (itemType === 'mcp_tool_call') {
          return {
            type: 'tool_start',
            toolName: `mcp:${item.server}/${item.tool}`,
            toolInput: item.arguments,
            raw: event,
          };
        }
        
        if (itemType === 'file_change') {
          return {
            type: 'tool_start',
            toolName: 'file_change',
            toolInput: item.changes,
            raw: event,
          };
        }
        
        return null;
      }

      case 'item.completed': {
        const item = e.item as Record<string, unknown> | undefined;
        if (!item) return null;
        
        const itemType = item.type as string;
        
        if (itemType === 'agent_message' || itemType === 'assistant_message') {
          return {
            type: 'text',
            content: (item.text as string) ?? '',
            raw: event,
          };
        }
        
        if (itemType === 'reasoning') {
          return {
            type: 'reasoning',
            content: (item.text as string) ?? '',
            raw: event,
          };
        }
        
        if (itemType === 'tool_use') {
          return {
            type: 'tool_use',
            toolName: item.name as string,
            toolInput: item.input,
            raw: event,
          };
        }
        
        if (itemType === 'tool_result') {
          return {
            type: 'tool_result',
            toolResult: item.output,
            raw: event,
          };
        }
        
        if (itemType === 'command_execution') {
          return {
            type: 'tool_result',
            toolName: 'shell',
            toolResult: {
              command: item.command,
              exitCode: item.exit_code,
              output: item.aggregated_output,
            },
            raw: event,
          };
        }
        
        return null;
      }

      case 'turn.completed': {
        const usage = e.usage as Record<string, unknown> | undefined;
        return {
          type: 'done',
          usage: usage ? {
            inputTokens: (usage.input_tokens as number) ?? 0,
            outputTokens: (usage.output_tokens as number) ?? 0,
            cachedTokens: usage.cached_input_tokens as number | undefined,
          } : { inputTokens: 0, outputTokens: 0 },
          raw: event,
        };
      }

      case 'error': {
        const errorMsg = (e.message as string) ?? (e.error as string) ?? 'Unknown error';
        
        // Filter transient errors (reconnection attempts, retries)
        if (isTransientError(errorMsg)) {
          return null;
        }
        
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

export function createCodexBackend(): CodexBackend {
  return new CodexBackend();
}

// Transient errors are recoverable and should not halt pipelines
const TRANSIENT_ERROR_PATTERNS = [
  /^Reconnecting\.\.\. \d+\/\d+$/,  // Stream reconnection attempts
];

function isTransientError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}
