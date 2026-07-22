import { describe, expect, test } from 'bun:test';
import { parsePiModel, toPiThinking, toPiTools, PiBackend } from '../../src/backend/pi';

describe('parsePiModel', () => {
  test('splits pi/wafer/glm-5.1 into provider and model', () => {
    const result = parsePiModel('pi/wafer/glm-5.1');
    expect(result).toEqual({ provider: 'wafer', model: 'glm-5.1' });
  });

  test('splits pi/fireworks/accounts/fireworks/routers/kimi-k2p6 into provider and model', () => {
    const result = parsePiModel('pi/fireworks/accounts/fireworks/routers/kimi-k2p6');
    expect(result).toEqual({ provider: 'fireworks', model: 'accounts/fireworks/routers/kimi-k2p6' });
  });

  test('throws when model string does not start with pi/', () => {
    expect(() => parsePiModel('fireworks/model')).toThrow('must start with');
  });

  test('throws on empty string', () => {
    expect(() => parsePiModel('')).toThrow('must start with');
  });

  test('throws on bare pi without provider/model', () => {
    expect(() => parsePiModel('pi')).toThrow('must start with');
  });

  test('throws on legacy mu/ prefix with helpful error', () => {
    expect(() => parsePiModel('mu/wafer/GLM-5.1')).toThrow('must start with');
  });

  test('handles model with many slashes', () => {
    const result = parsePiModel('pi/provider/a/b/c/d');
    expect(result).toEqual({ provider: 'provider', model: 'a/b/c/d' });
  });
});

describe('toPiThinking', () => {
  test('maps minimal to minimal', () => {
    expect(toPiThinking('minimal')).toBe('minimal');
  });

  test('maps low to low', () => {
    expect(toPiThinking('low')).toBe('low');
  });

  test('maps medium to medium', () => {
    expect(toPiThinking('medium')).toBe('medium');
  });

  test('maps high to high', () => {
    expect(toPiThinking('high')).toBe('high');
  });

  test('maps xhigh to high', () => {
    expect(toPiThinking('xhigh')).toBe('high');
  });
});

describe('toPiTools', () => {
  test('read-only returns base toolset with bash', () => {
    const result = toPiTools('read-only');
    expect(result).toBe('read,bash,grep,glob,list_threads,read_thread,todo_write,compact');
    expect(result).toContain('bash'); // pi always has bash per user preference
    expect(result).not.toContain('exec_command'); // GPT-specific, not for pi
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for pi
  });

  test('workspace-write includes edit,write plus bash', () => {
    const result = toPiTools('workspace-write');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // pi always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for pi
    expect(result).not.toContain('exec_command'); // GPT-specific, not for pi
    // Should still include base tools
    expect(result).toContain('read');
    expect(result).toContain('grep');
  });

  test('full includes edit,write plus bash', () => {
    const result = toPiTools('full');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // pi always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for pi
    expect(result).not.toContain('exec_command'); // GPT-specific, not for pi
    // Should include base tools
    expect(result).toContain('read');
  });

  test('uses a persona tool allowlist when provided', () => {
    expect(toPiTools('read-only', ['read', 'grep', 'glob'])).toBe('read,grep,glob');
  });

  test('empty tool list returns empty string (no tools)', () => {
    expect(toPiTools('read-only', [])).toBe('');
  });

  test('persona tool policy cannot expand sandbox capabilities', () => {
    expect(toPiTools('read-only', ['read', 'edit', 'write'])).toBe('read');
  });
});

describe('PiBackend', () => {
  test('has correct name and command', () => {
    const backend = new PiBackend();
    expect(backend.name).toBe('pi');
    expect(backend.command).toBe('pi');
  });

  test('resume throws not supported', () => {
    const backend = new PiBackend();
    expect(async () => {
      for await (const _ of backend.resume({ sessionId: 'abc', config: { model: 'pi/wafer/glm-5.1', reasoning: 'medium', sandbox: 'read-only', systemPrompt: '' } })) {
        // consume
      }
    }).toThrow('Resume not supported for pi backend');
  });
});

describe('PiBackend.normalizeEvent — tool events', () => {
  const backend = new PiBackend();
  const normalize = (event: unknown) => (backend as unknown as { normalizeEvent(e: unknown): unknown }).normalizeEvent(event);

  test('tool_execution_start → tool_start with toolName and args', () => {
    const event = {
      type: 'tool_execution_start',
      toolCallId: 'call_abc',
      toolName: 'read',
      args: { path: '/tmp/foo.txt' },
    };
    const msg = normalize(event);
    expect(msg).toEqual({
      type: 'tool_start',
      toolName: 'read',
      toolInput: { path: '/tmp/foo.txt' },
      raw: event,
    });
  });

  test('tool_execution_start for bash includes command args', () => {
    const event = {
      type: 'tool_execution_start',
      toolCallId: 'call_def',
      toolName: 'bash',
      args: { command: 'rg -n "test" src/' },
    };
    const msg = normalize(event);
    expect(msg).toEqual({
      type: 'tool_start',
      toolName: 'bash',
      toolInput: { command: 'rg -n "test" src/' },
      raw: event,
    });
  });

  test('tool_execution_end → tool_result with toolName and result', () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'call_abc',
      toolName: 'read',
      result: 'file contents here',
      isError: false,
    };
    const msg = normalize(event);
    expect(msg).toEqual({
      type: 'tool_result',
      toolName: 'read',
      toolResult: 'file contents here',
      raw: event,
    });
  });

  test('tool_execution_end with error result', () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'call_err',
      toolName: 'read',
      result: 'ENOENT: no such file or directory',
      isError: true,
    };
    const msg = normalize(event);
    expect(msg).toEqual({
      type: 'tool_result',
      toolName: 'read',
      toolResult: 'ENOENT: no such file or directory',
      raw: event,
    });
  });
});
