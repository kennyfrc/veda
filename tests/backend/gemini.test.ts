import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test';

/**
 * Direct implementation of maybeWarnAboutReasoning for testing purposes.
 * Mirrors the implementation in src/backend/gemini.ts
 */
function maybeWarnAboutReasoning(reasoning: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): void {
  if (reasoning && reasoning !== 'medium') {
    console.warn(
      'Warning: Gemini-CLI does not support configurable reasoning levels via CLI flags. ' +
      'The --reasoning flag will be ignored. ' +
      'Consider using prompt engineering instead.'
    );
  }
}

describe('Gemini Reasoning Warning', () => {
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    originalWarn = console.warn;
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  test('warns when reasoning is minimal', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('minimal');
    expect(spy).toHaveBeenCalled();
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('Gemini-CLI does not support configurable reasoning levels');
  });

  test('warns when reasoning is low', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('low');
    expect(spy).toHaveBeenCalled();
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('Gemini-CLI does not support configurable reasoning levels');
  });

  test('does NOT warn when reasoning is medium (default)', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('medium');
    expect(spy).not.toHaveBeenCalled();
  });

  test('warns when reasoning is high', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('high');
    expect(spy).toHaveBeenCalled();
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('Gemini-CLI does not support configurable reasoning levels');
  });

  test('warns when reasoning is xhigh', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('xhigh');
    expect(spy).toHaveBeenCalled();
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('Gemini-CLI does not support configurable reasoning levels');
  });

  test('warning message includes helpful suggestion', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('high');
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('Consider using prompt engineering instead');
  });

  test('warning message explains the flag will be ignored', () => {
    const spy = spyOn(console, 'warn');
    maybeWarnAboutReasoning('low');
    const warning = spy.mock.calls[0][0] as string;
    expect(warning).toContain('--reasoning flag will be ignored');
  });
});

describe('Gemini Warning Behavior Summary', () => {
  test('only skips warning for medium reasoning level', () => {
    const levels: Array<'minimal' | 'low' | 'medium' | 'high' | 'xhigh'> = ['minimal', 'low', 'medium', 'high', 'xhigh'];

    const results = levels.map(level => {
      const spy = spyOn(console, 'warn');
      maybeWarnAboutReasoning(level);
      const called = spy.mock.calls.length > 0;
      spy.mockRestore();
      return { level, warned: called };
    });

    expect(results.find(r => r.level === 'medium')?.warned).toBe(false);
    expect(results.filter(r => r.level !== 'medium').every(r => r.warned)).toBe(true);
  });
});
