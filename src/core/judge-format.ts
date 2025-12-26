import type { UsageStats } from '../backend';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface JudgeDecision {
  selectedIndex: number;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reasoning?: string;
}

export interface JudgeResult {
  decision: JudgeDecision;
  selected: string;
  conflicts: string[];
  usage: UsageStats;
  sessionId?: string;
  indexMapping: number[];  // Maps display index → original index (for consistent candidate display)
}

export interface JudgeFormat {
  format: (candidates: string[], indexMapping: number[], originalTask?: string) => string;
  parse: (text: string, indexMapping: number[]) => JudgeDecision;
}

const CONFIDENCE_SCORES: Record<string, number> = {
  'high': 0.9,
  'medium': 0.5,
  'low': 0.3,
};

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

function parseXmlJudgeDecision(
  text: string,
  indexMapping: number[],
  _candidateCount?: number
): JudgeDecision {
  const bestMatch = text.match(/<best>\s*(\d+)\s*<\/best>/i);
  const confMatch = text.match(/<confidence>\s*(high|medium|low)\s*<\/confidence>/i);
  const reasonMatch = text.match(/<reason>([\s\S]*?)<\/reason>/i);

  const displayIdx = bestMatch ? parseInt(bestMatch[1], 10) - 1 : 0;
  const confLevel = (confMatch?.[1]?.toLowerCase() ?? 'medium') as 'high' | 'medium' | 'low';
  const reasoning = reasonMatch?.[1]?.trim();

  const confidence = CONFIDENCE_SCORES[confLevel] ?? 0.5;

  const clampedDisplayIdx = Math.min(Math.max(0, displayIdx), indexMapping.length - 1);
  const originalIdx = indexMapping[clampedDisplayIdx];

  return {
    selectedIndex: originalIdx,
    confidence,
    confidenceLevel: confLevel,
    reasoning,
  };
}

export const XML_JUDGE_FORMAT: JudgeFormat = {
  format: formatXmlJudgePrompt,
  parse: parseXmlJudgeDecision,
};

export function shuffleCandidates<T>(candidates: T[]): { shuffled: T[]; indexMapping: number[] } {
  return shuffle(candidates);
}
