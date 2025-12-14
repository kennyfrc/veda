/**
 * File locking utilities for atomic selection operations.
 * 
 * Uses a simple lockfile approach with timeout and stale lock detection.
 */

import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';

const LOCK_TIMEOUT_MS = 5000; // 5 seconds
const LOCK_STALE_MS = 30000; // 30 seconds - locks older than this are considered stale

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

/**
 * Get lockfile path for a given file
 */
function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Check if a lock is stale (older than threshold)
 */
async function isLockStale(lockPath: string, staleThreshold: number): Promise<boolean> {
  try {
    const file = Bun.file(lockPath);
    const stat = await file.exists() ? { mtime: new Date() } : null;
    if (!stat) return true;
    
    // Read the lock content to get creation time
    const content = await file.text();
    const lockTime = parseInt(content, 10);
    if (isNaN(lockTime)) return true;
    
    return Date.now() - lockTime > staleThreshold;
  } catch {
    return true;
  }
}

/**
 * Attempt to acquire a lock on the given file path
 */
export async function acquireLock(
  filePath: string,
  options: LockOptions = {}
): Promise<() => Promise<void>> {
  const { timeout = LOCK_TIMEOUT_MS, staleThreshold = LOCK_STALE_MS } = options;
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();

  // Ensure parent directory exists
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    // Check for stale lock
    if (await isLockStale(lockPath, staleThreshold)) {
      try {
        // Try to create the lock file atomically
        const lockContent = String(Date.now());
        const file = Bun.file(lockPath);
        
        // Check if file exists
        if (await file.exists()) {
          // Stale lock - remove and retry
          await file.delete();
        }
        
        // Create lock
        await Bun.write(lockPath, lockContent);
        
        // Verify we own the lock
        const verifyContent = await Bun.file(lockPath).text();
        if (verifyContent === lockContent) {
          // We got the lock
          return async () => {
            try {
              await Bun.file(lockPath).delete();
            } catch {
              // Ignore errors during unlock
            }
          };
        }
      } catch {
        // Lock acquisition failed, will retry
      }
    }

    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new LockError(`Failed to acquire lock on ${filePath} within ${timeout}ms`);
    }

    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Execute a function while holding a lock on the given file
 */
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
