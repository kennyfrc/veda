/**
 * Multi-Judge Round-Robin Implementation
 * 
 * Mitigates self-preference bias by ensuring each judge only evaluates
 * candidates from OTHER backends. Each candidate is ranked by N-1 judges.
 */

import type { Message } from '../backend';
import { runLlm, type Reasoning, type Sandbox } from './llm';
import { shuffleCandidates } from './judge-format';
import {
  type CandidateInfo,
  type JudgeAssignment,
  type CandidateRanking,
  type JudgePoolResult,
  type JudgePoolExecutionResult,
  type RankEntry,
  type AggregatedScore,
  type MultiJudgeResult,
  type ConfidenceLevel,
  type ConfidencePenaltyTier,
  CONFIDENCE_PENALTY,
  CONFIDENCE_SCORES,
  scoreToLevel,
} from './multi-judge-types';

export * from './multi-judge-types';

// ============================================================================
// System Prompt for Ranking
// ============================================================================

export const MULTI_JUDGE_SYSTEM_PROMPT = `<conversation_rules>
You are an expert judge evaluating multiple candidate solutions. Your task is to RANK ALL candidates from best to worst.

## Role
- Evaluate solutions objectively and fairly
- Compare candidates against each other
- Provide a complete ranking of ALL candidates

## Evaluation Criteria
1. **Correctness**: Does the solution correctly solve the problem?
2. **Completeness**: Does it handle edge cases and constraints?
3. **Clarity**: Is the solution clear and well-explained?
4. **Efficiency**: Is the approach reasonably efficient?

## Output Format
You MUST rank ALL candidates. Use this exact format:

<consensus_analysis>
Brief summary of how candidates cluster by approach.
</consensus_analysis>

<rankings>
<rank position="1" confidence="high|medium|low">
<candidate>1</candidate>
<reasoning>Why this is the best candidate.</reasoning>
</rank>
<rank position="2" confidence="high|medium|low">
<candidate>2</candidate>
<reasoning>Why this ranks second.</reasoning>
</rank>
</rankings>

IMPORTANT:
- Every candidate MUST appear exactly once in rankings
- Position 1 = best, position N = worst
- The <candidate> tag must contain ONLY the candidate number (1, 2, 3, etc.)
- Confidence reflects how certain you are of this candidate's relative position
</conversation_rules>`;

// ============================================================================
// Judge Assignment
// ============================================================================

/**
 * Build deterministic seed for shuffle.
 * Ensures reproducible shuffles across runs with same inputs.
 */
function buildShuffleSeed(promptHash: string, judgeBackend: string, candidateIds: string[]): string {
  return `${promptHash}::${judgeBackend}::${candidateIds.join(',')}`;
}

/**
 * Hash a string to a short hex string (for prompt hash).
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Assign judges using round-robin exclusion.
 * 
 * Each unique solver backend becomes a potential judge backend.
 * Each judge evaluates ALL candidates EXCEPT those from its own backend.
 * With N backends, each candidate is ranked by N-1 judges.
 */
export function buildJudgeAssignments(
  candidates: CandidateInfo[],
  promptHash: string,
  judgeBackendOverride?: string[]
): JudgeAssignment[] {
  // Extract unique solver backends (preserving order)
  const solverBackends = [...new Set(candidates.map(c => c.solverBackend))];
  
  // Determine judge backends
  const judgeBackends = judgeBackendOverride ?? solverBackends;
  
  const assignments: JudgeAssignment[] = [];
  
  for (const judgeBackend of judgeBackends) {
    // Judge evaluates all candidates EXCEPT those from its own backend
    const targetCandidates = candidates.filter(c => c.solverBackend !== judgeBackend);
    
    // Skip if no cross-provider targets
    if (targetCandidates.length === 0) continue;
    
    // Build deterministic seed for shuffle
    const candidateIds = targetCandidates.map(c => c.id);
    const seed = buildShuffleSeed(promptHash, judgeBackend, candidateIds);
    
    // Shuffle for position debiasing
    const { indexMapping } = shuffleCandidates(candidateIds, seed);
    
    // indexMapping maps displayIdx → originalIdx in candidateIds array
    // We need displayIdx → candidateId
    const shuffledCandidateIds = indexMapping.map(origIdx => candidateIds[origIdx]);
    
    assignments.push({
      judgeBackend,
      candidateIds: shuffledCandidateIds,
      indexMapping: shuffledCandidateIds,
      seed,
    });
  }
  
  return assignments;
}

/**
 * Validate that all candidates are covered by the expected number of judges.
 * 
 * For N unique solver backends, each candidate should be judged by N-1 judges.
 * Special case: 1 backend means 0 judges (no cross-provider judging possible).
 */
export function validateAssignments(
  candidates: CandidateInfo[],
  assignments: JudgeAssignment[]
): { valid: boolean; error?: string } {
  const uniqueBackends = new Set(candidates.map(c => c.solverBackend)).size;
  
  // With 1 backend, no cross-provider judging is possible → expect 0 judges
  // With N backends (N >= 2), each candidate is judged by N-1 judges
  const expectedJudgeCount = uniqueBackends <= 1 ? 0 : uniqueBackends - 1;
  
  // Count judges per candidate
  const judgeCountPerCandidate = new Map<string, number>();
  for (const candidate of candidates) {
    judgeCountPerCandidate.set(candidate.id, 0);
  }
  
  for (const assignment of assignments) {
    for (const candidateId of assignment.candidateIds) {
      const count = judgeCountPerCandidate.get(candidateId) ?? 0;
      judgeCountPerCandidate.set(candidateId, count + 1);
    }
  }
  
  for (const [candidateId, count] of judgeCountPerCandidate) {
    if (count !== expectedJudgeCount) {
      return {
        valid: false,
        error: `Candidate ${candidateId} has ${count} judges, expected ${expectedJudgeCount}`,
      };
    }
  }
  
  return { valid: true };
}

// ============================================================================
// Prompt Formatting and Parsing
// ============================================================================

/**
 * Format ranking prompt for a judge pool.
 */
export function formatRankingPrompt(
  candidates: CandidateInfo[],
  indexMapping: string[],
  originalTask?: string
): string {
  // Build candidate list in display order
  const candidateById = new Map(candidates.map(c => [c.id, c]));
  
  const candidateList = indexMapping
    .map((candidateId, displayIdx) => {
      const candidate = candidateById.get(candidateId);
      if (!candidate) return '';
      return `## Candidate ${displayIdx + 1}\n<candidate_content>\n${candidate.content}\n</candidate_content>`;
    })
    .filter(Boolean)
    .join('\n\n');
  
  const taskContext = originalTask
    ? `Original task: ${originalTask}\n\n`
    : '';
  
  const n = indexMapping.length;
  
  return `${taskContext}You are ranking ${n} candidate solutions.

${candidateList}

---

Rank ALL ${n} candidates from best (#1) to worst (#${n}).
Each candidate number (1 to ${n}) must appear exactly once.

Respond with complete rankings as specified in your instructions.`;
}

/**
 * Parse rankings from judge response.
 * Attempts repair for near-valid outputs.
 */
export function parseRankingResponse(
  text: string,
  indexMapping: string[]
): { rankings: CandidateRanking[]; consensusAnalysis?: string; repaired: boolean } {
  const consensusMatch = text.match(/<consensus_analysis>([\s\S]*?)<\/consensus_analysis>/i);
  const rankingsMatch = text.match(/<rankings>([\s\S]*?)<\/rankings>/i);
  
  const poolSize = indexMapping.length;
  const rankings: CandidateRanking[] = [];
  const seenCandidates = new Set<number>();
  const seenRanks = new Set<number>();
  let repaired = false;
  
  if (rankingsMatch) {
    // Parse individual rank entries
    const rankRegex = /<rank\s+position="(\d+)"\s+confidence="(high|medium|low)"[^>]*>\s*<candidate>\s*(\d+)\s*<\/candidate>(?:\s*<reasoning>([\s\S]*?)<\/reasoning>)?/gi;
    
    let match;
    while ((match = rankRegex.exec(rankingsMatch[1])) !== null) {
      const position = parseInt(match[1], 10);
      const confidence = match[2].toLowerCase() as ConfidenceLevel;
      const displayIdx = parseInt(match[3], 10);
      const reasoning = match[4]?.trim();
      
      // Validate display index (1-indexed in prompt)
      if (displayIdx < 1 || displayIdx > poolSize) continue;
      
      const candidateId = indexMapping[displayIdx - 1];
      if (!candidateId) continue;
      
      // Handle duplicates: first occurrence wins
      if (seenCandidates.has(displayIdx)) {
        repaired = true;
        continue;
      }
      
      // Handle duplicate ranks: skip
      if (seenRanks.has(position)) {
        repaired = true;
        continue;
      }
      
      seenCandidates.add(displayIdx);
      seenRanks.add(position);
      
      rankings.push({
        candidateId,
        rank: position,
        confidence,
        reasoning,
      });
    }
  }
  
  // Attempt repair: add missing candidates at the bottom
  if (rankings.length < poolSize) {
    repaired = true;
    let nextRank = Math.max(...seenRanks, 0) + 1;
    
    for (let displayIdx = 1; displayIdx <= poolSize; displayIdx++) {
      if (!seenCandidates.has(displayIdx)) {
        const candidateId = indexMapping[displayIdx - 1];
        if (candidateId) {
          rankings.push({
            candidateId,
            rank: nextRank++,
            confidence: 'low', // Low confidence for repaired entries
            reasoning: '(Ranking repaired: candidate was missing from judge response)',
          });
        }
      }
    }
  }
  
  // Re-normalize ranks to be 1..n if there are gaps
  rankings.sort((a, b) => a.rank - b.rank);
  rankings.forEach((r, i) => {
    if (r.rank !== i + 1) {
      r.rank = i + 1;
      repaired = true;
    }
  });
  
  return {
    rankings,
    consensusAnalysis: consensusMatch?.[1]?.trim(),
    repaired,
  };
}

// ============================================================================
// Judge Pool Execution
// ============================================================================

export interface ExecuteJudgePoolArgs {
  assignment: JudgeAssignment;
  candidates: CandidateInfo[];
  originalTask: string;
  judgeModel?: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (msg: Message) => void;
}

/**
 * Execute a single judge pool (one judge ranking its assigned candidates).
 */
export async function executeSingleJudgePool(args: ExecuteJudgePoolArgs): Promise<JudgePoolResult> {
  const { assignment, candidates, originalTask, judgeModel, reasoning, sandbox, cwd, onMessage } = args;
  
  const prompt = formatRankingPrompt(candidates, assignment.indexMapping, originalTask);
  
  const response = await runLlm({
    backend: assignment.judgeBackend,
    model: judgeModel,
    prompt,
    systemPrompt: MULTI_JUDGE_SYSTEM_PROMPT,
    reasoning: reasoning ?? 'medium',
    sandbox: sandbox ?? 'read-only',
    cwd,
    onMessage,
  });
  
  const { rankings, consensusAnalysis, repaired } = parseRankingResponse(
    response.text,
    assignment.indexMapping
  );
  
  // Validate we got a complete ranking
  if (rankings.length !== assignment.candidateIds.length) {
    throw new Error(
      `Judge ${assignment.judgeBackend} returned ${rankings.length} rankings, expected ${assignment.candidateIds.length}`
    );
  }
  
  return {
    judgeBackend: assignment.judgeBackend,
    judgeModel: judgeModel ?? 'unknown',
    rankings,
    poolSize: assignment.candidateIds.length,
    indexMapping: assignment.indexMapping,
    consensusAnalysis,
    usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
    sessionId: response.sessionId,
    repaired,
  };
}

/**
 * Execute all judge pools in parallel.
 */
export async function executeAllJudgePools(
  assignments: JudgeAssignment[],
  candidates: CandidateInfo[],
  originalTask: string,
  options: {
    judgeModel?: string;
    judgeModels?: Map<string, string>;
    reasoning?: Reasoning;
    sandbox?: Sandbox;
    cwd?: string;
    onMessage?: (judgeBackend: string, msg: Message) => void;
  }
): Promise<JudgePoolExecutionResult[]> {
  const { judgeModel, judgeModels, reasoning, sandbox, cwd, onMessage } = options;
  
  const promises = assignments.map(async (assignment): Promise<JudgePoolExecutionResult> => {
    try {
      // Use per-backend model if available, otherwise fall back to single judgeModel
      const modelForThisJudge = judgeModels?.get(assignment.judgeBackend) ?? judgeModel;
      
      const result = await executeSingleJudgePool({
        assignment,
        candidates,
        originalTask,
        judgeModel: modelForThisJudge,
        reasoning,
        sandbox,
        cwd,
        onMessage: onMessage ? (msg) => onMessage(assignment.judgeBackend, msg) : undefined,
      });
      return { success: true, value: result, judgeBackend: assignment.judgeBackend };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        judgeBackend: assignment.judgeBackend,
      };
    }
  });
  
  return Promise.all(promises);
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Normalize a rank within its pool.
 * Returns 0 for best (rank 1) and 1 for worst (rank = poolSize).
 */
function normalizeRank(rank: number, poolSize: number): number {
  if (poolSize <= 1) return 0;
  return (rank - 1) / (poolSize - 1);
}

/**
 * Calculate variance of an array of numbers.
 */
function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Aggregate confidence from multiple judge rankings.
 */
function aggregateConfidenceFromRanks(rankEntries: RankEntry[]): { level: ConfidenceLevel; score: number } {
  if (rankEntries.length === 0) {
    return { level: 'low', score: 0.3 };
  }
  
  if (rankEntries.length === 1) {
    const level = rankEntries[0].confidence;
    return { level, score: CONFIDENCE_SCORES[level] };
  }
  
  // Check for rank consistency
  const normalizedRanks = rankEntries.map(r => r.normalizedRank);
  const variance = calculateVariance(normalizedRanks);
  
  // Count confidence levels
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of rankEntries) counts[r.confidence]++;
  
  // High variance means judges disagree significantly
  if (variance > 0.2) {
    return { level: 'low', score: 0.3 };
  }
  
  // Compute weighted score
  const totalScore = rankEntries.reduce((sum, r) => sum + CONFIDENCE_SCORES[r.confidence], 0);
  const avgScore = totalScore / rankEntries.length;
  
  // Adjust for variance (slight penalty for disagreement)
  const variancePenalty = variance > 0.1 ? 0.1 : 0;
  const finalScore = Math.max(0.1, avgScore - variancePenalty);
  
  return { level: scoreToLevel(finalScore), score: finalScore };
}

/**
 * Drop failed judge pools and compute confidence penalty.
 */
export function processJudgeResults(
  results: JudgePoolExecutionResult[]
): { validResults: JudgePoolResult[]; penalty: ConfidencePenaltyTier; failureCount: number } {
  const validResults = results
    .filter((r): r is JudgePoolExecutionResult & { success: true; value: JudgePoolResult } => r.success && !!r.value)
    .map(r => r.value);
  
  const failureCount = results.length - validResults.length;
  const failureRatio = results.length > 0 ? failureCount / results.length : 0;
  
  let penalty: ConfidencePenaltyTier;
  if (failureRatio >= 0.5) {
    penalty = CONFIDENCE_PENALTY.MOST_FAILURES;
  } else if (failureCount > 0) {
    penalty = CONFIDENCE_PENALTY.SOME_FAILURES;
  } else {
    penalty = CONFIDENCE_PENALTY.NONE;
  }
  
  return { validResults, penalty, failureCount };
}

/**
 * Apply confidence penalty to a score.
 */
function applyConfidencePenalty(score: number, penalty: ConfidencePenaltyTier): number {
  switch (penalty) {
    case CONFIDENCE_PENALTY.NONE:
      return score;
    case CONFIDENCE_PENALTY.SOME_FAILURES:
      return score * 0.85;
    case CONFIDENCE_PENALTY.MOST_FAILURES:
      return score * 0.65;
    default:
      return score;
  }
}

/**
 * Aggregate results from multiple judges into final winner.
 */
export function aggregateJudgeResults(
  judgeResults: JudgePoolResult[],
  candidates: CandidateInfo[],
  penalty: ConfidencePenaltyTier
): MultiJudgeResult {
  // Build per-candidate ranking data
  const candidateRankings = new Map<string, RankEntry[]>();
  
  // Initialize all candidates
  for (const c of candidates) {
    candidateRankings.set(c.id, []);
  }
  
  // Collect rankings from each judge
  for (const jr of judgeResults) {
    for (const ranking of jr.rankings) {
      const existing = candidateRankings.get(ranking.candidateId) ?? [];
      existing.push({
        judgeBackend: jr.judgeBackend,
        rank: ranking.rank,
        poolSize: jr.poolSize,
        normalizedRank: normalizeRank(ranking.rank, jr.poolSize),
        confidence: ranking.confidence,
      });
      candidateRankings.set(ranking.candidateId, existing);
    }
  }
  
  // Compute aggregated scores
  const scores: AggregatedScore[] = [];
  
  for (const candidate of candidates) {
    const rankEntries = candidateRankings.get(candidate.id) ?? [];
    
    if (rankEntries.length === 0) {
      // Candidate not judged (shouldn't happen in valid setup)
      scores.push({
        candidateId: candidate.id,
        solverBackend: candidate.solverBackend,
        avgRank: Infinity,
        avgNormalizedRank: 1.0,
        judgeCount: 0,
        rawRankSum: Infinity,
        confidence: 'low',
        confidenceScore: 0.3,
        ranksByJudge: [],
      });
      continue;
    }
    
    // Average rank (1 = best) and normalized rank (for sorting)
    const rawRankSum = rankEntries.reduce((sum, r) => sum + r.rank, 0);
    const avgRank = rawRankSum / rankEntries.length;
    const avgNormRank = rankEntries.reduce((sum, r) => sum + r.normalizedRank, 0) / rankEntries.length;
    
    // Aggregate confidence
    const { level: confLevel, score: confScore } = aggregateConfidenceFromRanks(rankEntries);
    
    scores.push({
      candidateId: candidate.id,
      solverBackend: candidate.solverBackend,
      avgRank,
      avgNormalizedRank: avgNormRank,
      judgeCount: rankEntries.length,
      rawRankSum,
      confidence: confLevel,
      confidenceScore: confScore,
      ranksByJudge: rankEntries,
    });
  }
  
  // Sort by: avgNormalizedRank ASC, judgeCount DESC, rawRankSum ASC, confidenceScore DESC, original order
  scores.sort((a, b) => {
    // Primary: average normalized rank (lower is better)
    if (Math.abs(a.avgNormalizedRank - b.avgNormalizedRank) > 0.001) {
      return a.avgNormalizedRank - b.avgNormalizedRank;
    }
    // Tiebreaker 1: more judge coverage (higher is better)
    if (a.judgeCount !== b.judgeCount) {
      return b.judgeCount - a.judgeCount;
    }
    // Tiebreaker 2: lower raw rank sum (Borda score)
    if (a.rawRankSum !== b.rawRankSum) {
      return a.rawRankSum - b.rawRankSum;
    }
    // Tiebreaker 3: higher confidence
    if (Math.abs(a.confidenceScore - b.confidenceScore) > 0.001) {
      return b.confidenceScore - a.confidenceScore;
    }
    // Final: original order (by candidateId for determinism)
    return a.candidateId.localeCompare(b.candidateId);
  });
  
  // Winner is first after sorting
  const winner = scores[0];
  const runnerUp = scores[1];
  const winMargin = runnerUp
    ? runnerUp.avgNormalizedRank - winner.avgNormalizedRank
    : 1.0;
  
  // Apply confidence penalty
  const penalizedScore = applyConfidencePenalty(winner.confidenceScore, penalty);
  const finalConfidenceLevel = scoreToLevel(penalizedScore);
  
  // Combine usage
  const totalUsage = judgeResults.reduce(
    (acc, jr) => ({
      inputTokens: acc.inputTokens + jr.usage.inputTokens,
      outputTokens: acc.outputTokens + jr.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 }
  );
  
  return {
    winnerCandidateId: winner.candidateId,
    confidence: finalConfidenceLevel,
    confidenceScore: penalizedScore,
    winMargin,
    judgeResults,
    scores,
    totalUsage,
    hadFailures: penalty !== CONFIDENCE_PENALTY.NONE,
    failureCount: penalty === CONFIDENCE_PENALTY.MOST_FAILURES ? Math.ceil(judgeResults.length * 0.5) : 
                  penalty === CONFIDENCE_PENALTY.SOME_FAILURES ? 1 : 0,
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export interface RunMultiJudgeArgs {
  candidates: CandidateInfo[];
  originalTask: string;
  judgeBackendOverride?: string[];
  /** Model to use for all judges (fallback if judgeModels not specified) */
  judgeModel?: string;
  /** Per-backend model mapping (takes precedence over judgeModel) */
  judgeModels?: Map<string, string>;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (judgeBackend: string, msg: Message) => void;
  onPoolComplete?: (result: JudgePoolExecutionResult) => void;
}

/**
 * Run multi-judge evaluation with round-robin assignment.
 * 
 * Each judge evaluates candidates from OTHER backends only,
 * eliminating self-preference bias.
 */
export async function runMultiJudge(args: RunMultiJudgeArgs): Promise<MultiJudgeResult> {
  const {
    candidates,
    originalTask,
    judgeBackendOverride,
    judgeModel,
    judgeModels,
    reasoning,
    sandbox,
    cwd,
    onMessage,
    onPoolComplete,
  } = args;
  
  if (candidates.length === 0) {
    throw new Error('No candidates to judge');
  }
  
  // Generate prompt hash for deterministic shuffling
  const promptHash = hashString(originalTask + candidates.map(c => c.id).join(','));
  
  // Build judge assignments
  const assignments = buildJudgeAssignments(candidates, promptHash, judgeBackendOverride);
  
  if (assignments.length === 0) {
    throw new Error('No valid judge assignments (all candidates may be from the same backend with no override)');
  }
  
  // Validate coverage
  const validation = validateAssignments(candidates, assignments);
  if (!validation.valid) {
    // Log warning but proceed (may happen with overrides)
    console.error(`[multi-judge] Warning: ${validation.error}`);
  }
  
  // Execute all judge pools in parallel
  const executionResults = await executeAllJudgePools(
    assignments,
    candidates,
    originalTask,
    { judgeModel, judgeModels, reasoning, sandbox, cwd, onMessage }
  );
  
  // Notify completion for each pool
  if (onPoolComplete) {
    for (const result of executionResults) {
      onPoolComplete(result);
    }
  }
  
  // Process results (filter failures, compute penalty)
  const { validResults, penalty, failureCount } = processJudgeResults(executionResults);
  
  if (validResults.length === 0) {
    throw new Error('All judge pools failed');
  }
  
  // Aggregate and select winner
  const result = aggregateJudgeResults(validResults, candidates, penalty);
  
  // Update failure count with actual value
  return {
    ...result,
    failureCount,
  };
}
