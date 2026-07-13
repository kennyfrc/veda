import { describe, expect, test } from 'bun:test';
import { parseJdcModel, toJdcThinking, toJdcTools, JdcBackend } from '../../src/backend/jdc';

describe('parseJdcModel', () => {
  test('splits jdc/wafer/glm-5.1 into provider and model', () => {
    const result = parseJdcModel('jdc/wafer/glm-5.1');
    expect(result).toEqual({ provider: 'wafer', model: 'glm-5.1' });
  });

  test('splits jdc/fireworks/accounts/fireworks/routers/kimi-k2p6 into provider and model', () => {
    const result = parseJdcModel('jdc/fireworks/accounts/fireworks/routers/kimi-k2p6');
    expect(result).toEqual({ provider: 'fireworks', model: 'accounts/fireworks/routers/kimi-k2p6' });
  });

  test('throws when model string does not start with jdc/', () => {
    expect(() => parseJdcModel('fireworks/model')).toThrow('must start with');
  });

  test('throws on empty string', () => {
    expect(() => parseJdcModel('')).toThrow('must start with');
  });

  test('throws on bare jdc without provider/model', () => {
    expect(() => parseJdcModel('jdc')).toThrow('must start with');
  });

  test('throws on legacy mu/ prefix with helpful error', () => {
    expect(() => parseJdcModel('mu/wafer/GLM-5.1')).toThrow('must start with');
  });

  test('handles model with many slashes', () => {
    const result = parseJdcModel('jdc/provider/a/b/c/d');
    expect(result).toEqual({ provider: 'provider', model: 'a/b/c/d' });
  });
});

describe('toJdcThinking', () => {
  test('maps minimal to minimal', () => {
    expect(toJdcThinking('minimal')).toBe('minimal');
  });

  test('maps low to low', () => {
    expect(toJdcThinking('low')).toBe('low');
  });

  test('maps medium to medium', () => {
    expect(toJdcThinking('medium')).toBe('medium');
  });

  test('maps high to high', () => {
    expect(toJdcThinking('high')).toBe('high');
  });

  test('maps xhigh to high', () => {
    expect(toJdcThinking('xhigh')).toBe('high');
  });
});

describe('toJdcTools', () => {
  test('read-only returns base toolset with bash', () => {
    const result = toJdcTools('read-only');
    expect(result).toBe('read,bash,grep,glob,list_threads,read_thread,read_image,todo_write,compact');
    expect(result).toContain('bash'); // jdc always has bash per user preference
    expect(result).not.toContain('exec_command'); // GPT-specific, not for jdc
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for jdc
  });

  test('workspace-write includes edit,write plus bash', () => {
    const result = toJdcTools('workspace-write');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // jdc always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for jdc
    expect(result).not.toContain('exec_command'); // GPT-specific, not for jdc
    // Should still include base tools
    expect(result).toContain('read');
    expect(result).toContain('grep');
  });

  test('full includes edit,write plus bash', () => {
    const result = toJdcTools('full');
    expect(result).toContain('edit');
    expect(result).toContain('write');
    expect(result).toContain('bash'); // jdc always has bash per user preference
    expect(result).not.toContain('apply_patch'); // GPT-specific, not for jdc
    expect(result).not.toContain('exec_command'); // GPT-specific, not for jdc
    // Should include base tools
    expect(result).toContain('read');
  });
});

describe('JdcBackend', () => {
  test('has correct name and command', () => {
    const backend = new JdcBackend();
    expect(backend.name).toBe('jdc');
    expect(backend.command).toBe('jdc');
  });

  test('resume throws not supported', () => {
    const backend = new JdcBackend();
    expect(async () => {
      for await (const _ of backend.resume({ sessionId: 'abc', config: { model: 'jdc/wafer/glm-5.1', reasoning: 'medium', sandbox: 'read-only', systemPrompt: '' } })) {
        // consume
      }
    }).toThrow('Resume not supported for jdc backend');
  });
});

describe('JdcBackend.normalizeEvent — tool events', () => {
  const backend = new JdcBackend();
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
