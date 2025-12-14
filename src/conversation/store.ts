/**
 * Conversation Store - Manages thread/session persistence.
 */

import { mkdir } from 'fs/promises';
import {
  getThreadPath,
  getLegacyThreadPath,
  getSessionDir,
  isValidSessionId,
} from '../util/paths';
import type { ThreadInfo } from './types';

export interface ConversationStoreOptions {
  sessionId: string;
  baseDir?: string;
}

export class ConversationStore {
  private readonly threadPath: string;
  private readonly legacyPath: string;
  private readonly sessionDir: string;

  constructor(options: ConversationStoreOptions) {
    if (!isValidSessionId(options.sessionId)) {
      throw new Error(`Invalid session ID: ${options.sessionId}`);
    }
    
    this.threadPath = getThreadPath(options.sessionId, options.baseDir);
    this.legacyPath = getLegacyThreadPath(options.sessionId, options.baseDir);
    this.sessionDir = getSessionDir(options.sessionId, options.baseDir);
  }

  /**
   * Save thread info for current session.
   */
  async save(info: Omit<ThreadInfo, 'createdAt' | 'lastUsedAt'>): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    
    // Check if existing thread
    const existing = await this.load();
    
    const threadInfo: ThreadInfo = {
      ...info,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };
    
    await Bun.write(this.threadPath, JSON.stringify(threadInfo, null, 2));
  }

  /**
   * Load thread info for current session.
   * Automatically migrates from legacy format if needed.
   */
  async load(): Promise<ThreadInfo | null> {
    // Try new format first
    try {
      const file = Bun.file(this.threadPath);
      if (await file.exists()) {
        const content = await file.json();
        return content as ThreadInfo;
      }
    } catch {
      // Ignore parse errors
    }
    
    // Try legacy format
    try {
      const legacyFile = Bun.file(this.legacyPath);
      if (await legacyFile.exists()) {
        const threadId = (await legacyFile.text()).trim();
        if (threadId) {
          // Migrate to new format
          const info: ThreadInfo = {
            backend: 'codex', // Legacy was always codex
            threadId,
            createdAt: new Date().toISOString(),
            lastUsedAt: new Date().toISOString(),
          };
          
          // Save in new format (directly, not via save() to avoid recursion)
          await mkdir(this.sessionDir, { recursive: true });
          await Bun.write(this.threadPath, JSON.stringify(info, null, 2));
          
          return info;
        }
      }
    } catch {
      // Ignore errors
    }
    
    return null;
  }

  /**
   * Get thread ID for resume (convenience method).
   */
  async getThreadId(): Promise<string | null> {
    const info = await this.load();
    return info?.threadId ?? null;
  }

  /**
   * Get backend name for resume.
   */
  async getBackend(): Promise<string | null> {
    const info = await this.load();
    return info?.backend ?? null;
  }

  /**
   * Clear thread info.
   */
  async clear(): Promise<void> {
    try {
      await Bun.file(this.threadPath).delete();
    } catch {
      // Ignore if doesn't exist
    }
  }

  /**
   * Check if a thread exists.
   */
  async exists(): Promise<boolean> {
    return (await this.load()) !== null;
  }
}
