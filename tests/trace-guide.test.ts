import { describe, test, expect } from 'bun:test';
import { formatTraceParsingGuide } from '../src/util/trace-format';

describe('formatTraceParsingGuide', () => {
  test('returns 6 lines with correct structure', () => {
    const guide = formatTraceParsingGuide('trace.yaml');
    const lines = guide.split('\n');
    
    expect(lines.length).toBe(6);
    expect(guide).toContain('trace.yaml');
    expect(guide).toContain('.final.answer');
    expect(guide).toContain('.run.was_revised');
    expect(guide).toContain('.verify.revision.revised');
    expect(guide).toContain('idx=$(yq');
    expect(guide).toContain('.solve.candidates[$idx]');
  });

  test('works with different paths', () => {
    const guide = formatTraceParsingGuide('/tmp/my-trace.yaml');
    expect(guide).toContain('/tmp/my-trace.yaml');
  });
});
