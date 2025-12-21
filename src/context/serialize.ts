import type { ReadSliceResult } from './readSlice';

export interface SerializeOptions {
  separator?: string;
  fence?: string;
}

const DEFAULT_SEPARATOR = '----------------------------------------';
const DEFAULT_FENCE = '```';

export function serializeFileContextBlock(
  result: ReadSliceResult,
  opts: SerializeOptions = {}
): string {
  const separator = opts.separator ?? DEFAULT_SEPARATOR;
  const fence = opts.fence ?? DEFAULT_FENCE;

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
 * Serialize files into a <file_context> block.
 */
export function serializeAllFileContextBlocks(
  results: ReadSliceResult[],
  opts: SerializeOptions = {}
): string {
  if (results.length === 0) return '';

  const blocks = results.map(r => serializeFileContextBlock(r, opts));
  const body = blocks.join('\n');

  return `<file_context>

${body}
</file_context>`;
}
