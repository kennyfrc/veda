/**
 * Save full LLM response to a YAML file in /tmp/veda/<session>/.
 *
 * Motivation: long responses get truncated in stdout. Saving to a file
 * ensures the full response is always accessible.
 */

import { stringify as yamlStringify } from 'yaml';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { c } from './colors';
import type { UsageStats } from '../backend';

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
 * Save response metadata + full text to /tmp/veda/<session>/response.yaml.
 * Returns the file path on success, undefined on failure.
 */
export async function saveResponseYaml(opts: ResponseSaveOptions): Promise<string | undefined> {
  const dir = join('/tmp', 'veda', opts.session);
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
