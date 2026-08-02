/**
 * Integration tests for the worker persona branch of handleRun:
 * header sandbox display, stdout = the <worker_report> block only,
 * report.yaml persisted, and the §7 parse-failure ladder exit codes.
 *
 * runLlm and isBackendAvailable are mocked (a mutable fixture feeds the text)
 * so no backend is invoked; the resolveAgentConfig path runs for real (the
 * worker persona is embedded in the source tree).
 */
import { describe, expect, test, afterAll, mock } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';

let fixtureText = '<canned>';
let capturedContext: string | undefined;

mock.module('../../src/core', () => ({
  runLlm: async (req: { context?: string }) => {
    capturedContext = req?.context;
    return {
      messages: [],
      text: fixtureText,
      errors: [],
      usage: { inputTokens: 1000, outputTokens: 500 },
    };
  },
  isBackendAvailable: async () => true,
}));

import { handleRun } from '../../src/commands/run';
import type { CliOptions } from '../../src/cli';

const WELL_FORMED = `<worker_report>
  <status>completed</status>
  <salient_summary>Slice implemented and green.</salient_summary>
  <what_was_implemented>src/context/slice.ts — fexport</what_was_implemented>
  <what_was_left_undone>nothing</what_was_left_undone>
  <verification>
    <command ran="bun test" exit="0">14 passed.</command>
  </verification>
  <discovered_issues>none</discovered_issues>
</worker_report>`;

const BLOCKED = `<worker_report>
  <status>blocked</status>
  <salient_summary>Blocked on precondition.</salient_summary>
  <what_was_implemented></what_was_implemented>
  <what_was_left_undone>Nothing started.</what_was_left_undone>
  <discovered_issues>none</discovered_issues>
  <needs>The error-shape contract.</needs>
</worker_report>`;

let vedaHome: string;

describe('worker run protocol', () => {
  afterAll(() => {
    if (vedaHome) rmSync(vedaHome, { recursive: true, force: true });
    rmSync(join('/tmp', 'veda', 'worker-int-test'), { recursive: true, force: true });
  });

  async function runWorker(
    text: string,
    opts: Partial<CliOptions> = {},
    seedCb?: (home: string) => void
  ): Promise<{ exit?: number; stdout: string[]; stderr: string[] }> {
    vedaHome = mkdtempSync(join(tmpdir(), 'veda-worker-int-'));
    process.env.VEDA_HOME = vedaHome;
    fixtureText = text;
    seedCb?.(vedaHome);

    const origExit = process.exit;
    const origLog = console.log;
    const origErr = console.error;
    let exit: number | undefined;
    const stdout: string[] = [];
    const stderr: string[] = [];

    (process as unknown as { exit: (c?: number) => void }).exit = ((c?: number) => { exit = c; }) as never;
    console.log = (...a: unknown[]) => { stdout.push(a.join(' ')); };
    console.error = (...a: unknown[]) => { stderr.push(a.join(' ')); };

    try {
      await handleRun('implement slice 1', {
        persona: 'worker',
        session: 'worker-int-test',
        model: 'gpt-x',
        backend: 'codex',
        notify: false,
        ...opts,
      } as CliOptions);
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exit = origExit;
    }
    return { exit, stdout, stderr };
  }

  test('well-formed block: stdout is the block only, report.yaml persisted, exit 0', async () => {
    const { exit, stdout, stderr } = await runWorker(WELL_FORMED);

    expect(exit).toBeUndefined(); // no process.exit called on the happy path

    // The <worker_report> block is the only stdout content.
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain('<worker_report>');
    expect(stdout[0]).toContain('</worker_report>');
    expect(stdout[0]).not.toContain('<canned>');

    // Header + completion show the workspace-write sandbox mode.
    expect(stderr.some(l => l.includes('workspace-write'))).toBe(true);
    expect(stderr.some(l => l.includes('[report]'))).toBe(true);

    // report.yaml persisted with Factory field names at the top level.
    const reportPath = join(vedaHome, 'sessions', 'worker-int-test', 'report.yaml');
    expect(existsSync(reportPath)).toBe(true);
    const yaml = readFileSync(reportPath, 'utf-8');
    expect(yaml).toContain('status: completed');
    expect(yaml).toContain('salientSummary:');
    expect(yaml).toContain('whatWasImplemented:');
    expect(yaml).toContain('commandsRun:');
  });

  test('worker persona auto-attaches design.json from the session dir', async () => {
    await runWorker(WELL_FORMED, {}, (home) => {
      const sessDir = join(home, 'sessions', 'worker-int-test');
      mkdirSync(sessDir, { recursive: true });
      writeFileSync(join(sessDir, 'design.json'), JSON.stringify({ name: 'cache-layer', task: 'build cache' }));
    });

    // The design must reach the worker as context (not guessed from the prompt).
    expect(capturedContext).toBeDefined();
    expect(capturedContext).toContain('<program_design');
    expect(capturedContext).toContain('"name":"cache-layer"');
    expect(capturedContext).toMatch(/contract|implement/i);
  });

  test('blocked status in a well-formed block exits 0 (truthful verdict is a successful delegation)', async () => {
    const { exit, stdout } = await runWorker(BLOCKED);

    expect(exit).toBeUndefined();
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toContain('<status>blocked</status>');

    const yaml = readFileSync(join(vedaHome, 'sessions', 'worker-int-test', 'report.yaml'), 'utf-8');
    expect(yaml).toContain('status: blocked');
    expect(yaml).toContain('needs: The error-shape contract.');
  });

  test('no block: protocol error, nothing on stdout, exit 1 (protocol failure)', async () => {
    const { exit, stdout, stderr } = await runWorker('the model just wrote freeform prose');

    expect(exit).toBe(1);
    expect(stdout).toHaveLength(0); // nothing echoed on stdout
    expect(stderr.some(l => l.includes('worker protocol error'))).toBe(true);
    expect(stderr.some(l => l.includes('no-block'))).toBe(true);

    // Raw response YAML still persisted even on protocol failure.
    expect(existsSync(join(vedaHome, 'sessions', 'worker-int-test', 'response.yaml'))).toBe(true);
  });

  test('malformed (unterminated) block: protocol error, exit 1', async () => {
    const { exit, stderr } = await runWorker('<worker_report>\n  <status>completed</status>');

    expect(exit).toBe(1);
    expect(stderr.some(l => l.includes('worker protocol error'))).toBe(true);
    expect(stderr.some(l => l.includes('malformed'))).toBe(true);
  });

  test('trailing prose after the block: protocol error, exit 1 (invariant: nothing after)', async () => {
    const { exit, stdout, stderr } = await runWorker(`${WELL_FORMED}\n\nthis trailing prose is a protocol violation`);

    expect(exit).toBe(1);
    expect(stdout).toHaveLength(0);
    expect(stderr.some(l => l.includes('nothing may follow'))).toBe(true);
  });
});
