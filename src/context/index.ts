/**
 * Context management module exports.
 */

export { ContextStore, type ContextStoreOptions, type AddResult, type RemoveResult, type TokenInfo } from './store';
export { parseSlice, formatSlice, slicesOverlap, extractSlice, type FileSlice } from './slice';
export { parseSelection, serializeSelection, resolvePattern, fileExists, type SelectionEntry } from './selection';
export { readSliceText, type ReadSliceResult, type ReadSliceOptions } from './readSlice';
export { serializeFileContextBlock, serializeAllFileContextBlocks, type SerializeOptions } from './serialize';
export { countScripts, estimateTokensByScript, estimateTokensWithBuffer, DEFAULT_SAFETY_BUFFER, type ScriptCharCounts, type TokenEstimate } from './tokenEstimate';
