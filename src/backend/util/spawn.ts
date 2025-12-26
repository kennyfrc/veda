import type { Subprocess } from 'bun';

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
}

export interface SpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  process: Subprocess;
}

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 6) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 250) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 2000) */
  maxDelayMs?: number;
  /** Maximum total time in ms (default: 15000) */
  maxTotalMs?: number;
  /** Enable small random jitter to spread retries (default: true) */
  jitter?: boolean;
  /** Optional callback on each retry attempt */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Check if a spawn error is ENOENT (executable not found).
 */
export function isSpawnEnoent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;
  
  // Check Bun's error.code
  if (err.code === 'ENOENT') return true;
  
  // Check error message patterns
  const message = err.message as string | undefined;
  if (message && typeof message === 'string') {
    return message.includes('Executable not found') || 
           message.includes('ENOENT');
  }
  
  return false;
}

/**
 * Compute delay for exponential backoff with optional jitter.
 */
export function computeBackoffMs(
  attempt: number,
  options: RetryOptions = {}
): number {
  const {
    baseDelayMs = 250,
    maxDelayMs = 2000,
    jitter = true,
  } = options;

  // Exponential: base * 2^attempt
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  
  // Add jitter if enabled (±20%)
  if (jitter) {
    const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
    return Math.floor(delay * jitterFactor);
  }
  
  return delay;
}

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function spawnCli(options: SpawnOptions): SpawnResult {
  const spawnOptions: {
    cwd?: string;
    stdin: 'pipe' | 'ignore' | 'inherit';
    stdout: 'pipe' | 'inherit';
    stderr: 'pipe' | 'inherit';
    env?: Record<string, string>;
  } = {
    cwd: options.cwd,
    stdin: options.stdin ? 'pipe' : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  };

  if (options.env) {
    spawnOptions.env = { ...process.env, ...options.env } as Record<string, string>;
  }

  const proc = Bun.spawn([options.command, ...options.args], spawnOptions);

  if (options.stdin && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }

  return {
    stdout: proc.stdout as ReadableStream<Uint8Array>,
    stderr: proc.stderr as ReadableStream<Uint8Array>,
    process: proc,
  };
}

/**
 * Spawn a CLI with automatic retry on ENOENT errors.
 * 
 * This handles transient cases where an executable is momentarily unavailable
 * (e.g., self-updating CLI tools like Gemini).
 */
export async function spawnCliWithRetry(
  options: SpawnOptions,
  retryOptions: RetryOptions = {}
): Promise<SpawnResult> {
  const {
    maxAttempts = 6,
    maxTotalMs = 15000,
    onRetry,
  } = retryOptions;

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return spawnCli(options);
    } catch (error) {
      // Check if this is an ENOENT error (retryable)
      if (!isSpawnEnoent(error)) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we've exceeded total time budget
      const elapsed = Date.now() - startTime;
      if (elapsed >= maxTotalMs) {
        throw new Error(
          `Failed to spawn "${options.command}" after ${attempt} attempt(s) ` +
          `over ${Math.round(elapsed)}ms. The CLI may be updating or not installed. ` +
          `Last error: ${lastError.message}`
        );
      }

      // Compute and apply backoff
      const delayMs = computeBackoffMs(attempt - 1, retryOptions);
      
      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt, lastError, delayMs);
      }

      await sleep(delayMs);
    }
  }

  // Should have thrown inside loop, but just in case
  throw lastError ?? new Error(`Failed to spawn "${options.command}" after ${maxAttempts} attempts`);
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
