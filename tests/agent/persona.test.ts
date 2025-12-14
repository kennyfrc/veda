import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPersona, listPersonas, personaExists, resolveAgentConfig } from '../../src/agent/persona';

// Use temp directory for tests
const TEST_BASE = join(tmpdir(), 'veda-persona-test-' + process.pid + '-' + Date.now());
const TEST_PERSONAS_DIR = join(TEST_BASE, 'personas');

describe('persona', () => {
  beforeEach(async () => {
    await mkdir(TEST_PERSONAS_DIR, { recursive: true });
    
    // Create test personas
    await mkdir(join(TEST_PERSONAS_DIR, 'navigator-plan'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'navigator-plan', 'AGENTS.md'),
      '# Navigator Plan\n\nYou are a planning assistant.'
    );
    
    await mkdir(join(TEST_PERSONAS_DIR, 'navigator-chat'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'navigator-chat', 'AGENTS.md'),
      '# Navigator Chat\n\nYou are a chat assistant.'
    );
    
    await mkdir(join(TEST_PERSONAS_DIR, 'reviewer'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'reviewer', 'AGENTS.md'),
      '# Reviewer\n\nYou are a code reviewer.'
    );
    
    // Create empty directory (should not be listed)
    await mkdir(join(TEST_PERSONAS_DIR, 'empty-dir'));
  });

  afterEach(async () => {
    try {
      await rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadPersona', () => {
    test('loads persona by name', async () => {
      const persona = await loadPersona('navigator-plan', TEST_BASE);
      
      expect(persona.name).toBe('navigator-plan');
      expect(persona.systemPrompt).toContain('Navigator Plan');
      expect(persona.systemPrompt).toContain('planning assistant');
      expect(persona.path).toContain('AGENTS.md');
    });

    test('throws for non-existent persona', async () => {
      await expect(loadPersona('nonexistent', TEST_BASE)).rejects.toThrow('Persona not found');
    });

    test('uses correct default reasoning per persona', async () => {
      const plan = await loadPersona('navigator-plan', TEST_BASE);
      const chat = await loadPersona('navigator-chat', TEST_BASE);
      const reviewer = await loadPersona('reviewer', TEST_BASE);
      
      expect(plan.defaultReasoning).toBe('high');
      expect(chat.defaultReasoning).toBe('medium');
      expect(reviewer.defaultReasoning).toBe('high');
    });
  });

  describe('listPersonas', () => {
    test('lists all personas with AGENTS.md', async () => {
      const personas = await listPersonas(TEST_BASE);
      
      expect(personas).toContain('navigator-plan');
      expect(personas).toContain('navigator-chat');
      expect(personas).toContain('reviewer');
      expect(personas).not.toContain('empty-dir');
    });

    test('returns sorted list', async () => {
      const personas = await listPersonas(TEST_BASE);
      
      expect(personas).toEqual([...personas].sort());
    });

    test('returns empty array for non-existent directory', async () => {
      const personas = await listPersonas('/nonexistent/path');
      
      expect(personas).toEqual([]);
    });
  });

  describe('personaExists', () => {
    test('returns true for existing persona', async () => {
      expect(await personaExists('navigator-plan', TEST_BASE)).toBe(true);
    });

    test('returns false for non-existent persona', async () => {
      expect(await personaExists('nonexistent', TEST_BASE)).toBe(false);
    });

    test('returns false for directory without AGENTS.md', async () => {
      expect(await personaExists('empty-dir', TEST_BASE)).toBe(false);
    });
  });

  describe('resolveAgentConfig', () => {
    const defaults = {
      model: 'gpt-5.2',
      reasoning: 'medium' as const,
      persona: 'navigator-chat',
    };

    test('uses defaults when no overrides', async () => {
      const config = await resolveAgentConfig({ baseDir: TEST_BASE }, defaults);
      
      expect(config.model).toBe('gpt-5.2');
      expect(config.reasoning).toBe('medium'); // from persona default
      expect(config.systemPrompt).toContain('chat assistant');
    });

    test('overrides model', async () => {
      const config = await resolveAgentConfig(
        { model: 'gpt-4', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.model).toBe('gpt-4');
    });

    test('overrides reasoning', async () => {
      const config = await resolveAgentConfig(
        { reasoning: 'high', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.reasoning).toBe('high');
    });

    test('overrides persona', async () => {
      const config = await resolveAgentConfig(
        { persona: 'navigator-plan', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.systemPrompt).toContain('planning assistant');
      expect(config.reasoning).toBe('high'); // persona default
    });

    test('uses inline system prompt', async () => {
      const config = await resolveAgentConfig(
        { systemPrompt: 'Custom prompt', baseDir: TEST_BASE },
        defaults
      );
      
      // System prompt is wrapped with sandbox notice
      expect(config.systemPrompt).toContain('Custom prompt');
      expect(config.systemPrompt).toContain('Sandbox Notice');
      expect(config.systemPromptPath).toBeUndefined();
    });

    test('sets sandbox mode', async () => {
      const config = await resolveAgentConfig(
        { sandbox: 'full', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.sandbox).toBe('full');
    });

    test('defaults sandbox to read-only', async () => {
      const config = await resolveAgentConfig({ baseDir: TEST_BASE }, defaults);
      
      expect(config.sandbox).toBe('read-only');
    });
  });
});
