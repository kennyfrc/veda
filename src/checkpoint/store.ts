/**
 * CheckpointStore: Persistence for deep mode checkpoints.
 * 
 * Mirrors ConversationStore pattern - same locking, same directory structure.
 * Checkpoints are stored as YAML for human readability and trace compatibility.
 */

import { mkdir } from 'fs/promises';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { withLock } from '../util/lock';
import {
  getCheckpointPath,
  getSessionDir,
  isValidSessionId,
} from '../util/paths';
import type { DeepThinkCheckpoint } from './types';

export interface CheckpointStoreOptions {
  sessionId: string;
  baseDir?: string;
}

export class CheckpointStore {
  private readonly checkpointPath: string;
  private readonly sessionDir: string;

  constructor(options: CheckpointStoreOptions) {
    if (!isValidSessionId(options.sessionId)) {
      throw new Error(`Invalid session ID: ${options.sessionId}`);
    }
    
    this.checkpointPath = getCheckpointPath(options.sessionId, options.baseDir);
    this.sessionDir = getSessionDir(options.sessionId, options.baseDir);
  }

  /**
   * Save checkpoint for current session.
   * Overwrites any existing checkpoint.
   */
  async save(checkpoint: DeepThinkCheckpoint): Promise<void> {
    await withLock(this.checkpointPath, async () => {
      await mkdir(this.sessionDir, { recursive: true });

      // Update timestamp
      const checkpointWithTimestamp: DeepThinkCheckpoint = {
        ...checkpoint,
        timestamp: new Date().toISOString(),
      };

      const yaml = yamlStringify(checkpointWithTimestamp, {
        lineWidth: 120,
        defaultKeyType: 'PLAIN',
        blockQuote: 'literal',
        collectionStyle: 'block',
      });

      await Bun.write(this.checkpointPath, yaml);
    });
  }

  /**
   * Load checkpoint for current session.
   * Returns null if no checkpoint exists.
   */
  async load(): Promise<DeepThinkCheckpoint | null> {
    return await withLock(this.checkpointPath, async () => {
      try {
        const file = Bun.file(this.checkpointPath);
        if (!await file.exists()) {
          return null;
        }
        
        const content = await file.text();
        const parsed = yamlParse(content);
        
        // Validate checkpoint version
        if (parsed?.checkpoint_version !== 1) {
          console.warn(`Unknown checkpoint version: ${parsed?.checkpoint_version}`);
          return null;
        }
        
        return parsed as DeepThinkCheckpoint;
      } catch {
        // Ignore parse errors - treat as no checkpoint
        return null;
      }
    });
  }

  /**
   * Check if a checkpoint exists (without full load).
   */
  async exists(): Promise<boolean> {
    try {
      const file = Bun.file(this.checkpointPath);
      return await file.exists();
    } catch {
      return false;
    }
  }

  /**
   * Clear (delete) checkpoint.
   * Called on successful completion.
   */
  async clear(): Promise<void> {
    await withLock(this.checkpointPath, async () => {
      try {
        const file = Bun.file(this.checkpointPath);
        if (await file.exists()) {
          await file.delete();
        }
      } catch {
        // Ignore if doesn't exist
      }
    });
  }

  /**
   * Get summary info for display (without loading full checkpoint).
   * Returns null if no checkpoint exists.
   */
  async getSummary(): Promise<{
    completedStage: string;
    failedStage?: string;
    candidateCount: number;
    timestamp: string;
  } | null> {
    const checkpoint = await this.load();
    if (!checkpoint) return null;

    return {
      completedStage: checkpoint.completedStage,
      failedStage: checkpoint.failedStage,
      candidateCount: checkpoint.successfulCandidateIds.length,
      timestamp: checkpoint.timestamp,
    };
  }
}
