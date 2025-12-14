/**
 * Codex Backend - OpenAI's CLI agent.
 * 
 * JSON Format (with --json flag):
 * - Init: {"type":"thread.started","thread_id":"UUID"}
 * - Message: {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 * - Done: {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":M,"cached_input_tokens":K}}
 * 
 * Notes:
 * - Uses `codex exec` subcommand for non-interactive mode
 * - Prompt can be positional or via stdin (with `-`)
 * 
 * System Prompt: File-based (AGENTS.md in --cd directory)
 */

import type { Backend, Message, RunOptions, ResumeOptions, UsageStats } from './types';
import { spawnCli, commandExists, parseNdjsonStream } from './util/spawn';
import { toCodexSandbox } from '../agent';
import { mkdir, writeFile, rm, stat, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

export class CodexBackend implements Backend {
  readonly name = 'codex';
  readonly command = 'codex';
  readonly systemPromptFile = 'AGENTS.md';

  async *run(options: RunOptions): AsyncIterable<Message> {
    const { prompt, context, config, cwd } = options;
    
    // Build codex args
    const args: string[] = ['exec'];
    
    if (config.model) {
      args.push('-m', config.model);
    }
    
    args.push('-c', `model_reasoning_effort="${config.reasoning}"`);
    args.push('-c', 'model_reasoning_summary="concise"');
    // Map our sandbox mode to codex's expected values
    const sandboxMode = toCodexSandbox(config.sandbox ?? 'read-only');
    args.push('--sandbox', sandboxMode);
    
    // Handle system prompt - codex requires AGENTS.md in the working directory
    // We need to ensure the agent can access project files when cwd is provided
    let cleanup: (() => Promise<void>) | undefined;
    let workingDir: string | undefined;
    
    if (config.systemPrompt) {
      if (cwd) {
        // Write AGENTS.md to the project directory so agent can access project files
        // This is important for read-only sandbox mode where agent needs to inspect code
        const result = await this.writeSystemPromptToDir(cwd, config.systemPrompt);
        cleanup = result.cleanup;
        workingDir = cwd;
      } else {
        // No cwd specified, use temp directory (original behavior)
        const tempDir = await this.createTempPromptDir(config.systemPrompt);
        cleanup = async () => {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        };
        workingDir = tempDir;
      }
      args.push('--cd', workingDir);
      args.push('--skip-git-repo-check');
    } else if (config.systemPromptPath) {
      args.push('--cd', dirname(config.systemPromptPath));
      args.push('--skip-git-repo-check');
    }
    
    args.push('--json');
    
    // Build input: context + prompt or just prompt
    const input = context ? `${context}\n\n${prompt}` : prompt;
    
    // Use stdin (-) for input to avoid shell argument length limits with large contexts
    args.push('-');
    
    try {
      const { stdout, process } = spawnCli({
        command: this.command,
        args,
        cwd: workingDir ?? cwd,
        stdin: input,
      });

      yield* this.parseStream(stdout);
      
      await process.exited;
    } finally {
      // Cleanup system prompt file/directory
      if (cleanup) {
        await cleanup();
      }
    }
  }

  async *resume(options: ResumeOptions): AsyncIterable<Message> {
    const { sessionId, prompt, config, cwd } = options;
    
    // Note: --json must come before 'resume' subcommand
    const args: string[] = ['exec', '--json', 'resume', sessionId];
    
    if (prompt) {
      args.push('--', prompt);
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
   * Create a temporary directory with AGENTS.md for system prompt.
   */
  private async createTempPromptDir(systemPrompt: string): Promise<string> {
    const tempDir = join(tmpdir(), `veda-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, this.systemPromptFile!), systemPrompt);
    return tempDir;
  }

  /**
   * Write system prompt to a directory, backing up any existing AGENTS.md.
   * Returns a cleanup function that restores the original state.
   * 
   * If write fails after backup, the original file is restored before throwing.
   */
  private async writeSystemPromptToDir(
    dir: string,
    systemPrompt: string
  ): Promise<{ cleanup: () => Promise<void> }> {
    const agentsPath = join(dir, this.systemPromptFile!);
    const backupPath = join(dir, `.AGENTS.md.veda-backup-${Date.now()}`);
    
    // Check if AGENTS.md already exists and back it up
    let hadExisting = false;
    try {
      await stat(agentsPath);
      hadExisting = true;
    } catch (err) {
      // Only treat ENOENT as "file doesn't exist"; rethrow other errors
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
    
    // If file exists, back it up (fail if rename fails to avoid overwriting without backup)
    if (hadExisting) {
      await rename(agentsPath, backupPath);
    }
    
    // Write our system prompt - restore backup on failure
    try {
      await writeFile(agentsPath, systemPrompt);
    } catch (writeError) {
      // Restore backup if we had one, then rethrow
      if (hadExisting) {
        // Remove any partial/failed file first (required on Windows where rename fails if dest exists)
        await rm(agentsPath, { force: true }).catch(() => {});
        await rename(backupPath, agentsPath).catch(() => {});
      }
      throw writeError;
    }
    
    // Return cleanup function
    const cleanup = async () => {
      try {
        // Remove our file
        await rm(agentsPath, { force: true });
        
        // Restore backup if there was one
        if (hadExisting) {
          await rename(backupPath, agentsPath);
        }
      } catch {
        // Best effort cleanup
      }
    };
    
    return { cleanup };
  }

  /**
   * Parse codex NDJSON stream into normalized messages.
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
   * Normalize a codex event to our Message type.
   */
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
        
        return null;
      }

      case 'turn.completed': {
        const usage = e.usage as Record<string, unknown> | undefined;
        return {
          type: 'done',
          usage: usage ? {
            inputTokens: (usage.input_tokens as number) ?? 0,
            outputTokens: (usage.output_tokens as number) ?? 0,
            // Codex uses 'cached_input_tokens' not 'cached_tokens'
            cachedTokens: usage.cached_input_tokens as number | undefined,
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
 * Create a Codex backend instance.
 */
export function createCodexBackend(): CodexBackend {
  return new CodexBackend();
}
