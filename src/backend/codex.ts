// Codex backend - uses `codex exec` with AGENTS.md in --cd directory for system prompt.

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
    
    const args: string[] = ['exec'];
    
    if (config.model) {
      args.push('-m', config.model);
    }
    
    args.push('-c', `model_reasoning_effort="${config.reasoning}"`);
    args.push('-c', 'model_reasoning_summary="concise"');
    args.push('--sandbox', toCodexSandbox(config.sandbox ?? 'read-only'));
    
    // Codex reads system prompt from AGENTS.md in working directory.
    // If cwd provided, write there (allows file access); otherwise use temp dir.
    let cleanup: (() => Promise<void>) | undefined;
    let workingDir: string | undefined;
    
    if (config.systemPrompt) {
      if (cwd) {
        const result = await this.writeSystemPromptToDir(cwd, config.systemPrompt);
        cleanup = result.cleanup;
        workingDir = cwd;
      } else {
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
    
    const input = context ? `${context}\n\n${prompt}` : prompt;
    args.push('-'); // Read from stdin to avoid arg length limits
    
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
      if (cleanup) await cleanup();
    }
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

  private async createTempPromptDir(systemPrompt: string): Promise<string> {
    const tempDir = join(tmpdir(), `veda-codex-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, this.systemPromptFile!), systemPrompt);
    return tempDir;
  }

  /** Writes AGENTS.md, backing up existing. Cleanup restores original. */
  private async writeSystemPromptToDir(
    dir: string,
    systemPrompt: string
  ): Promise<{ cleanup: () => Promise<void> }> {
    const agentsPath = join(dir, this.systemPromptFile!);
    const backupPath = join(dir, `.AGENTS.md.veda-backup-${Date.now()}`);
    
    let hadExisting = false;
    try {
      await stat(agentsPath);
      hadExisting = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
    
    if (hadExisting) await rename(agentsPath, backupPath);
    
    try {
      await writeFile(agentsPath, systemPrompt);
    } catch (writeError) {
      if (hadExisting) {
        await rm(agentsPath, { force: true }).catch(() => {});
        await rename(backupPath, agentsPath).catch(() => {});
      }
      throw writeError;
    }
    
    return {
      cleanup: async () => {
        try {
          await rm(agentsPath, { force: true });
          if (hadExisting) await rename(backupPath, agentsPath);
        } catch { /* best effort */ }
      }
    };
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

export function createCodexBackend(): CodexBackend {
  return new CodexBackend();
}
