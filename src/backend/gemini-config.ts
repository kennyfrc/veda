// Gemini CLI configuration manager for temporary thinking level overrides
// InjectsScoped overrides into ~/.gemini/settings.json before running gemini CLI,
// then cleans up by removing the override after execution.

import {
  type ThinkingConfig,
  detectModelGeneration,
  mapReasoningToGeminiConfig,
  type GeminiSettingsSchema,
  type VedaOverride,
  type ConfigManagerState,
  type ConfigError,
} from './gemini-config-types';
import { randomUUID } from 'crypto';
import { rename, unlink } from 'fs/promises';

/**
 * Manages Gemini CLI settings.json lifecycle for veda's thinking configuration.
 *
 * Uses a scoped override approach:
 * 1. Read existing settings.json
 * 2. Create backup with fingerprint
 * 3. Add veda override to modelConfigs.overrides array
 * 4. Write settings.json atomically
 * 5. Execute callback (e.g., spawn gemini CLI)
 * 6. Cleanup: surgically remove veda override
 * 7. Delete backup on success, restore from backup on error
 */
export class GeminiConfigManager {
  private geminiHome: string;
  private settingsPath: string;
  private state: ConfigManagerState = {
    backupFilePath: null,
    overrideId: null,
    originalSettings: null,
    hasModifiedSettings: false,
  };

  constructor(geminiHome?: string) {
    this.geminiHome = geminiHome ?? this.resolveGeminiHome();
    this.settingsPath = `${this.geminiHome}/settings.json`;
  }

  /**
   * Run a callback with a temporary thinking level override in effect.
   *
   * @param reasoning - Veda reasoning level (minimal|low|medium|high|xhigh)
   * @param model - Gemini model name (e.g., "gemini-3-pro-preview")
   * @param callback - Async function to execute with modified config
   * @returns Result from callback
   * @throws ConfigError on any failure (after cleanup)
   */
  async withOverride<T>(
    reasoning: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
    model: string,
    callback: () => Promise<T>
  ): Promise<T> {
    // Check if reasoning is medium (default) - no override needed
    if (reasoning === 'medium') {
      return await callback();
    }

    // Detect model generation
    const gen = detectModelGeneration(model);
    if (gen === 'UNKNOWN') {
      throw this.createError('UNKNOWN_MODEL', `Unknown model generation for: ${model}`);
    }

    // Map reasoning to Gemini config
    const thinkingConfig = mapReasoningToGeminiConfig(reasoning, gen);
    if (!thinkingConfig) {
      throw this.createError('UNKNOWN_MODEL', `Failed to map reasoning to config: ${reasoning}, ${gen}`);
    }

    // Generate unique override ID
    const overrideId = `veda-override-${randomUUID()}`;
    const overrideScope = `veda-session-${randomUUID()}`;

    let result: T;
    let error: Error | undefined;

    try {
      // 1. Read settings.json
      const settings = await this.readSettings();

      // 2. Create backup
      this.state.backupFilePath = await this.createBackup(settings);
      this.state.overrideId = overrideId;
      this.state.originalSettings = JSON.parse(JSON.stringify(settings)); // Deep clone

      // 3. Inject override
      await this.injectOverride(settings, model, overrideScope, overrideId, thinkingConfig);
      this.state.hasModifiedSettings = true;

      // 4. Execute callback
      result = await callback();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      throw error;
    } finally {
      // 5. Cleanup (always runs, even if callback threw)
      await this.cleanup(!!error);
    }

    return result;
  }

  /**
   * Clean up stale veda overrides from previous crashed runs.
   * Called once on veda startup.
   *
   * @param ageHours - Remove overrides older than this many hours
   * @returns Number of overrides removed
   */
  async cleanupStale(ageHours: number = 24): Promise<number> {
    try {
      const settings = await this.readSettings();

      if (!settings.modelConfigs?.overrides || settings.modelConfigs.overrides.length === 0) {
        return 0;
      }

      const now = Date.now();
      const maxAge = ageHours * 60 * 60 * 1000;
      let removedCount = 0;

      const filteredOverrides = settings.modelConfigs.overrides.filter((override) => {
        const vedaMeta = override.veda;
        if (!vedaMeta) return true; // Keep non-veda overrides

        const age = now - vedaMeta.createdAt;
        if (age > maxAge) {
          removedCount++;
          return false; // Remove stale override
        }
        return true; // Keep recent override
      });

      if (removedCount > 0) {
        settings.modelConfigs!.overrides = filteredOverrides;
        await this.writeSettingsAtomically(settings);
        console.warn(`Removed ${removedCount} stale veda override(s) from Gemini settings`);
      }

      return removedCount;
    } catch (e) {
      // Don't fail startup if cleanup fails
      console.warn(`Gemini config cleanup failed: ${e}`);
      return 0;
    }
  }

  private resolveGeminiHome(): string {
    const home = process.env.HOME;
    if (!home) {
      throw this.createError('WRITE_ERROR', 'HOME environment variable not set');
    }
    return `${home}/.gemini`;
  }

  private async readSettings(): Promise<GeminiSettingsSchema> {
    try {
      const file = Bun.file(this.settingsPath);
      
      if (!await file.exists()) {
        // File doesn't exist, return minimal structure
        return {
          modelConfigs: {
            customAliases: {},
            overrides: [],
            aliases: {},
          },
        };
      }

      const text = await file.text();
      const settings: GeminiSettingsSchema = JSON.parse(text);

      // Ensure modelConfigs exists
      if (!settings.modelConfigs) {
        settings.modelConfigs = {
          customAliases: {},
          overrides: [],
          aliases: {},
        };
      }

      return settings;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw this.createError('PARSE_ERROR', this.settingsPath, e);
      }
      throw this.createError('READ_ERROR', this.settingsPath, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async createBackup(settings: GeminiSettingsSchema): Promise<string> {
    const timestamp = Date.now();
    const uuid = randomUUID();
    const backupPath = `${this.geminiHome}/.veda_gemini_backup_${timestamp}_${uuid}.json`;

    try {
      // Write backup atomic
      const tempPath = `${backupPath}.tmp`;
      const content = JSON.stringify(settings, null, 2);
      await Bun.write(tempPath, content);
      await rename(tempPath, backupPath);

      return backupPath;
    } catch (e) {
      throw this.createError('BACKUP_ERROR', backupPath, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async injectOverride(
    settings: GeminiSettingsSchema,
    model: string,
    overrideScope: string,
    overrideId: string,
    thinkingConfig: ThinkingConfig
  ): Promise<void> {
    const override: VedaOverride = {
      match: {
        model,
        overrideScope,
      },
      veda: {
        overrideId,
        createdAt: Date.now(),
        reasoningLevel: this.getCurrentReasoningLevel(thinkingConfig),
      },
      modelConfig: {
        generateContentConfig: {
          thinkingConfig,
        },
      },
    };

    // Ensure overrides array exists
    if (!settings.modelConfigs!.overrides) {
      settings.modelConfigs!.overrides = [];
    }

    settings.modelConfigs!.overrides.push(override);

    try {
      await this.writeSettingsAtomically(settings);
    } catch (e) {
      throw this.createError('WRITE_ERROR', this.settingsPath, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private async writeSettingsAtomically(settings: GeminiSettingsSchema): Promise<void> {
    const tempPath = `${this.settingsPath}.tmp`;
    const content = JSON.stringify(settings, null, 2);
    
    await Bun.write(tempPath, content);
    await rename(tempPath, this.settingsPath);
  }

  private async cleanup(hadError: boolean): Promise<void> {
    const { backupFilePath, hasModifiedSettings } = this.state;

    if (!hasModifiedSettings) {
      // No modifications made, nothing to clean up
      this.resetState();
      return;
    }

    try {
      // Read current settings (might have been modified by gemini CLI)
      const currentSettings = await this.readSettings();

      // Surgical remove: filter out veda overrides
      if (currentSettings.modelConfigs?.overrides) {
        currentSettings.modelConfigs.overrides = currentSettings.modelConfigs.overrides.filter(
          (override) => !override.veda?.overrideId.startsWith('veda-override-')
        );
      }

      // Write cleaned settings
      await this.writeSettingsAtomically(currentSettings);

      // If no error, delete backup file
      if (!hadError && backupFilePath) {
        try {
          await unlink(backupFilePath);
        } catch (e) {
          // Non-critical, file will be cleaned up by cleanupStale later
          console.warn(`Failed to delete backup file: ${backupFilePath}`);
        }
      }
    } catch (e) {
      // Cleanup failed, try restore from backup
      console.warn('Config cleanup failed, attempting to restore from backup...');
      if (backupFilePath) {
        await this.restoreFromBackup(backupFilePath);
      } else {
        console.error('No backup available, config may be corrupted');
      }
    }

    this.resetState();
  }

  private async restoreFromBackup(backupPath: string): Promise<void> {
    try {
      const backupFile = Bun.file(backupPath);
      if (!await backupFile.exists()) {
        throw new Error('Backup file missing');
      }

      const content = await backupFile.text();
      await Bun.write(this.settingsPath, content);
      console.warn('Restored settings from backup');
    } catch (e) {
      console.error(`Failed to restore from backup ${backupPath}:`, e);
      throw this.createError('RESTORE_ERROR', backupPath, e instanceof Error ? e : new Error(String(e)));
    }
  }

  private resetState(): void {
    this.state = {
      backupFilePath: null,
      overrideId: null,
      originalSettings: null,
      hasModifiedSettings: false,
    };
  }

  private getCurrentReasoningLevel(config: ThinkingConfig): string {
    if (config.gen === 'GEN_3') {
      return config.thinkingLevel;
    }
    return config.thinkingBudget.toString();
  }

  private createError(type: ConfigError['type'], message: string, cause?: Error): ConfigError {
    // For error types that don't accept optional cause (UNKNOWN_MODEL, READ_ONLY_MODE)
    if (type === 'UNKNOWN_MODEL' || type === 'READ_ONLY_MODE') {
      return { type, message } as ConfigError;
    }
    return { type, message, cause } as ConfigError;
  }
}
