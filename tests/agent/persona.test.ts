import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadPersona,
  listPersonas,
  personaExists,
  resolveAgentConfig,
  parsePersonaMetadata,
  type PersonaMetadata,
} from '../../src/agent/persona';

// Use temp directory for tests
const TEST_BASE = join(tmpdir(), 'veda-persona-test-' + process.pid + '-' + Date.now());
const TEST_PERSONAS_DIR = join(TEST_BASE, 'personas');

describe('persona', () => {
  beforeEach(async () => {
    await mkdir(TEST_PERSONAS_DIR, { recursive: true });

    // Create test personas with frontmatter reasoning
    await mkdir(join(TEST_PERSONAS_DIR, 'navigator-plan'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'navigator-plan', 'AGENTS.md'),
      '---\nreasoning: high\ntools: read,grep,glob\n---\n# Navigator Plan\n\nYou are a planning assistant.'
    );

    await mkdir(join(TEST_PERSONAS_DIR, 'navigator-chat'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'navigator-chat', 'AGENTS.md'),
      '---\nreasoning: medium\n---\n# Navigator Chat\n\nYou are a chat assistant.'
    );

    await mkdir(join(TEST_PERSONAS_DIR, 'reviewer'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'reviewer', 'AGENTS.md'),
      '---\nreasoning: medium\ntools: none\n---\n# Reviewer\n\nYou are a code reviewer.'
    );

    await mkdir(join(TEST_PERSONAS_DIR, 'worker'));
    await writeFile(
      join(TEST_PERSONAS_DIR, 'worker', 'AGENTS.md'),
      '---\nreasoning: high\ntools: all\nsandbox: workspace-write\n---\n# Worker\n\nYou implement tasks.'
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
      expect(reviewer.defaultReasoning).toBe('medium');
      expect(plan.tools).toEqual(['read', 'grep', 'glob']);
      expect(chat.tools).toBeUndefined();
      expect(reviewer.tools).toEqual([]);
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

    test('returns embedded personas even for non-existent config directory', async () => {
      // Embedded personas are always available (batteries-included); a
      // non-existent config dir just means no user overrides on top.
      const personas = await listPersonas('/nonexistent/path');
      expect(personas.length).toBeGreaterThan(0);
      expect(personas).toContain('navigator-plan');
      expect(personas).toContain('reviewer');
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
      persona: 'navigator-chat',
    };

    test('uses defaults when no overrides', async () => {
      const config = await resolveAgentConfig(
        { backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.model).toBe('gpt-5.2');  // codex built-in default
      expect(config.reasoning).toBe('medium'); // from persona default
      expect(config.systemPrompt).toContain('chat assistant');
    });

    test('overrides model', async () => {
      const config = await resolveAgentConfig(
        { model: 'gpt-4', backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.model).toBe('gpt-4');
    });

    test('overrides reasoning', async () => {
      const config = await resolveAgentConfig(
        { reasoning: 'high', backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.reasoning).toBe('high');
    });

    test('persona reasoning takes precedence over model alias reasoning', async () => {
      const config = await resolveAgentConfig(
        { aliasReasoning: 'high', backend: 'pi', baseDir: TEST_BASE },
        defaults
      );

      expect(config.reasoning).toBe('medium');
    });

    test('explicit reasoning takes precedence over persona and alias reasoning', async () => {
      const config = await resolveAgentConfig(
        { reasoning: 'low', aliasReasoning: 'high', backend: 'pi', baseDir: TEST_BASE },
        defaults
      );

      expect(config.reasoning).toBe('low');
    });

    test('loads persona tool policy into agent config', async () => {
      const plan = await resolveAgentConfig(
        { persona: 'navigator-plan', backend: 'pi', baseDir: TEST_BASE },
        defaults
      );
      const reviewer = await resolveAgentConfig(
        { persona: 'reviewer', backend: 'pi', baseDir: TEST_BASE },
        defaults
      );

      expect(plan.tools).toEqual(['read', 'grep', 'glob']);
      expect(reviewer.tools).toEqual([]);
    });

    test('defaults to no tools when neither persona nor CLI grants them', async () => {
      // navigator-chat test persona declares no tools in frontmatter.
      const config = await resolveAgentConfig(
        { persona: 'navigator-chat', backend: 'pi', baseDir: TEST_BASE },
        defaults
      );
      expect(config.tools).toEqual([]);
      // The no-access sandbox notice must be present to match runtime capability.
      expect(config.systemPrompt).toContain('Sandbox Notice');
    });

    test('CLI --tools opt-in overrides the no-tools default', async () => {
      const config = await resolveAgentConfig(
        { persona: 'navigator-chat', tools: ['read', 'grep'], backend: 'pi', baseDir: TEST_BASE },
        defaults
      );
      expect(config.tools).toEqual(['read', 'grep']);
      // No no-tools notice when tools are granted.
      expect(config.systemPrompt).not.toContain('Sandbox Notice');
    });

    test('noTools flag forces an empty allowlist even when tools are opted in', async () => {
      const config = await resolveAgentConfig(
        { persona: 'navigator-chat', tools: ['read'], noTools: true, backend: 'pi', baseDir: TEST_BASE },
        defaults
      );
      expect(config.tools).toEqual([]);
    });

    test('overrides persona', async () => {
      const config = await resolveAgentConfig(
        { persona: 'navigator-plan', backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.systemPrompt).toContain('planning assistant');
      expect(config.reasoning).toBe('high'); // persona default
    });

    test('uses inline system prompt', async () => {
      const config = await resolveAgentConfig(
        { systemPrompt: 'Custom prompt', backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      // Tools default to none, so the no-tools sandbox notice is prepended.
      expect(config.tools).toEqual([]);
      expect(config.systemPrompt).toContain('Sandbox Notice');
      expect(config.systemPrompt).toContain('Custom prompt');
      expect(config.systemPromptPath).toBeUndefined();
    });

    test('inline system prompt passes through as-is when tools are opted in', async () => {
      const config = await resolveAgentConfig(
        { systemPrompt: 'Custom prompt', tools: ['read'], backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      expect(config.tools).toEqual(['read']);
      expect(config.systemPrompt).toBe('Custom prompt');
    });

    test('sets sandbox mode', async () => {
      const config = await resolveAgentConfig(
        { sandbox: 'full', backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.sandbox).toBe('full');
    });

    test('defaults sandbox to read-only', async () => {
      const config = await resolveAgentConfig(
        { backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      
      expect(config.sandbox).toBe('read-only');
    });

    test('uses backend-specific model default', async () => {
      const codexConfig = await resolveAgentConfig(
        { backend: 'codex', baseDir: TEST_BASE },
        defaults
      );
      const claudeConfig = await resolveAgentConfig(
        { backend: 'claude-code', baseDir: TEST_BASE },
        defaults
      );
      
      expect(codexConfig.model).toBe('gpt-5.2');
      expect(claudeConfig.model).toBe('opus');
    });

    test('uses backend-specific reasoning from config', async () => {
      const config = await resolveAgentConfig(
        { backend: 'codex', baseDir: TEST_BASE },
        defaults,
        { backendReasoning: { 'codex': 'high' } }
      );
      
      // persona reasoning takes precedence, but if no persona reasoning, backend config is used
      expect(config.reasoning).toBe('medium'); // navigator-chat has medium reasoning
    });

    test('throws when backend is not specified', async () => {
      await expect(resolveAgentConfig(
        { baseDir: TEST_BASE },
        defaults
      )).rejects.toThrow('Backend must be specified');
    });
  });
});

describe('persona metadata (additive design)', () => {
  describe('parsePersonaMetadata', () => {
    test('returns empty object for no frontmatter', () => {
      const content = '# Persona\n\nYou are a helper.';
      const metadata = parsePersonaMetadata(content);
      expect(metadata).toEqual({});
    });

    test('parses reasoning from frontmatter', () => {
      const content = `---
reasoning: high
---
# Persona

You are a helper.`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata).toEqual({ reasoning: 'high' });
    });

    test('parses a comma-separated tool allowlist', () => {
      const content = `---
reasoning: medium
tools: read, grep, glob
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata).toEqual({ reasoning: 'medium', tools: ['read', 'grep', 'glob'] });
    });

    test('parses tools none as an empty allowlist', () => {
      const content = `---
tools: none
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata).toEqual({ tools: [] });
    });

    test('parses all valid reasoning levels', () => {
      const levels: ('minimal' | 'low' | 'medium' | 'high' | 'xhigh')[] =
        ['minimal', 'low', 'medium', 'high', 'xhigh'];

      for (const level of levels) {
        const content = `---
reasoning: ${level}
---
# Persona`;
        const metadata = parsePersonaMetadata(content);
        expect(metadata.reasoning).toBe(level);
      }
    });

    test('ignores invalid reasoning level', () => {
      const content = `---
reasoning: invalid
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.reasoning).toBeUndefined();
    });

    test('ignores comments in frontmatter', () => {
      const content = `---
# This is a comment
reasoning: medium
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.reasoning).toBe('medium');
    });

    test('ignores unsupported frontmatter fields', () => {
      const content = `---
name: custom
reasoning: xhigh
version: 1.0
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata).toEqual({ reasoning: 'xhigh' });
    });

    test('handles reasoning with extra spaces', () => {
      const content = `---
reasoning:   high   
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.reasoning).toBe('high');
    });

    test('handles lowercase reasoning', () => {
      const content = `---
reasoning: LOW
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.reasoning).toBeUndefined();
    });

    test('handles quoted reasoning value', () => {
      const content = `---
reasoning: "medium"
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.reasoning).toBeUndefined(); // Quotes not supported in simple parser
    });

    test('parses tools all as the full-toolset marker', () => {
      const content = `---
tools: all
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.tools).toBe('all');
    });

    test('parses sandbox from frontmatter', () => {
      const content = `---
sandbox: workspace-write
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.sandbox).toBe('workspace-write');
    });

    test('parses sandbox case-insensitively', () => {
      const content = `---
sandbox: WORKSPACE-WRITE
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.sandbox).toBe('workspace-write');
    });

    test('ignores invalid sandbox values', () => {
      const content = `---
sandbox: every-file
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.sandbox).toBeUndefined();
    });

    test('parses sandbox read-only', () => {
      const content = `---
sandbox: read-only
---
# Persona`;
      const metadata = parsePersonaMetadata(content);
      expect(metadata.sandbox).toBe('read-only');
    });
  });

  describe('loadPersona with metadata', () => {
    beforeEach(async () => {
      // Create persona with frontmatter
      await mkdir(join(TEST_PERSONAS_DIR, 'meta-persona'), { recursive: true });
      await writeFile(
        join(TEST_PERSONAS_DIR, 'meta-persona', 'AGENTS.md'),
        `---
reasoning: xhigh
---
# Meta Persona

You are a test persona with metadata.`
      );
    });

    test('parses metadata from frontmatter', async () => {
      const persona = await loadPersona('meta-persona', TEST_BASE);
      expect(persona.metadata).toEqual({ reasoning: 'xhigh' });
      expect(persona.defaultReasoning).toBe('xhigh');
    });

    test('param metadata overrides frontmatter', async () => {
      const persona = await loadPersona('meta-persona', {
        baseDir: TEST_BASE,
        metadata: { reasoning: 'minimal' },
      });
      expect(persona.defaultReasoning).toBe('minimal'); // Param overrides frontmatter
      expect(persona.metadata).toEqual({ reasoning: 'xhigh' }); // Frontmatter still parsed
    });

    test('frontmatter takes precedence over default', async () => {
      // Create persona with frontmatter to verify it's used over default
      await mkdir(join(TEST_PERSONAS_DIR, 'override-persona'), { recursive: true });
      await writeFile(
        join(TEST_PERSONAS_DIR, 'override-persona', 'AGENTS.md'),
        `---
reasoning: low
---
# Override Persona

You use frontmatter reasoning.`
      );

      const persona = await loadPersona('override-persona', TEST_BASE);
      expect(persona.defaultReasoning).toBe('low'); // From frontmatter
    });
  });

  describe('precedence chain', () => {
    beforeEach(async () => {
      // Create persona with frontmatter
      await mkdir(join(TEST_PERSONAS_DIR, 'precedence-persona'), { recursive: true });
      await writeFile(
        join(TEST_PERSONAS_DIR, 'precedence-persona', 'AGENTS.md'),
        `---
reasoning: medium
---
# Precedence Persona

You test precedence.`
      );
    });

    test('param takes precedence over frontmatter', async () => {
      const persona = await loadPersona('precedence-persona', {
        baseDir: TEST_BASE,
        metadata: { reasoning: 'xhigh' },
      });
      expect(persona.defaultReasoning).toBe('xhigh');
    });

    test('frontmatter takes precedence over default', async () => {
      const persona = await loadPersona('precedence-persona', TEST_BASE);
      expect(persona.defaultReasoning).toBe('medium'); // From frontmatter
    });

    test('default fallback when no metadata available', async () => {
      await mkdir(join(TEST_PERSONAS_DIR, 'no-meta-persona'), { recursive: true });
      await writeFile(
        join(TEST_PERSONAS_DIR, 'no-meta-persona', 'AGENTS.md'),
        '# No Metadata\n\nYou have no metadata.'
      );

      const persona = await loadPersona('no-meta-persona', TEST_BASE);
      expect(persona.defaultReasoning).toBe('medium'); // Default fallback
    });
  });
});

describe('worker persona — write-capable defaults', () => {
  test('loadPersona(worker) yields frontmatter metadata', async () => {
    const persona = await loadPersona('worker', TEST_BASE);
    expect(persona.defaultReasoning).toBe('high');
    expect(persona.tools).toBe('all');
    expect(persona.defaultSandbox).toBe('workspace-write');
    expect(persona.metadata).toEqual({
      reasoning: 'high',
      tools: 'all',
      sandbox: 'workspace-write',
    });
  });

  test('resolveAgentConfig(worker) resolves tools to the full toolset and write sandbox', async () => {
    const config = await resolveAgentConfig(
      { persona: 'worker', backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    // undefined tools = backend's full toolset (not the no-tools default)
    expect(config.tools).toBeUndefined();
    expect(config.sandbox).toBe('workspace-write');
    // The write sandbox notice is prepended so the model sees its capability.
    expect(config.systemPrompt).toContain('workspace-write access');
    expect(config.systemPrompt).not.toContain('no access to tools');
  });

  test('--no-tools forces an empty allowlist even on the worker', async () => {
    const config = await resolveAgentConfig(
      { persona: 'worker', noTools: true, backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    expect(config.tools).toEqual([]);
    // No-access notice now matches runtime (tools disabled).
    expect(config.systemPrompt).toContain('no access to tools');
  });

  test('sandbox precedence: --sandbox flag beats persona frontmatter', async () => {
    const config = await resolveAgentConfig(
      { persona: 'worker', sandbox: 'read-only', backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    expect(config.sandbox).toBe('read-only');
  });

  test('sandbox precedence: persona frontmatter beats global defaultSandbox', async () => {
    const config = await resolveAgentConfig(
      { persona: 'worker', backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' },
      { defaultSandbox: 'full' }
    );
    expect(config.sandbox).toBe('workspace-write');
  });

  test('sandbox precedence: global defaultSandbox fills in when persona has none', async () => {
    const config = await resolveAgentConfig(
      { persona: 'navigator-chat', backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' },
      { defaultSandbox: 'workspace-write' }
    );
    expect(config.sandbox).toBe('workspace-write');
  });

  test('sandbox precedence: read-only is the bottom default', async () => {
    const config = await resolveAgentConfig(
      { persona: 'navigator-chat', backend: 'codex', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    expect(config.sandbox).toBe('read-only');
  });

  test('embedded worker persona is available without a config-dir copy', async () => {
    const persona = await loadPersona('worker', '/nonexistent/path');
    expect(persona.defaultReasoning).toBe('high');
    expect(persona.tools).toBe('all');
    expect(persona.defaultSandbox).toBe('workspace-write');
  });
});

describe('reviewer persona — code review, no tools', () => {
  test('embedded reviewer loads with reasoning medium + no tools', async () => {
    const persona = await loadPersona('reviewer', '/nonexistent/path');
    expect(persona.defaultReasoning).toBe('medium');
    expect(persona.tools).toEqual([]);
  });

  test('resolveAgentConfig(reviewer) resolves tools to empty (no-tools default)', async () => {
    const config = await resolveAgentConfig(
      { persona: 'reviewer', backend: 'pi', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    expect(config.tools).toEqual([]);
  });

  test('--no-tools forces an empty allowlist on the reviewer too', async () => {
    const config = await resolveAgentConfig(
      { persona: 'reviewer', noTools: true, backend: 'pi', baseDir: TEST_BASE },
      { persona: 'navigator-chat' }
    );
    expect(config.tools).toEqual([]);
    expect(config.systemPrompt).toContain('no access to tools');
  });

  test('reviewer prompt reports P0/P1/P2 findings and ends with review: pass / needs-fix', async () => {
    const persona = await loadPersona('reviewer', '/nonexistent/path');
    expect(persona.systemPrompt).toContain('P0');
    expect(persona.systemPrompt).toContain('P1');
    expect(persona.systemPrompt).toContain('P2');
    expect(persona.systemPrompt).toContain('review: pass');
    expect(persona.systemPrompt).toContain('review: needs-fix');
    // It reviews the diff/context — it does not run the build or drive a UI.
    expect(persona.systemPrompt).not.toContain('cdp');
    expect(persona.systemPrompt).not.toContain('verifier_report');
  });
});
