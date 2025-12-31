import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { SandboxMode, ReasoningLevel } from '../agent/config';
import { spawnCliWithRetry, commandExists, parseNdjsonStream } from './util/spawn';

function toClaudePermissionMode(sandbox: SandboxMode): string {
  switch (sandbox) {
    case 'read-only': return 'default';
    case 'workspace-write': return 'acceptEdits';
    case 'full': return 'bypassPermissions';
  }
}

/**
 * Map veda reasoning levels to Claude's MAX_THINKING_TOKENS.
 * 0 = no thinking, then 16k-1, 32k-1, 64k-1, 64k-1
 */
function toClaudeReasoningTokens(reasoning: ReasoningLevel): string {
  switch (reasoning) {
    case 'minimal': return '0';
    case 'low': return '15999';     // 16k-1
    case 'medium': return '31999';  // 32k-1
    case 'high': return '63999';    // 64k-1
    case 'xhigh': return '63999';   // 64k-1
  }
}

export class ClaudeBackend implements Backend {
  readonly name = 'claude-code';
  readonly command = 'claude';
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;

    const args: string[] = [];
    if (config.model) args.push('--model', config.model);
    if (config.sandbox) args.push('--permission-mode', toClaudePermissionMode(config.sandbox));

    args.push('--print');
    args.push('--output-format', 'stream-json');
    args.push('--verbose');

    let input = '';
    if (config.systemPrompt) input += `<system_instructions>\n${config.systemPrompt}\n</system_instructions>\n\n`;
    if (context) input += `${context}\n\n`;
    input += prompt;
    args.push(input);

    const env = {
      MAX_THINKING_TOKENS: toClaudeReasoningTokens(config.reasoning),
    };

    const { stdout, process } = await spawnCliWithRetry({ command: this.command, args, cwd, env });
    yield* this.parseStream(stdout);
    await process.exited;
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;

    const args: string[] = ['--resume', sessionId];
    if (config.sandbox) args.push('--permission-mode', toClaudePermissionMode(config.sandbox));

    args.push('--print', '--output-format', 'stream-json', '--verbose');
    args.push(prompt ?? '--continue');

    const env = {
      MAX_THINKING_TOKENS: toClaudeReasoningTokens(config.reasoning),
    };

    const { stdout, process } = await spawnCliWithRetry({ command: this.command, args, cwd, env });
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
      case 'system':
        return {
          type: 'init',
          sessionId: e.session_id as string,
          raw: event,
        };

      case 'assistant': {
        const content = (e.message as Record<string, unknown>)?.content as Array<{ type: string; text?: string }> | undefined;
        if (!content || !Array.isArray(content)) return null;
        
        const textParts = content.filter(c => c.type === 'text').map(c => c.text ?? '').join('');
        if (textParts) return { type: 'text', content: textParts, raw: event };
        
        const toolUse = content.find(c => c.type === 'tool_use') as Record<string, unknown> | undefined;
        if (toolUse) return { type: 'tool_use', toolName: toolUse.name as string, toolInput: toolUse.input, raw: event };
        
        return null;
      }

      case 'user': {
        const content = (e.message as Record<string, unknown>)?.content as Array<{ type: string; output?: unknown }> | undefined;
        if (!content || !Array.isArray(content)) return null;
        
        const toolResult = content.find(c => c.type === 'tool_result') as Record<string, unknown> | undefined;
        if (toolResult) return { type: 'tool_result', toolResult: toolResult.output, raw: event };
        
        return null;
      }

      case 'result': {
        if (e.is_error === true) {
          const errorMsg = (e.result as string) ?? 'Unknown error';
          // Filter transient errors (retry attempts)
          if (isTransientError(errorMsg)) {
            return null;
          }
          return { type: 'error', content: errorMsg, raw: event };
        }
        
        const usage = e.usage as Record<string, unknown> | undefined;
        const cost = e.cost as Record<string, unknown> | undefined;
        
        return {
          type: 'done',
          sessionId: e.session_id as string,
          usage: usage ? {
            inputTokens: (usage.input_tokens as number) ?? 0,
            outputTokens: (usage.output_tokens as number) ?? 0,
            cachedTokens: usage.cache_read_input_tokens as number | undefined,
            costUsd: cost?.total_cost as number | undefined,
          } : { inputTokens: 0, outputTokens: 0 },
          raw: event,
        };
      }

      case 'error': {
        const errorMsg = (e.error as Record<string, unknown>)?.message as string ?? 'Unknown error';
        // Filter transient errors (retry attempts)
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

export function createClaudeBackend(): ClaudeBackend {
  return new ClaudeBackend();
}

// Transient errors are recoverable and should not halt pipelines
const TRANSIENT_ERROR_PATTERNS = [
  /Retrying in \d+ seconds/i,           // API retry messages
  /\(attempt \d+\/\d+\)/i,              // Retry attempt indicators
  /API Error: Connection error/i,        // Connection errors with retry
];

function isTransientError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}
