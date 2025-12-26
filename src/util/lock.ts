import { dirname } from 'path';
import { mkdir } from 'fs/promises';

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;

export interface LockOptions {
  timeout?: number;
  staleThreshold?: number;
}

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockError';
  }
}

function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

async function isLockStale(lockPath: string, staleThreshold: number): Promise<boolean> {
  try {
    const file = Bun.file(lockPath);
    if (!await file.exists()) return true;
    
    const content = await file.text();
    const lockTime = parseInt(content, 10);
    return isNaN(lockTime) || (Date.now() - lockTime > staleThreshold);
  } catch {
    return true;
  }
}

export async function acquireLock(
  filePath: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const { timeout = LOCK_TIMEOUT_MS, staleThreshold = LOCK_STALE_MS } = options;
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();

  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    if (await isLockStale(lockPath, staleThreshold)) {
      try {
        const lockContent = String(Date.now());
        const file = Bun.file(lockPath);
        
        if (await file.exists()) {
          await file.delete();
        }
        
        await Bun.write(lockPath, lockContent);
        
        // Double-check ownership
        const verifyContent = await Bun.file(lockPath).text();
        if (verifyContent === lockContent) {
          return async () => {
            try {
              await Bun.file(lockPath).delete();
            } catch {
              // Ignore errors during unlock
            }
          };
        }
      } catch {
        // Retry
      }
    }

    if (Date.now() - startTime > timeout) {
      throw new LockError(`Failed to acquire lock on ${filePath} within ${timeout}ms`);
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function withLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const unlock = await acquireLock(filePath, options);
  try {
    return await fn();
  } finally {
    await unlock();
  }
}
