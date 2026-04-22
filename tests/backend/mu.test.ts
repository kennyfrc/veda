import { describe, expect, test } from 'bun:test';
import { parseMuModel, toMuThinking, toMuTools, MuBackend } from '../../src/backend/mu';

describe('parseMuModel', () => {
  test('splits mu/wafer/GLM-5.1 into provider and model', () => {
    const result = parseMuModel('mu/wafer/GLM-5.1');
    expect(result).toEqual({ provider: 'wafer', model: 'GLM-5.1' });
  });

  test('splits mu/fireworks/accounts/fireworks/routers/kimi-k2p6 into provider and model', () => {
    const result = parseMuModel('mu/fireworks/accounts/fireworks/routers/kimi-k2p6');
    expect(result).toEqual({ provider: 'fireworks', model: 'accounts/fireworks/routers/kimi-k2p6' });
  });

  test('throws when model string does not start with mu/', () => {
    expect(() => parseMuModel('fireworks/model')).toThrow('must start with');
  });

  test('throws on empty string', () => {
    expect(() => parseMuModel('')).toThrow('must start with');
  });

  test('throws on bare mu without provider/model', () => {
    expect(() => parseMuModel('mu')).toThrow('must start with');
  });

  test('handles model with many slashes', () => {
    const result = parseMuModel('mu/provider/a/b/c/d');
    expect(result).toEqual({ provider: 'provider', model: 'a/b/c/d' });
  });
});

describe('toMuThinking', () => {
  test('maps minimal to minimal', () => {
    expect(toMuThinking('minimal')).toBe('minimal');
  });

  test('maps low to low', () => {
    expect(toMuThinking('low')).toBe('low');
  });

  test('maps medium to medium', () => {
    expect(toMuThinking('medium')).toBe('medium');
  });

  test('maps high to high', () => {
    expect(toMuThinking('high')).toBe('high');
  });

  test('maps xhigh to high', () => {
    expect(toMuThinking('xhigh')).toBe('high');
  });
});

describe('toMuTools', () => {
  test('read-only returns base toolset with bash', () => {
    const result = toMuTools('read-only');
    expect(result).toBe('read,bash,grep,glob,list_threads,read_thread,read_image,todo_write,compact');
    expect(result).toContain('bash'); // mu always has bash per user preference
    expect(result).not.toContain('exec_command'); // GPT-specific, not for mu
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for mu
  });

  test('workspace-write includes edit,write plus bash', () => {
    const result = toMuTools('workspace-write');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // mu always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for mu
    expect(result).not.toContain('exec_command'); // GPT-specific, not for mu
    // Should still include base tools
    expect(result).toContain('read');
    expect(result).toContain('grep');
  });

  test('full includes edit,write plus bash', () => {
    const result = toMuTools('full');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // mu always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for mu
    expect(result).not.toContain('exec_command'); // GPT-specific, not for mu
    // Should include base tools
    expect(result).toContain('read');
  });
});

describe('MuBackend', () => {
  test('has correct name and command', () => {
    const backend = new MuBackend();
    expect(backend.name).toBe('mu');
    expect(backend.command).toBe('mu');
  });

  test('resume throws not supported', () => {
    const backend = new MuBackend();
    expect(async () => {
      for await (const _ of backend.resume({ sessionId: 'abc', config: { model: 'mu/wafer/GLM-5.1', reasoning: 'medium', sandbox: 'read-only', systemPrompt: '' } })) {
        // consume
      }
    }).toThrow('Resume not supported for mu backend');
  });
});
