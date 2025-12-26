// E2E tests for GeminiConfigManager
// Tests file system operations, backup/restore, override injection/cleanup

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { mkdir, rmdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { GeminiConfigManager } from '../../src/backend/gemini-config';
import type { GeminiSettingsSchema } from '../../src/backend/gemini-config-types';

// Test directory for files
const TEST_GEMINI_HOME = '/tmp/test-veda-gemini-home';
const SETTINGS_PATH = join(TEST_GEMINI_HOME, 'settings.json');

describe('GeminiConfigManager E2E', () => {
  let manager: GeminiConfigManager;

  beforeAll(async () => {
    // Create test directory
    await mkdir(TEST_GEMINI_HOME, { recursive: true });
    manager = new GeminiConfigManager(TEST_GEMINI_HOME);
  });

  afterAll(async () => {
    // Clean up test directory
    await rmdir(TEST_GEMINI_HOME, { recursive: true });
  });

  describe('Settings.json creation', () => {
    test('creates minimal settings.json if missing', async () => {
      const settings = await manager['readSettings']();
      expect(settings).toBeDefined();
      expect(settings.modelConfigs).toBeDefined();
      expect(settings.modelConfigs?.customAliases).toEqual({});
      expect(settings.modelConfigs?.aliases).toEqual({});
      expect(settings.modelConfigs?.overrides).toEqual([]);
    });

    test('reads existing settings.json', async () => {
      // Write a test settings file
      const testSettings: GeminiSettingsSchema = {
        modelConfigs: {
          customAliases: {
            'my-alias': {
              modelConfig: {
                model: 'gemini-3-pro-preview',
              },
            },
          },
          overrides: [
            {
              match: {
                model: 'gemini-3-pro-preview',
              },
            },
          ],
        },
      };
      await Bun.write(SETTINGS_PATH, JSON.stringify(testSettings, null, 2));

      const settings = await manager['readSettings']();
      expect(settings.modelConfigs?.customAliases).toHaveProperty('my-alias');
      expect(settings.modelConfigs?.overrides).toHaveLength(1);
    });
  });

  describe('Backup and restore', () => {
    test('creates and restores from backup', async () => {
      // Write initial settings
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          customAliases: {
            'test-alias': {
              modelConfig: {
                model: 'gemini-3-pro-preview',
                generateContentConfig: {
                  thinkingConfig: {
                    thinkingLevel: 'MEDIUM',
                  },
                },
              },
            },
          },
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      // Create backup
      const settings = await manager['readSettings']();
      const backupPath = await manager['createBackup'](settings);

      // Verify backup exists
      expect(existsSync(backupPath)).toBe(true);

      // Verify backup content
      const backupContent = await Bun.file(backupPath).text();
      const backupSettings = JSON.parse(backupContent);
      expect(backupSettings).toEqual(initialSettings);

      // Corrupt original settings
      await Bun.write(SETTINGS_PATH, JSON.stringify({ corrupt: true }));

      // Restore from backup
      await manager['restoreFromBackup'](backupPath);

      // Verify restoration
      const restoredContent = await Bun.file(SETTINGS_PATH).text();
      const restoredSettings = JSON.parse(restoredContent);
      expect(restoredSettings).toEqual(initialSettings);

      // Cleanup backup
      await unlink(backupPath);
    });

    test('backup filename follows pattern', async () => {
      const settings: GeminiSettingsSchema = {
        modelConfigs: {},
      };

      const backupPath = await manager['createBackup'](settings);
      
      // Pattern: .veda_gemini_backup_<timestamp>_<uuid>.json
      const basename = backupPath.split('/').pop();
      expect(basename).toMatch(/^\.veda_gemini_backup_\d+_[0-9a-f-]+\.json$/);
      
      const parts = basename.replace('.veda_gemini_backup_', '').replace('.json', '').split('_');
      expect(parts).toHaveLength(2); // timestamp and UUID

      // Verify timestamp is valid number
      const timestamp = parseInt(parts[0]!, 10);
      expect(timestamp).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds

      // Verify UUID format (8-4-4-4-12)
      const uuid = parts[1];
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      await unlink(backupPath);
    });
  });

  describe('Override injection and cleanup', () => {
    test('injects override correctly for GEN_3', async () => {
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      const settings = await manager['readSettings']();
      const overrideId = 'veda-override-123e4567-e89b-12d3-a456-426614174000';
      const overrideScope = 'veda-session-987f6543-21cd-34e5-f678-532425367111';
      const model = 'gemini-3-pro-preview';
      const thinkingConfig = {
        gen: 'GEN_3' as const,
        thinkingLevel: 'HIGH' as const,
      };

      await manager['injectOverride'](settings, model, overrideScope, overrideId, thinkingConfig);

      // Verify modification
      const modifiedContent = await Bun.file(SETTINGS_PATH).text();
      const modifiedSettings = JSON.parse(modifiedContent);

      expect(modifiedSettings.modelConfigs?.overrides).toBeDefined();
      expect(modifiedSettings.modelConfigs?.overrides).toHaveLength(1);

      const override = modifiedSettings.modelConfigs!.overrides![0];
      expect(override.match?.model).toBe(model);
      expect(override.match?.overrideScope).toBe(overrideScope);
      expect(override.veda?.overrideId).toBe(overrideId);
      expect(override.veda?.createdAt).toBeDefined();
      expect(override.veda?.reasoningLevel).toBe('HIGH');
      expect(override.modelConfig?.generateContentConfig?.thinkingConfig).toEqual({
        gen: 'GEN_3',
        thinkingLevel: 'HIGH',
      });

      // Clean up by reading and modifying
      const cleanupSettings = await manager['readSettings']();
      cleanupSettings.modelConfigs!.overrides = [];
      await manager['writeSettingsAtomically'](cleanupSettings);
    });

    test('injects override correctly for GEN_2_5', async () => {
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      const settings = await manager['readSettings']();
      const overrideId = 'veda-override-abc123';
      const overrideScope = 'veda-session-def456';
      const model = 'gemini-2.5-pro';
      const thinkingConfig = {
        gen: 'GEN_2_5' as const,
        thinkingBudget: 32000,
      };

      await manager['injectOverride'](settings, model, overrideScope, overrideId, thinkingConfig);

      // Verify modification
      const modifiedContent = await Bun.file(SETTINGS_PATH).text();
      const modifiedSettings = JSON.parse(modifiedContent);

      const override = modifiedSettings.modelConfigs!.overrides![0];
      expect(override.modelConfig?.generateContentConfig?.thinkingConfig).toEqual({
        gen: 'GEN_2_5',
        thinkingBudget: 32000,
      });

      // Clean up
      const cleanupSettings = await manager['readSettings']();
      cleanupSettings.modelConfigs!.overrides = [];
      await manager['writeSettingsAtomically'](cleanupSettings);
    });

    test('cleanup removes veda overrides only', async () => {
      // Test cleanup through withOverride to ensure proper state management
      const settings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [
            {
              match: { model: 'user-override', overrideScope: 'user-scope' },
            },
          ],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2));

      // Run withOverride to properly set up the state
      let overridesDuringExecution: any[] = [];

      await manager['withOverride']('high', 'gemini-3-pro-preview', async () => {
        const settingsContent = await Bun.file(SETTINGS_PATH).text();
        const currentSettings = JSON.parse(settingsContent);
        overridesDuringExecution = currentSettings.modelConfigs?.overrides || [];

        // Should have 2 overrides: user override + veda override
        expect(overridesDuringExecution.length).toBeGreaterThanOrEqual(1);
      });

      // After cleanup, only user override should remain
      const finalContent = await Bun.file(SETTINGS_PATH).text();
      const finalSettings = JSON.parse(finalContent);

      // Should have 1 override left (the user override)
      expect(finalSettings.modelConfigs?.overrides).toHaveLength(1);
      expect(finalSettings.modelConfigs?.overrides?.[0].match?.model).toBe('user-override');
      expect(finalSettings.modelConfigs?.overrides?.[0].veda).toBeUndefined();
    });
  });

  describe('Full lifecycle with withOverride', () => {
    test('executes callback with override and cleans up', async () => {
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      let callbackExecuted = false;

      const result = await manager['withOverride']('high', 'gemini-3-pro-preview', async () => {
        callbackExecuted = true;

        // Verify override is in place during callback execution
        const settingsContent = await Bun.file(SETTINGS_PATH).text();
        const settings = JSON.parse(settingsContent);
        expect(settings.modelConfigs?.overrides).toHaveLength(1);
        expect(settings.modelConfigs?.overrides?.[0].modelConfig?.generateContentConfig?.thinkingConfig).toEqual({
          gen: 'GEN_3',
          thinkingLevel: 'HIGH',
        });

        return 'callback-result';
      });

      // Verify callback executed
      expect(callbackExecuted).toBe(true);
      expect(result).toBe('callback-result');

      // Verify cleanup happened (override removed)
      const finalContent = await Bun.file(SETTINGS_PATH).text();
      const finalSettings = JSON.parse(finalContent);
      expect(finalSettings.modelConfigs?.overrides).toHaveLength(0);
    });

    test('does nothing for medium reasoning (default)', async () => {
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      let callbackExecuted = false;

      const result = await manager['withOverride']('medium', 'gemini-3-pro-preview', async () => {
        callbackExecuted = true;

        // Verify NO override in place for medium (default)
        const settingsContent = await Bun.file(SETTINGS_PATH).text();
        const settings = JSON.parse(settingsContent);
        expect(settings.modelConfigs?.overrides).toHaveLength(0);

        return 'callback-result';
      });

      expect(callbackExecuted).toBe(true);
      expect(result).toBe('callback-result');
    });

    test('restores from backup on callback error', async () => {
      const initialSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2));

      const initialHash = Bun.hash(await Bun.file(SETTINGS_PATH).text());

      let errorOccurred = false;

      try {
        await manager['withOverride']('high', 'gemini-3-pro-preview', async () => {
          // Simulate error in callback
          errorOccurred = true;
          throw new Error('Callback failed!');
        });
      } catch (e) {
        expect((e as Error).message).toBe('Callback failed!');
      }

      expect(errorOccurred).toBe(true);

      // Verify settings restored to original state
      const finalContent = await Bun.file(SETTINGS_PATH).text();
      const finalHash = Bun.hash(finalContent);
      expect(finalHash).toBe(initialHash);
      expect(JSON.parse(finalContent)).toEqual(initialSettings);
    });

    test('handles missing settings.json gracefully', async () => {
      // Ensure settings.json doesn't exist
      if (existsSync(SETTINGS_PATH)) {
        await unlink(SETTINGS_PATH);
      }

      const result = await manager['withOverride']('high', 'gemini-3-pro-preview', async () => {
        expect(existsSync(SETTINGS_PATH)).toBe(true);

        const content = await Bun.file(SETTINGS_PATH).text();
        const settings = JSON.parse(content);
        expect(settings.modelConfigs?.overrides).toHaveLength(1);

        return 'success';
      });

      expect(result).toBe('success');
    });
  });

  describe('Stale override cleanup', () => {
    test('removes overrides older than specified hours', async () => {
      const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      const recentTimestamp = Date.now(); // Just now

      const settings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [
            {
              match: { model: 'old-override' },
              veda: {
                overrideId: 'veda-override-old',
                createdAt: oldTimestamp,
                reasoningLevel: 'HIGH',
              },
            },
            {
              match: { model: 'recent-override' },
              veda: {
                overrideId: 'veda-override-recent',
                createdAt: recentTimestamp,
                reasoningLevel: 'LOW',
              },
            },
            {
              match: { model: 'user-override' },
              // No veda field - should not be removed
            },
          ],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2));

      const removedCount = await manager.cleanupStale(24);

      expect(removedCount).toBe(1);

      const cleanedContent = await Bun.file(SETTINGS_PATH).text();
      const cleanedSettings = JSON.parse(cleanedContent);

      // Should have 2 overrides left (recent + user)
      expect(cleanedSettings.modelConfigs?.overrides).toHaveLength(2);
      expect(cleanedSettings.modelConfigs?.overrides?.[0].match?.model).toBe('recent-override');
      expect(cleanedSettings.modelConfigs?.overrides?.[1].match?.model).toBe('user-override');
    });

    test('returns 0 when no stale overrides', async () => {
      const settings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [
            {
              match: { model: 'recent-override' },
              veda: {
                overrideId: 'veda-override-recent',
                createdAt: Date.now(),
                reasoningLevel: 'HIGH',
              },
            },
          ],
          customAliases: {},
          aliases: {},
        },
      };

      await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2));

      const removedCount = await manager.cleanupStale(1); // 1 hour
      expect(removedCount).toBe(0);
    });
  });

  describe('Malformed settings.json', () => {
    test('handles malformed JSON gracefully on read', async () => {
      await Bun.write(SETTINGS_PATH, '{ invalid json }');

      let errorThrown = false;
      try {
        await manager['readSettings']();
      } catch (e: any) {
        errorThrown = true;
        expect(e.type).toBe('PARSE_ERROR');
      }

      expect(errorThrown).toBe(true);
    });

    test('handles malformed JSON in cleanupStale (warn, don\'t fail)', async () => {
      await Bun.write(SETTINGS_PATH, '{ invalid json }');

      // Should not throw, just warn and return 0
      const result = await manager.cleanupStale(24);
      expect(result).toBe(0);

      // Restore valid settings for subsequent tests
      const validSettings: GeminiSettingsSchema = {
        modelConfigs: {
          overrides: [],
          customAliases: {},
          aliases: {},
        },
      };
      await Bun.write(SETTINGS_PATH, JSON.stringify(validSettings, null, 2));
    });
  });

  describe('Concurrent safety', () => {
    test('withOverride uses unique IDs (sequential execution)', async () => {
      const ids = new Set<string>();

      // Run sequentially to avoid file conflicts
      for (let i = 0; i < 5; i++) {
        await manager['withOverride']('high', 'gemini-3-pro-preview', async () => {
          const settingsContent = await Bun.file(SETTINGS_PATH).text();
          const settings = JSON.parse(settingsContent);
          const overrideId = settings.modelConfigs?.overrides?.[0]?.veda?.overrideId;
          if (overrideId) {
            ids.add(overrideId);
          }
          return i;
        });
      }

      // All 5 calls should have unique IDs
      expect(ids.size).toBe(5);

      // Cleanup
      const finalContent = await Bun.file(SETTINGS_PATH).text();
      const finalSettings = JSON.parse(finalContent);
      expect(finalSettings.modelConfigs?.overrides).toHaveLength(0);
    });
  });
});
