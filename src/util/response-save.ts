/**
 * Save full LLM response to a YAML file in the session dir: <home>/<session>/response.yaml
 * (project `.veda/sessions/<session>` when run inside a git repo, else
 * `~/.config/veda/sessions/<session>`).
 *
 * Motivation: long responses get truncated in stdout. Saving to a file
 * ensures the full response is always accessible.
 */

import { stringify as yamlStringify } from 'yaml';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { c } from './colors';
import type { UsageStats } from '../backend';
import type { WorkerReport } from './report-parse';
import { getSessionDir } from './paths';

export interface ResponseSaveOptions {
  session: string;
  persona?: string;
  backend: string;
  model?: string;
  prompt?: string;
  response: string;
  usage?: UsageStats | null;
}

/**
 * Save response metadata + full text to the session dir's response.yaml.
 * Returns the file path on success, undefined on failure.
 */
export async function saveResponseYaml(opts: ResponseSaveOptions): Promise<string | undefined> {
  const dir = getSessionDir(opts.session);
  const filePath = join(dir, 'response.yaml');

  const doc: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    session: opts.session,
    backend: opts.backend,
  };
  if (opts.persona) doc.persona = opts.persona;
  if (opts.model) doc.model = opts.model;
  if (opts.prompt) doc.prompt = opts.prompt;
  doc.response = opts.response;
  if (opts.usage) {
    const usage: Record<string, unknown> = {
      input_tokens: opts.usage.inputTokens,
      output_tokens: opts.usage.outputTokens,
    };
    if (opts.usage.cachedTokens !== undefined) usage.cached_tokens = opts.usage.cachedTokens;
    if (opts.usage.costUsd !== undefined) usage.cost_usd = opts.usage.costUsd;
    doc.usage = usage;
  }

  try {
    await mkdir(dir, { recursive: true });
    const yaml = yamlStringify(doc, {
      lineWidth: 120,
      defaultKeyType: 'PLAIN',
      blockQuote: 'literal',
    });
    await Bun.write(filePath, yaml);
    return filePath;
  } catch (error) {
    console.error(
      c.yellow(`[response] Warning: failed to save: ${error instanceof Error ? error.message : error}`)
    );
    return undefined;
  }
}

export interface WorkerReportSaveOptions {
  session: string;
  model?: string;
  usage?: UsageStats | null;
  /** The parsed worker report (Factory field vocabulary), at top level. */
  report: WorkerReport;
  /** The raw extracted <worker_report> block (lossless trace). */
  block?: string;
}

/**
 * Save a parsed worker report to the session dir: <session>/report.yaml
 * (the same session dir that holds design.json, selection/, response.yaml,
 * thread.json — where the Driver's next step reads it). The report fields
 * sit at the top level so the Driver can branch on them directly: `yq '.status' report.yaml`.
 */
export async function saveWorkerReport(opts: WorkerReportSaveOptions): Promise<string | undefined> {
  const dir = getSessionDir(opts.session);
  const filePath = join(dir, 'report.yaml');

  const usage: Record<string, unknown> | undefined = opts.usage
    ? (() => {
        const u: Record<string, unknown> = {
          input_tokens: opts.usage?.inputTokens ?? 0,
          output_tokens: opts.usage?.outputTokens ?? 0,
        };
        if (opts.usage?.cachedTokens !== undefined) u.cached_tokens = opts.usage.cachedTokens;
        if (opts.usage?.costUsd !== undefined) u.cost_usd = opts.usage.costUsd;
        return u;
      })()
    : undefined;

  const doc: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    persona: 'worker',
    sessionId: opts.session,
  };
  if (opts.model) doc.model = opts.model;
  if (usage) doc.usage = usage;

  // Worker report fields at the top level (Driver branches on .status/.needs).
  doc.status = opts.report.status;
  doc.salientSummary = opts.report.salientSummary;
  doc.whatWasImplemented = opts.report.whatWasImplemented;
  doc.whatWasLeftUndone = opts.report.whatWasLeftUndone;
  doc.verification = opts.report.verification;
  if (opts.report.tests) doc.tests = opts.report.tests;
  if (opts.report.discoveredIssues.length > 0) doc.discoveredIssues = opts.report.discoveredIssues;
  if (opts.report.needs) doc.needs = opts.report.needs;
  if (opts.block) doc['raw_block'] = opts.block;

  try {
    await mkdir(dir, { recursive: true });
    const yaml = yamlStringify(doc, {
      lineWidth: 120,
      defaultKeyType: 'PLAIN',
      blockQuote: 'literal',
    });
    await Bun.write(filePath, yaml);
    return filePath;
  } catch (error) {
    console.error(
      c.yellow(`[report] Warning: failed to save: ${error instanceof Error ? error.message : error}`)
    );
    return undefined;
  }
}
