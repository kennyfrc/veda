import { describe, expect, test } from 'bun:test';
import { DroidBackend, createDroidBackend, toDroidReasoning, toDroidAutoArgs } from '../../src/backend/droid';

describe('toDroidReasoning', () => {
  test('maps minimal to off', () => {
    expect(toDroidReasoning('minimal')).toBe('off');
  });

  test('maps low to low', () => {
    expect(toDroidReasoning('low')).toBe('low');
  });

  test('maps medium to medium', () => {
    expect(toDroidReasoning('medium')).toBe('medium');
  });

  test('maps high to high', () => {
    expect(toDroidReasoning('high')).toBe('high');
  });

  test('maps xhigh to high (droid max-safe)', () => {
    expect(toDroidReasoning('xhigh')).toBe('high');
  });
});

describe('toDroidAutoArgs', () => {
  test('read-only produces no --auto flag', () => {
    expect(toDroidAutoArgs('read-only')).toEqual([]);
  });

  test('workspace-write produces --auto low', () => {
    expect(toDroidAutoArgs('workspace-write')).toEqual(['--auto', 'low']);
  });

  test('full produces --auto high', () => {
    expect(toDroidAutoArgs('full')).toEqual(['--auto', 'high']);
  });
});

describe('DroidBackend', () => {
  test('has correct name and command', () => {
    const backend = new DroidBackend();
    expect(backend.name).toBe('droid');
    expect(backend.command).toBe('droid');
  });

  test('createDroidBackend returns instance', () => {
    const backend = createDroidBackend();
    expect(backend).toBeInstanceOf(DroidBackend);
    expect(backend.name).toBe('droid');
  });

  test('normalizeEvent maps system/init to init message', () => {
    const backend = new DroidBackend();
    // Access private method via any cast for unit testing
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'system',
      subtype: 'init',
      cwd: '/path',
      session_id: 'abc-123',
      tools: ['Read', 'Execute'],
      model: 'glm-5.2',
      reasoning_effort: 'high',
    });
    expect(result).toEqual({
      type: 'init',
      sessionId: 'abc-123',
      raw: expect.objectContaining({ session_id: 'abc-123' }),
    });
  });

  test('normalizeEvent maps assistant message to text', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'message',
      role: 'assistant',
      id: 'msg-1',
      text: 'Hello there.',
      timestamp: 123,
      session_id: 'abc',
    });
    expect(result).toEqual({
      type: 'text',
      content: 'Hello there.',
      raw: expect.objectContaining({ text: 'Hello there.' }),
    });
  });

  test('normalizeEvent skips user message (echo of input)', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'message',
      role: 'user',
      id: 'msg-0',
      text: 'say hello',
      timestamp: 123,
      session_id: 'abc',
    });
    expect(result).toBeNull();
  });

  test('normalizeEvent maps reasoning event to reasoning message', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'reasoning',
      id: 'reasoning-1',
      text: 'Let me think about this.',
      timestamp: 123,
      session_id: 'abc',
    });
    expect(result).toEqual({
      type: 'reasoning',
      content: 'Let me think about this.',
      raw: expect.objectContaining({ text: 'Let me think about this.' }),
    });
  });

  test('normalizeEvent maps tool_call to tool_start', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'tool_call',
      id: 'call-1',
      messageId: 'msg-1',
      toolId: 'Read',
      toolName: 'Read',
      parameters: { file_path: '/tmp/test.txt' },
      timestamp: 123,
      session_id: 'abc',
    });
    expect(result).toEqual({
      type: 'tool_start',
      toolName: 'Read',
      toolInput: { file_path: '/tmp/test.txt' },
      raw: expect.objectContaining({ toolName: 'Read' }),
    });
  });

  test('normalizeEvent maps tool_result', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'tool_result',
      id: 'call-1',
      messageId: 'msg-2',
      toolId: 'Read',
      isError: false,
      value: 'file contents here',
      timestamp: 123,
      session_id: 'abc',
    });
    expect(result).toEqual({
      type: 'tool_result',
      toolName: 'Read',
      toolResult: 'file contents here',
      raw: expect.objectContaining({ value: 'file contents here' }),
    });
  });

  test('normalizeEvent maps completion to done with snake_case usage mapping', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'completion',
      finalText: 'Hello to you.',
      numTurns: 1,
      durationMs: 3781,
      session_id: 'abc-123',
      timestamp: 1782997754020,
      usage: {
        input_tokens: 14562,
        output_tokens: 6,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 0,
      },
    }) as { type: string; usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number } };
    expect(result.type).toBe('done');
    expect(result.usage).toEqual({
      inputTokens: 14562,
      outputTokens: 6,
      cachedTokens: 8,
    });
  });

  test('normalizeEvent maps error event', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    const result = normalize({
      type: 'error',
      message: 'something went wrong',
    }) as { type: string; content?: string };
    expect(result.type).toBe('error');
    expect(result.content).toBe('something went wrong');
  });

  test('normalizeEvent returns null for unknown event types', () => {
    const backend = new DroidBackend();
    const normalize = (backend as unknown as { normalizeEvent: (e: unknown) => unknown }).normalizeEvent.bind(backend);
    expect(normalize({ type: 'unknown_event' })).toBeNull();
    expect(normalize(null)).toBeNull();
    expect(normalize('not an object')).toBeNull();
  });
});
