import { describe, expect, test } from 'bun:test';
import {
  parseWorkerReport,
  extractWorkerReportBlock,
  type WorkerReport,
} from '../../src/util/report-parse';

const WELL_FORMED = `<worker_report>
  <status>completed</status>
  <salient_summary>Empty-name submit no longer reaches the server; suite green.</salient_summary>
  <what_was_implemented>src/web/SettingsForm.tsx — empty-name validation</what_was_implemented>
  <what_was_left_undone>Other forms with the same pattern were out of scope.</what_was_left_undone>
  <verification>
    <command ran="bun test tests/routes/settings.test.ts" exit="0">
      14 passed, 0 failed. New null-name case fails without the route handler.
    </command>
    <command ran="bun run check" exit="1">
      2 pre-existing type errors in src/stats — unrelated.
    </command>
    <evidence tool="cdp" surface="http://localhost:3000/settings">
      Cleared name, clicked Save: field error rendered, no POST, console clean.
      artifacts: .veda/qa/w-3f2a/settings-empty-name.png qa/note.png
    </evidence>
    <evidence tool="scratch" surface="scripts/probe-payload.sh">
      POST /api/settings with {"name":null} → 400 with documented error shape.
    </evidence>
  </verification>
  <tests>
    <added>test_settings_null_name_400, test_settings_valid_name_ok</added>
    <updated>none</updated>
  </tests>
  <discovered_issues>
    <issue severity="non_blocking">/profile form shares the null-payload pattern.</issue>
    <issue severity="blocking">Nested suggested fix test.
      <suggested_fix>Add a 400 handler there too.</suggested_fix>
    </issue>
  </discovered_issues>
</worker_report>`;

describe('extractWorkerReportBlock', () => {
  test('returns the last complete block', () => {
    const text = `intro prose\n\n${WELL_FORMED}\n\n`;
    expect(extractWorkerReportBlock(text)).toBe(WELL_FORMED);
  });

  test('returns undefined when no block present', () => {
    expect(extractWorkerReportBlock('no report here')).toBeUndefined();
  });
});

describe('parseWorkerReport — well-formed', () => {
  test('parses all fields with Factory field vocabulary', () => {
    const result = parseWorkerReport(WELL_FORMED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const r = result.report;
    expect(r.status).toBe('completed');
    expect(r.salientSummary).toContain('Empty-name submit');
    expect(r.whatWasImplemented).toContain('SettingsForm.tsx');
    expect(r.whatWasLeftUndone).toContain('Other forms');

    // Commands: ordered, exit codes parsed to numbers, observations kept.
    expect(r.verification.commandsRun).toHaveLength(2);
    expect(r.verification.commandsRun[0]).toEqual({
      ran: 'bun test tests/routes/settings.test.ts',
      exit: 0,
      observation: '14 passed, 0 failed. New null-name case fails without the route handler.',
    });
    expect(r.verification.commandsRun[1].exit).toBe(1);

    // Evidence: tool/surface/observation parsed; artifacts extracted to a list.
    expect(r.verification.evidence).toHaveLength(2);
    const cdp = r.verification.evidence[0];
    expect(cdp.tool).toBe('cdp');
    expect(cdp.surface).toBe('http://localhost:3000/settings');
    expect(cdp.observation).toContain('field error rendered');
    // artifacts line is stripped from the observation and moved to the list
    expect(cdp.observation).not.toContain('artifacts:');
    expect(cdp.artifacts).toEqual([
      '.veda/qa/w-3f2a/settings-empty-name.png',
      'qa/note.png',
    ]);
    const scratch = r.verification.evidence[1];
    expect(scratch.tool).toBe('scratch');
    expect(scratch.artifacts).toEqual([]);

    expect(r.tests?.added).toContain('test_settings_null_name_400');
    expect(r.tests?.updated).toBe('none');

    expect(r.discoveredIssues).toHaveLength(2);
    expect(r.discoveredIssues[0].severity).toBe('non_blocking');
    expect(r.discoveredIssues[1].severity).toBe('blocking');
    expect(r.discoveredIssues[1].description).toContain('Nested suggested fix');
    expect(r.discoveredIssues[1].suggestedFix).toBe('Add a 400 handler there too.');
    // nested <suggested_fix> removed from the description body
    expect(r.discoveredIssues[1].description).not.toContain('suggested_fix');

    expect(r.needs).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  test('reports a truthful blocked status with needs', () => {
    const blocked = `<worker_report>
      <status>blocked</status>
      <salient_summary>Blocked before editing.</salient_summary>
      <what_was_implemented></what_was_implemented>
      <what_was_left_undone>Nothing started.</what_was_left_undone>
      <needs>The exact error-shape contract for POST /settings.</needs>
    </worker_report>`;

    const result = parseWorkerReport(blocked);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.status).toBe('blocked');
    expect(result.report.whatWasImplemented).toBe('');
    expect(result.report.needs).toBe('The exact error-shape contract for POST /settings.');
    // empty what_was_implemented is a legal-but-warned value
    expect(result.warnings).toContain('missing <what_was_implemented>');
  });
});

describe('parseWorkerReport — ladder', () => {
  test('no block → protocol failure with tail', () => {
    const text = 'the model replied with prose only\nline2\nline3';
    const result = parseWorkerReport(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-block');
    expect(result.tail).toContain('line3');
  });

  test('unterminated tag → malformed', () => {
    const text = '<worker_report>\n  <status>completed</status>';
    const result = parseWorkerReport(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  test('missing required fields → warnings, still parses', () => {
    const partial = `<worker_report>
      <status>failed</status>
      <salient_summary>Attempted and disproved.</salient_summary>
      <what_was_left_undone>Abandoned mid-way.</what_was_left_undone>
    </worker_report>`;
    const result = parseWorkerReport(partial);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('missing <what_was_implemented>');
    expect(result.report.status).toBe('failed');
  });

  test('invalid status value → warning + fallback', () => {
    const bad = WELL_FORMED.replace('<status>completed</status>', '<status>banana</status>');
    const result = parseWorkerReport(bad);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some(w => w.includes('banana'))).toBe(true);
    expect(result.report.status).toBe('failed');
  });

  test('prose after the block is a protocol failure (invariant: nothing after)', () => {
    const text = `${WELL_FORMED}\n\nthis trailing prose violates the protocol`;
    const result = parseWorkerReport(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
    expect(result.detail).toContain('nothing may follow');
  });

  test('multiple blocks are a protocol failure (invariant: exactly one)', () => {
    const text = `<worker_report><status>completed</status></worker_report>\n${WELL_FORMED}`;
    const result = parseWorkerReport(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
    expect(result.detail).toContain('exactly one');
  });

  test('nested/stray opening tag is a protocol failure', () => {
    // The lenient regex would swallow this as one block — the tag-count
    // invariant must catch it (2 openers, 1 closer).
    const nested = '<worker_report>draft <worker_report><status>completed</status></worker_report>';
    const result = parseWorkerReport(nested);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
    expect(result.detail).toContain('2 opening and 1 closing');
  });

  test('trailing whitespace after the block is tolerated', () => {
    const result = parseWorkerReport(`${WELL_FORMED}\n\n  \n`);
    expect(result.ok).toBe(true);
  });

  test('evidence missing attributes → warnings, entries still parsed', () => {
    const noAttrs = WELL_FORMED.replace(
      '<evidence tool="cdp" surface="http://localhost:3000/settings">',
      '<evidence>'
    );
    const result = parseWorkerReport(noAttrs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some(w => w.includes('tool attribute'))).toBe(true);
    expect(result.warnings.some(w => w.includes('surface attribute'))).toBe(true);
  });

  test('blocked without needs → warning', () => {
    const blockedNoNeeds = `<worker_report>
      <status>blocked</status>
      <salient_summary>Blocked.</salient_summary>
      <what_was_implemented></what_was_implemented>
      <what_was_left_undone>Nothing.</what_was_left_undone>
    </worker_report>`;
    const result = parseWorkerReport(blockedNoNeeds);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.status).toBe('blocked');
    expect(result.warnings.some(w => w.includes('needs'))).toBe(true);
  });

  test('missing verification block → warning', () => {
    const noVerification = `<worker_report>
      <status>completed</status>
      <salient_summary>Done.</salient_summary>
      <what_was_implemented>src/x.ts</what_was_implemented>
      <what_was_left_undone>nothing</what_was_left_undone>
    </worker_report>`;
    const result = parseWorkerReport(noVerification);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('missing <verification>');
    expect(result.report.verification.commandsRun).toEqual([]);
    expect(result.report.verification.evidence).toEqual([]);
  });

  test('missing discovered_issues block → warning', () => {
    const noIssues = `<worker_report>
      <status>completed</status>
      <salient_summary>Done.</salient_summary>
      <what_was_implemented>src/x.ts</what_was_implemented>
      <what_was_left_undone>nothing</what_was_left_undone>
      <verification>
        <command ran="bun test" exit="0">14 passed.</command>
      </verification>
    </worker_report>`;
    const result = parseWorkerReport(noIssues);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('missing <discovered_issues>');
    expect(result.report.discoveredIssues).toEqual([]);
  });

  test('invalid command exit value → warning, exit dropped', () => {
    const badExit = WELL_FORMED.replace('exit="0"', 'exit="abc"');
    const result = parseWorkerReport(badExit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some(w => w.includes('invalid exit'))).toBe(true);
    expect(result.report.verification.commandsRun[0].exit).toBeUndefined();
  });

  test('unknown evidence tool → warning, value preserved', () => {
    const badTool = WELL_FORMED.replace(
      '<evidence tool="cdp"',
      '<evidence tool="browser-driven"'
    );
    const result = parseWorkerReport(badTool);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some(w => w.includes('not a known probe surface'))).toBe(true);
    expect(result.report.verification.evidence[0].tool).toBe('browser-driven');
  });

  test('partially numeric exit values are rejected, not coerced', () => {
    for (const bad of ['1oops', '1.5', 'abc']) {
      const variant = WELL_FORMED.replace('exit="0"', `exit="${bad}"`);
      const result = parseWorkerReport(variant);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings.some(w => w.includes('invalid exit'))).toBe(true);
      expect(result.report.verification.commandsRun[0].exit).toBeUndefined();
    }
    // Valid negative exit codes still parse.
    const neg = WELL_FORMED.replace('exit="0"', 'exit="-1"');
    const result = parseWorkerReport(neg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.verification.commandsRun[0].exit).toBe(-1);
  });

  test('invalid or missing issue severity → warning, value preserved honestly', () => {
    const invalid = WELL_FORMED.replace('severity="non_blocking"', 'severity="critical"');
    const r1 = parseWorkerReport(invalid);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.warnings.some(w => w.includes('invalid severity'))).toBe(true);
    expect(r1.report.discoveredIssues[0].severity).toBe('critical');

    const missing = WELL_FORMED.replace('<issue severity="non_blocking">', '<issue>');
    const r2 = parseWorkerReport(missing);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.warnings.some(w => w.includes('missing severity'))).toBe(true);
    expect(r2.report.discoveredIssues[0].severity).toBe('');
  });
});

describe('parseWorkerReport — type sanity', () => {
  test('parser output conforms to WorkerReport shape', () => {
    const result = parseWorkerReport(WELL_FORMED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r: WorkerReport = result.report;
    expect(typeof r.salientSummary).toBe('string');
    expect(Array.isArray(r.verification.commandsRun)).toBe(true);
    expect(Array.isArray(r.verification.evidence)).toBe(true);
    expect(Array.isArray(r.discoveredIssues)).toBe(true);
  });
});
