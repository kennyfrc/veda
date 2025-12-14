/**
 * Claude Backend - Anthropic's CLI agent.
 * 
 * JSON Format (with --output-format stream-json --verbose):
 * - Init: {"type":"system","subtype":"init","session_id":"UUID",...}
 * - Message: {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 * - Done: {"type":"result","usage":{"input_tokens":N,"output_tokens":M},"session_id":"..."}
 * 
 * Notes:
 * - Requires --verbose flag with --output-format stream-json
 * - Uses positional prompt argument, not --prompt flag
 * - --print flag required for non-interactive mode
 * 
 * System Prompt: Flag-based (--system-prompt "...")
 */

import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import type { SandboxMode } from '../agent/config';
import { spawnCli, commandExists, parseNdjsonStream } from './util/spawn';

/**
 * Map veda sandbox mode to Claude's --permission-mode.
 * Claude uses: default (prompt), acceptEdits (auto-edit), bypassPermissions (full access)
 */
function toClaudePermissionMode(sandbox: SandboxMode): string {
  switch (sandbox) {
    case 'read-only': return 'default';
    case 'workspace-write': return 'acceptEdits';
    case 'full': return 'bypassPermissions';
  }
}

export class ClaudeBackend implements Backend {
  readonly name = 'claude';
  readonly command = 'claude';
  // Claude uses flag-based system prompt, not file
  readonly systemPromptFile = undefined;

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;
    
    const args: string[] = [];
    
    // Model
    if (config.model) {
      args.push('--model', config.model);
    }
    
    // System prompt via flag
    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    }
    
    // Permission mode (maps from veda sandbox mode)
    if (config.sandbox) {
      args.push('--permission-mode', toClaudePermissionMode(config.sandbox));
    }
    
    // Non-interactive mode
    args.push('--print');
    
    // JSON output mode (requires --verbose)
    args.push('--output-format', 'stream-json');
    args.push('--verbose');
    
    // Build input: context + prompt (positional argument, not --prompt flag)
    const input = context ? `${context}\n\n${prompt}` : prompt;
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
    
    // Resume with session ID
    args.push('--resume', sessionId);
    
    // Permission mode (maps from veda sandbox mode)
    if (config.sandbox) {
      args.push('--permission-mode', toClaudePermissionMode(config.sandbox));
    }
    
    // Non-interactive mode
    args.push('--print');
    
    // JSON output mode (requires --verbose)
    args.push('--output-format', 'stream-json');
    args.push('--verbose');
    
    if (prompt) {
      // Positional prompt
      args.push(prompt);
    } else {
      // Use --continue for continuing without new prompt
      args.push('--continue');
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
   * Parse Claude NDJSON stream into normalized messages.
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
   * Normalize a Claude event to our Message type.
   */
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
        const message = e.message as Record<string, unknown> | undefined;
        const content = message?.content as Array<{ type: string; text?: string }> | undefined;
        
        if (!content || !Array.isArray(content)) return null;
        
        // Extract text from content blocks
        const textParts = content
          .filter(c => c.type === 'text')
          .map(c => c.text ?? '')
          .join('');
        
        if (textParts) {
          return {
            type: 'text',
            content: textParts,
            raw: event,
          };
        }
        
        // Check for tool use
        const toolUse = content.find(c => c.type === 'tool_use') as Record<string, unknown> | undefined;
        if (toolUse) {
          return {
            type: 'tool_use',
            toolName: toolUse.name as string,
            toolInput: toolUse.input,
            raw: event,
          };
        }
        
        return null;
      }

      case 'user': {
        // Tool result from user
        const message = e.message as Record<string, unknown> | undefined;
        const content = message?.content as Array<{ type: string; output?: unknown }> | undefined;
        
        if (!content || !Array.isArray(content)) return null;
        
        const toolResult = content.find(c => c.type === 'tool_result') as Record<string, unknown> | undefined;
        if (toolResult) {
          return {
            type: 'tool_result',
            toolResult: toolResult.output,
            raw: event,
          };
        }
        
        return null;
      }

      case 'result': {
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

      case 'error':
        return {
          type: 'error',
          content: (e.error as Record<string, unknown>)?.message as string ?? 'Unknown error',
          raw: event,
        };

      default:
        return null;
    }
  }
}

/**
 * Create a Claude backend instance.
 */
export function createClaudeBackend(): ClaudeBackend {
  return new ClaudeBackend();
}
