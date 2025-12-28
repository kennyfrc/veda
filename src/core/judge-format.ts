import type { UsageStats } from '../backend';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface JudgeDecision {
  selectedIndex: number;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  consensusAnalysis?: string;
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

function shuffle<T>(arr: T[], seed?: string): { shuffled: T[]; indexMapping: number[] } {
  const indices = arr.map((_, i) => i);
  const copy = [...indices];

  // Simple deterministic hash for seeding
  let seedNum = 0;
  if (seed) {
    for (let i = 0; i < seed.length; i++) {
      seedNum = (seedNum << 5) - seedNum + seed.charCodeAt(i);
      seedNum |= 0;
    }
  }

  const random = () => {
    if (seed === undefined) return Math.random();
    seedNum = (seedNum + 0x9e3779b9) | 0;
    let t = Math.imul(seedNum ^ (seedNum >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
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
    .map((originalIdx, displayIdx) => `## Candidate ${displayIdx + 1}\n<candidate_content>\n${candidates[originalIdx]}\n</candidate_content>`)
    .join('\n\n');

  const taskContext = originalTask
    ? `Original task: ${originalTask}\n\n`
    : '';

  return `${taskContext}You are a judge evaluating multiple candidate answers.

${candidateList}

---

Evaluate these candidates and select the best one.

Follow these steps:
1. Identify consensus and divergence among candidates.
2. Select the most complete and correct candidate.
3. Provide reasoning that contrasts the winner with others.

Respond with:
<consensus_analysis>Summary of clusters and logic paths.</consensus_analysis>
<reason>Detailed justification contrasting the winner with runner-ups.</reason>
<best>[integer]</best>
<confidence>high|medium|low</confidence>
(Note: Replace '[integer]' with the actual candidate number from 1 to ${candidates.length})`;
}

function parseXmlJudgeDecision(
  text: string,
  indexMapping: number[],
  _candidateCount?: number
): JudgeDecision {
  const bestMatch = text.match(/<best>([\s\S]*?)<\/best>/i);
  const confMatch = text.match(/<confidence>\s*(high|medium|low)\s*<\/confidence>/i);
  const reasonMatch = text.match(/<reason>([\s\S]*?)<\/reason>/i);
  const consensusMatch = text.match(/<consensus_analysis>([\s\S]*?)<\/consensus_analysis>/i);

  // Extract numeric index from the <best> tag.
  // We look for the LAST number in the tag to avoid picking up instruction echoes like "(1-4)".
  let displayIdx = 0;
  if (bestMatch?.[1]) {
    const numbers = bestMatch[1].match(/(\d+)/g);
    if (numbers && numbers.length > 0) {
      displayIdx = parseInt(numbers[numbers.length - 1], 10) - 1;
    }
  }

  if (!Number.isFinite(displayIdx)) {
    displayIdx = 0;
  }
  const confLevel = (confMatch?.[1]?.toLowerCase() ?? 'medium') as 'high' | 'medium' | 'low';
  const reasoning = reasonMatch?.[1]?.trim();
  const consensusAnalysis = consensusMatch?.[1]?.trim();

  const confidence = CONFIDENCE_SCORES[confLevel] ?? 0.5;

  const clampedDisplayIdx = Math.min(Math.max(0, displayIdx), indexMapping.length - 1);
  const originalIdx = indexMapping[clampedDisplayIdx];

  return {
    selectedIndex: originalIdx,
    confidence,
    confidenceLevel: confLevel,
    reasoning,
    consensusAnalysis,
  };
}

export const XML_JUDGE_FORMAT: JudgeFormat = {
  format: formatXmlJudgePrompt,
  parse: parseXmlJudgeDecision,
};

export function shuffleCandidates<T>(candidates: T[], seed?: string): { shuffled: T[]; indexMapping: number[] } {
  return shuffle(candidates, seed);
}
