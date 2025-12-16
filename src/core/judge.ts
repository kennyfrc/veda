/**
 * Judge primitive: select best candidate from multiple outputs.
 * Plain data types + functions, no hidden state.
 */

import type { UsageStats } from '../backend';
import { runLlm, type Reasoning, type Sandbox } from './llm';

// ============================================================================
// Data Types
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface JudgeDecision {
  selectedIndex: number;
  confidence: number;         // 0.9 (high), 0.5 (medium), 0.3 (low)
  confidenceLevel: ConfidenceLevel;
  reasoning?: string;
}

export interface JudgeResult {
  decision: JudgeDecision;
  selected: string;
  conflicts: string[];
  usage: UsageStats;
}

// ============================================================================
// Functions
// ============================================================================

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
 * Format the judge prompt with shuffled candidates.
 */
export function formatJudgePrompt(
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
 * Parse judge response to extract decision.
 */
export function parseJudgeDecision(
  text: string,
  indexMapping: number[],
  _candidateCount: number
): JudgeDecision {
  // Parse XML format: <best>N</best>, <confidence>...</confidence>, <reason>...</reason>
  const bestMatch = text.match(/<best>\s*(\d+)\s*<\/best>/i);
  const confMatch = text.match(/<confidence>\s*(high|medium|low)\s*<\/confidence>/i);
  const reasonMatch = text.match(/<reason>([\s\S]*?)<\/reason>/i);

  const displayIdx = bestMatch ? parseInt(bestMatch[1], 10) - 1 : 0;
  const confLevel = (confMatch?.[1]?.toLowerCase() ?? 'medium') as ConfidenceLevel;
  const reasoning = reasonMatch?.[1]?.trim();

  const confidence = confLevel === 'high' ? 0.9 : confLevel === 'medium' ? 0.5 : 0.3;

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
 * Run the judge to select the best candidate.
 */
export async function runJudge(args: {
  backend: string;
  systemPrompt: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  candidates: string[];
  originalTask?: string;
}): Promise<JudgeResult> {
  const { backend, systemPrompt, reasoning, sandbox, cwd, candidates, originalTask } = args;

  // Handle edge cases
  if (candidates.length === 0) {
    return {
      decision: { selectedIndex: 0, confidence: 0, confidenceLevel: 'low' },
      selected: '',
      conflicts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (candidates.length === 1) {
    return {
      decision: { selectedIndex: 0, confidence: 1, confidenceLevel: 'high' },
      selected: candidates[0],
      conflicts: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // Shuffle to reduce position bias
  const { indexMapping } = shuffle(candidates);

  const prompt = formatJudgePrompt(candidates, indexMapping, originalTask);
  
  const response = await runLlm({
    backend,
    prompt,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
  });

  const decision = parseJudgeDecision(response.text, indexMapping, candidates.length);
  const selected = candidates[decision.selectedIndex];
  const conflicts = candidates.filter((_, i) => i !== decision.selectedIndex);

  return {
    decision,
    selected,
    conflicts,
    usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}
