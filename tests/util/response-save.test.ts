import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { saveResponseYaml } from '../../src/util/response-save';
import { exists, rm } from 'fs/promises';
import { join } from 'path';
import { readFileSync } from 'fs';
import { getSessionDir } from '../../src/util/paths';

const TEST_SESSION = 'test-save-response';
// Session dir resolves to the project `.veda` when no VEDA_HOME override is set.
const TEST_DIR = getSessionDir(TEST_SESSION);

describe('saveResponseYaml', () => {
  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('saves response to the session dir response.yaml', async () => {
    const path = await saveResponseYaml({
      session: TEST_SESSION,
      persona: 'navigator-plan',
      backend: 'claude-code',
      model: 'claude-fable-5',
      prompt: 'Design a caching layer',
      response: 'Here is the full response.\nMultiple lines.\nDone.',
      usage: {
        inputTokens: 1234,
        outputTokens: 567,
        cachedTokens: 100,
        costUsd: 0.05,
      },
    });

    expect(path).toBeDefined();
    expect(path).toBe(join(TEST_DIR, 'response.yaml'));
    expect(await exists(path!)).toBe(true);
  });

  test('YAML contains all metadata fields', async () => {
    const path = await saveResponseYaml({
      session: TEST_SESSION,
      persona: 'navigator-chat',
      backend: 'codex',
      model: 'gpt-5.2',
      prompt: 'What is X?',
      response: 'X is a thing.',
      usage: {
        inputTokens: 100,
        outputTokens: 50,
      },
    });

    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('session: test-save-response');
    expect(content).toContain('persona: navigator-chat');
    expect(content).toContain('backend: codex');
    expect(content).toContain('model: gpt-5.2');
    expect(content).toContain('prompt:');
    expect(content).toContain('X is a thing.');
    expect(content).toContain('input_tokens: 100');
    expect(content).toContain('output_tokens: 50');
  });

  test('works without optional fields', async () => {
    const path = await saveResponseYaml({
      session: TEST_SESSION,
      backend: 'codex',
      response: 'Minimal response.',
    });

    expect(path).toBeDefined();
    const content = readFileSync(path!, 'utf-8');
    expect(content).toContain('session: test-save-response');
    expect(content).toContain('backend: codex');
    expect(content).toContain('Minimal response.');
    // Should not have persona/model/prompt/usage fields
    expect(content).not.toContain('persona:');
    expect(content).not.toContain('model:');
    expect(content).not.toContain('prompt:');
    expect(content).not.toContain('usage:');
  });

  test('overwrites previous response on same session', async () => {
    await saveResponseYaml({
      session: TEST_SESSION,
      backend: 'codex',
      response: 'First response.',
    });

    const path2 = await saveResponseYaml({
      session: TEST_SESSION,
      backend: 'codex',
      response: 'Second response.',
    });

    const content = readFileSync(path2!, 'utf-8');
    expect(content).toContain('Second response.');
    expect(content).not.toContain('First response.');
  });
});
