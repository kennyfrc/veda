/**
 * Comducible judge prompt format and parser.
 * Enables swapping formats (XML, JSON, etc.) without changing runJudge.
 */

// ============================================================================
// Data Types (re-exported from judge for compatibility)
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface JudgeDecision {
  selectedIndex: number;
  confidence: number;         // 0.9 (high), 0.5 (medium), 0.3 (low)
  confidenceLevel: ConfidenceLevel;
  reasoning?: string;
}

/**
 * Note: UsageStats is defined in '../backend' and used in JudgeResult.
 * We can't directly import it here due to circular dependency,
 * so it's referenced as `any` for type compatibility in format parser context.
 */
export interface JudgeResult {
  decision: JudgeDecision;
  selected: string;
  conflicts: string[];
  usage: UsageStats;
  sessionId?: string;  // Backend's thread ID for resumability
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsd?: number;
}

// ============================================================================
// Judge Format Interface
// ============================================================================

/**
 * Judge output format: format prompt + parse response.
 */
export interface JudgeFormat {
  /**
   * Format the judge prompt for the given candidates.
   *
   * @param candidates - Array of candidate answers
   * @param indexMapping - Maps display index to original index (for shuffling)
   * @param originalTask - Optional original task context
   * @returns Formatted prompt string
   */
  format: (candidates: string[], indexMapping: number[], originalTask?: string) => string;

  /**
   * Parse the judge response to extract the decision.
   *
   * @param text - Raw judge response text
   * @param indexMapping - Maps display index to original index (for shuffling)
   * @returns Parsed decision object
   */
  parse: (text: string, indexMapping: number[]) => JudgeDecision;
}

/**
 * Confidence level text mapping to numeric values.
 */
const CONFIDENCE_SCORES: Record<string, number> = {
  'high': 0.9,
  'medium': 0.5,
  'low': 0.3,
};

/**
 * Shuffle array and return index mapping.
 * indexMapping[shuffledIdx] = originalIdx
 */
function shuffle<T>(arr: T[]): { shuffled: T[]; indexMapping: number[] } {
  const indices = arr.map((_, i) => i);
  const copy = [...indices];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return {
    shuffled: copy.map(i => arr[i]),
    indexMapping: copy,
  };
}

/**
 * Format candidates using XML tags.
 */
function formatXmlJudgePrompt(
  candidates: string[],
  indexMapping: number[],
  originalTask?: string
): string {
  // Present candidates in shuffled order
  const candidateList = indexMapping
    .map((originalIdx, displayIdx) => `## Candidate ${displayIdx + 1}\n${candidates[originalIdx]}`)
    .join('\n\n');

  const taskContext = originalTask
    ? `Original task: ${originalTask}\n\n`
    : '';

  return `${taskContext}You are a judge evaluating multiple candidate answers.

${candidateList}

---

Evaluate these candidates and select the best one based on:
1. Correctness
2. Completeness
3. Clarity

Respond with:
<best>number of the best candidate (1-${candidates.length})</best>
<confidence>high|medium|low</confidence>
<reason>brief explanation</reason>`;
}

/**
 * Parse XML-formatted judge response.
 */
function parseXmlJudgeDecision(
  text: string,
  indexMapping: number[],
  _candidateCount?: number // Unused, kept for compatibility
): JudgeDecision {
  // Parse XML format: <best>N</best>, <confidence>...</confidence>, <reason>...</reason>
  const bestMatch = text.match(/<best>\s*(\d+)\s*<\/best>/i);
  const confMatch = text.match(/<confidence>\s*(high|medium|low)\s*<\/confidence>/i);
  const reasonMatch = text.match(/<reason>([\s\S]*?)<\/reason>/i);

  const displayIdx = bestMatch ? parseInt(bestMatch[1], 10) - 1 : 0;
  const confLevel = (confMatch?.[1]?.toLowerCase() ?? 'medium') as 'high' | 'medium' | 'low';
  const reasoning = reasonMatch?.[1]?.trim();

  const confidence = CONFIDENCE_SCORES[confLevel] ?? 0.5;

  // Map display index back to original index
  const clampedDisplayIdx = Math.min(Math.max(0, displayIdx), indexMapping.length - 1);
  const originalIdx = indexMapping[clampedDisplayIdx];

  return {
    selectedIndex: originalIdx,
    confidence,
    confidenceLevel: confLevel,
    reasoning,
  };
}

/**
 * XML judge format: uses XML tags for structured output.
 */
export const XML_JUDGE_FORMAT: JudgeFormat = {
  format: formatXmlJudgePrompt,
  parse: parseXmlJudgeDecision,
};

/**
 * Create a shuffled presentation of candidates.
 * Used internally by runJudge but exposed for advanced use cases.
 */
export function shuffleCandidates<T>(candidates: T[]): { shuffled: T[]; indexMapping: number[] } {
  return shuffle(candidates);
}
