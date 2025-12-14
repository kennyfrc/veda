/**
 * Serialize file contents to LLM context format.
 */

import type { ReadSliceResult } from './readSlice';

export interface SerializeOptions {
  /** Separator between file blocks (default: "----------------------------------------") */
  separator?: string;
  /** Code fence marker (default: "```") */
  fence?: string;
}

const DEFAULT_SEPARATOR = '----------------------------------------';
const DEFAULT_FENCE = '```';

/**
 * Format a single file as a context block.
 */
export function serializeFileContextBlock(
  result: ReadSliceResult,
  opts: SerializeOptions = {}
): string {
  const separator = opts.separator ?? DEFAULT_SEPARATOR;
  const fence = opts.fence ?? DEFAULT_FENCE;

  // Build line info suffix
  const lineInfo = result.hasSlice
    ? ` (lines ${result.startLine}-${result.endLine})`
    : '';

  return `File: ${result.displayPath}${lineInfo}
${fence}
${result.content}
${fence}
${separator}`;
}

/**
 * Serialize multiple files into a complete file_context block.
 * Returns empty string if no results provided.
 */
export function serializeAllFileContextBlocks(
  results: ReadSliceResult[],
  opts: SerializeOptions = {}
): string {
  if (results.length === 0) {
    return '';
  }

  const blocks = results.map(r => serializeFileContextBlock(r, opts));
  const body = blocks.join('\n');

  return `<file_context>

${body}
</file_context>`;
}
