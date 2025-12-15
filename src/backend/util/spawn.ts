import type { Subprocess } from 'bun';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
}

export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  process: Subprocess;
}

export function spawnCli(options: SpawnOptions): SpawnResult {
  const proc = Bun.spawn([options.command, ...options.args], {
    cwd: options.cwd,
    stdin: options.stdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (options.stdin && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }

  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    process: proc,
  };
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export async function* parseNdjsonStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (buffer.trim()) {
          try { yield JSON.parse(buffer); } catch { /* ignore malformed */ }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try { yield JSON.parse(trimmed); } catch { /* skip malformed */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
