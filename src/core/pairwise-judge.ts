/**
 * Pairwise Judge Implementation
 * 
 * Replaces ranking-based multi-judge with head-to-head comparisons.
 * 
 * Key design decisions:
 * - Policy B (single-side conflict allowed): A judge can vote on a pair unless
 *   it produced BOTH candidates. This ensures coverage with 2 backends.
 * - Copeland scoring: wins - losses, with deterministic tiebreakers.
 * - Batched prompting: One LLM call per judge with all their eligible pairs.
 */

import type { Message } from '../backend';
import { runLlm, type Reasoning, type Sandbox } from './llm';
import { shuffleCandidates } from './judge-format';
import {
  type CandidateInfo,
  type ConfidenceLevel,
  scoreToLevel,
} from './multi-judge-types';
import type {
  CandidatePair,
  PairwiseVote,
  PairResult,
  PairwiseScore,
  PairwiseJudgeAssignment,
  PairwiseJudgeResult,
  PairwiseJudgeExecutionResult,
  PairwiseJudgeAggregateResult,
  VoteChoice,
  PairVerdict,
} from './pairwise-judge-types';

export * from './pairwise-judge-types';

// ============================================================================
// System Prompt
// ============================================================================

export const PAIRWISE_JUDGE_SYSTEM_PROMPT = `<conversation_rules>
You are an expert judge comparing pairs of candidate solutions. For each pair, determine which candidate is better or if they are equivalent.

## Role
- Compare candidates objectively and fairly
- Focus on correctness, completeness, and clarity
- Make clear decisions with confidence assessments

## Evaluation Criteria
1. **Correctness**: Does it correctly solve the problem?
2. **Completeness**: Does it handle edge cases?
3. **Clarity**: Is the solution clear and well-reasoned?
4. **Efficiency**: Is the approach reasonably efficient?

## Output Format
For EACH pair, provide your comparison:

<comparison pair="1">
<winner>A|B|tie</winner>
<confidence>high|medium|low</confidence>
<reasoning>Brief explanation of why this candidate wins (or why it's a tie).</reasoning>
</comparison>

IMPORTANT:
- You MUST evaluate ALL pairs listed below
- "A" means the first candidate wins, "B" means the second wins
- Use "tie" only when candidates are genuinely equivalent in quality
- Confidence reflects how certain you are of this comparison
</conversation_rules>`;

// ============================================================================
// Pair Generation
// ============================================================================

/**
 * Generate all candidate pairs with eligibility info.
 * 
 * For k candidates: C(k,2) = k*(k-1)/2 pairs.
 * 
 * Eligibility Policy B: A judge is eligible unless it produced BOTH candidates.
 * - Same-backend pair (A1, A2 both from claude): Only non-claude judges eligible
 * - Cross-backend pair (A from claude, B from codex): Both judges eligible
 */
export function generatePairs(
  candidates: CandidateInfo[],
  judgeBackends: string[]
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      
      // Ensure consistent ordering (lexical by ID)
      const [candA, candB] = a.id < b.id ? [a, b] : [b, a];
      
      const isSameBackend = candA.solverBackend === candB.solverBackend;
      
      // Policy B: eligible unless produced BOTH candidates
      // Same-backend: exclude that backend
      // Cross-backend: all judges eligible
      const eligibleJudges = isSameBackend
        ? judgeBackends.filter(jb => jb !== candA.solverBackend)
        : judgeBackends;
      
      pairs.push({
        id: `${candA.id}:${candB.id}`,
        candidateA: candA.id,
        candidateB: candB.id,
        backendA: candA.solverBackend,
        backendB: candB.solverBackend,
        isSameBackend,
        eligibleJudges,
      });
    }
  }
  
  return pairs;
}

/**
 * Validate that every pair has at least one eligible judge.
 */
export function validatePairCoverage(
  pairs: CandidatePair[]
): { valid: boolean; uncoveredPairs: string[] } {
  const uncovered = pairs.filter(p => p.eligibleJudges.length === 0);
  return {
    valid: uncovered.length === 0,
    uncoveredPairs: uncovered.map(p => p.id),
  };
}

// ============================================================================
// Judge Assignment
// ============================================================================

/**
 * Hash string to short hex (for deterministic seeding).
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Build judge assignments: each judge gets their eligible pairs.
 */
export function buildPairwiseAssignments(
  pairs: CandidatePair[],
  judgeBackends: string[],
  promptHash: string
): PairwiseJudgeAssignment[] {
  return judgeBackends.map(judgeBackend => {
    // Filter to pairs this judge can evaluate
    const eligiblePairs = pairs.filter(p => p.eligibleJudges.includes(judgeBackend));
    
    if (eligiblePairs.length === 0) {
      return { judgeBackend, pairs: [], seed: '' };
    }
    
    // Deterministic shuffle for position debiasing
    const seed = `${promptHash}::${judgeBackend}::pairwise`;
    const pairIds = eligiblePairs.map(p => p.id);
    const { indexMapping } = shuffleCandidates(pairIds, seed);
    const shuffledPairs = indexMapping.map(idx => eligiblePairs[idx]);
    
    return {
      judgeBackend,
      pairs: shuffledPairs,
      seed,
    };
  }).filter(a => a.pairs.length > 0);
}

// ============================================================================
// Prompt Formatting & Parsing
// ============================================================================

/**
 * Format pairwise comparison prompt for a judge.
 */
export function formatPairwisePrompt(
  candidates: CandidateInfo[],
  pairs: CandidatePair[],
  originalTask?: string
): string {
  const candidateById = new Map(candidates.map(c => [c.id, c]));
  
  const pairSections = pairs.map((pair, displayIdx) => {
    const candA = candidateById.get(pair.candidateA);
    const candB = candidateById.get(pair.candidateB);
    
    return `## Pair ${displayIdx + 1}

<candidate_a>
${candA?.content ?? '[Content unavailable]'}
</candidate_a>

<candidate_b>
${candB?.content ?? '[Content unavailable]'}
</candidate_b>`;
  }).join('\n\n');
  
  const taskContext = originalTask
    ? `Original task: ${originalTask}\n\n`
    : '';
  
  return `${taskContext}Compare the following ${pairs.length} pair${pairs.length !== 1 ? 's' : ''} of candidate solutions.

${pairSections}

---

Evaluate ${pairs.length === 1 ? 'this pair' : `ALL ${pairs.length} pairs`}. For each pair, determine the winner (A or B) or declare a tie.

Respond with your comparisons as specified in your instructions.`;
}

/**
 * Parse pairwise comparison response.
 */
export function parsePairwiseResponse(
  text: string,
  pairs: CandidatePair[],
  judgeBackend: string,
  judgeModel: string
): { votes: PairwiseVote[]; repaired: boolean } {
  const votes: PairwiseVote[] = [];
  const seenPairs = new Set<number>();
  let repaired = false;
  
  // Match: <comparison pair="N">...<winner>...</winner>...<confidence>...</confidence>...</comparison>
  const comparisonRegex = /<comparison\s+pair="(\d+)"[^>]*>([\s\S]*?)<\/comparison>/gi;
  const winnerRegex = /<winner>\s*(A|B|tie)\s*<\/winner>/i;
  const confidenceRegex = /<confidence>\s*(high|medium|low)\s*<\/confidence>/i;
  const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/i;
  
  let match;
  while ((match = comparisonRegex.exec(text)) !== null) {
    const pairNum = parseInt(match[1], 10);
    const content = match[2];
    
    // Validate pair number (1-indexed)
    if (pairNum < 1 || pairNum > pairs.length) continue;
    if (seenPairs.has(pairNum)) {
      repaired = true;
      continue;
    }
    seenPairs.add(pairNum);
    
    const pair = pairs[pairNum - 1];
    const winnerMatch = content.match(winnerRegex);
    const confMatch = content.match(confidenceRegex);
    const reasonMatch = content.match(reasoningRegex);
    
    const rawChoice = winnerMatch?.[1]?.toUpperCase() ?? 'TIE';
    const choice: VoteChoice = rawChoice === 'A' ? 'A' : rawChoice === 'B' ? 'B' : 'tie';
    const confidence = (confMatch?.[1]?.toLowerCase() ?? 'medium') as ConfidenceLevel;
    const reasoning = reasonMatch?.[1]?.trim();
    
    // Map choice to winner ID
    let winner: string | null = null;
    if (choice === 'A') winner = pair.candidateA;
    else if (choice === 'B') winner = pair.candidateB;
    
    votes.push({
      pairId: pair.id,
      judgeBackend,
      judgeModel,
      winner,
      choice,
      confidence,
      reasoning,
    });
  }
  
  // Repair: add missing pairs as ties with low confidence
  if (votes.length < pairs.length) {
    repaired = true;
    for (let i = 0; i < pairs.length; i++) {
      if (!seenPairs.has(i + 1)) {
        votes.push({
          pairId: pairs[i].id,
          judgeBackend,
          judgeModel,
          winner: null,
          choice: 'tie',
          confidence: 'low',
          reasoning: '(Comparison missing from judge response)',
        });
      }
    }
  }
  
  return { votes, repaired };
}

// ============================================================================
// Aggregation
// ============================================================================

/**
 * Aggregate votes into pair results using majority vote.
 */
export function aggregatePairVotes(
  pairs: CandidatePair[],
  allVotes: PairwiseVote[]
): PairResult[] {
  // Group votes by pair ID
  const votesByPair = new Map<string, PairwiseVote[]>();
  for (const vote of allVotes) {
    const existing = votesByPair.get(vote.pairId) ?? [];
    existing.push(vote);
    votesByPair.set(vote.pairId, existing);
  }
  
  return pairs.map(pair => {
    const votes = votesByPair.get(pair.id) ?? [];
    
    // Count votes for each outcome
    let votesForA = 0;
    let votesForB = 0;
    let votesForTie = 0;
    
    for (const vote of votes) {
      if (vote.winner === pair.candidateA) votesForA++;
      else if (vote.winner === pair.candidateB) votesForB++;
      else votesForTie++;
    }
    
    // Determine consensus
    let consensusWinner: string | null = null;
    let verdict: PairVerdict;
    let agreementRate = 1.0;
    
    if (votes.length === 0) {
      verdict = 'tie';
    } else if (votesForA > votesForB && votesForA > votesForTie) {
      consensusWinner = pair.candidateA;
      verdict = 'A';
      agreementRate = votesForA / votes.length;
    } else if (votesForB > votesForA && votesForB > votesForTie) {
      consensusWinner = pair.candidateB;
      verdict = 'B';
      agreementRate = votesForB / votes.length;
    } else if (votesForTie > votesForA && votesForTie > votesForB) {
      verdict = 'tie';
      agreementRate = votesForTie / votes.length;
    } else {
      // Split: no clear majority
      verdict = 'split';
      agreementRate = Math.max(votesForA, votesForB, votesForTie) / votes.length;
    }
    
    return {
      pairId: pair.id,
      candidateA: pair.candidateA,
      candidateB: pair.candidateB,
      votes,
      consensusWinner,
      verdict,
      agreementRate,
    };
  });
}

/**
 * Compute Copeland scores from pair results.
 */
export function computeCopelandScores(
  candidates: CandidateInfo[],
  pairResults: PairResult[]
): PairwiseScore[] {
  // Initialize scores
  const scoreMap = new Map<string, PairwiseScore>();
  for (const c of candidates) {
    scoreMap.set(c.id, {
      candidateId: c.id,
      solverBackend: c.solverBackend,
      wins: 0,
      losses: 0,
      ties: 0,
      copelandScore: 0,
      totalPairs: 0,
      headToHead: new Map(),
    });
  }
  
  // Tally wins/losses from pair results
  for (const pr of pairResults) {
    const scoreA = scoreMap.get(pr.candidateA);
    const scoreB = scoreMap.get(pr.candidateB);
    if (!scoreA || !scoreB) continue;
    
    scoreA.totalPairs++;
    scoreB.totalPairs++;
    
    if (pr.consensusWinner === pr.candidateA) {
      scoreA.wins++;
      scoreB.losses++;
      scoreA.headToHead.set(pr.candidateB, 'win');
      scoreB.headToHead.set(pr.candidateA, 'loss');
    } else if (pr.consensusWinner === pr.candidateB) {
      scoreB.wins++;
      scoreA.losses++;
      scoreA.headToHead.set(pr.candidateB, 'loss');
      scoreB.headToHead.set(pr.candidateA, 'win');
    } else {
      // Tie or split
      scoreA.ties++;
      scoreB.ties++;
      scoreA.headToHead.set(pr.candidateB, 'tie');
      scoreB.headToHead.set(pr.candidateA, 'tie');
    }
  }
  
  // Compute Copeland scores
  for (const score of scoreMap.values()) {
    score.copelandScore = score.wins - score.losses;
  }
  
  // Sort by: Copeland DESC, wins DESC, losses ASC, ID ASC
  const scores = [...scoreMap.values()].sort((a, b) => {
    if (a.copelandScore !== b.copelandScore) return b.copelandScore - a.copelandScore;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return a.candidateId.localeCompare(b.candidateId);
  });
  
  return scores;
}

/**
 * Compute confidence from agreement rates and win margin.
 */
export function computePairwiseConfidence(
  scores: PairwiseScore[],
  pairResults: PairResult[]
): { level: ConfidenceLevel; score: number; winMargin: number } {
  if (scores.length === 0) {
    return { level: 'low', score: 0.3, winMargin: 0 };
  }
  
  if (scores.length === 1) {
    return { level: 'high', score: 0.9, winMargin: 1.0 };
  }
  
  const winner = scores[0];
  const runnerUp = scores[1];
  
  // Win margin: normalized Copeland difference
  const maxPossibleScore = scores.length - 1; // Max wins possible
  const copelandDiff = winner.copelandScore - runnerUp.copelandScore;
  const winMargin = maxPossibleScore > 0 ? copelandDiff / (2 * maxPossibleScore) : 0;
  
  // Average agreement rate across all pairs
  const avgAgreement = pairResults.length > 0
    ? pairResults.reduce((sum, pr) => sum + pr.agreementRate, 0) / pairResults.length
    : 0.5;
  
  // Count split decisions (indicates disagreement)
  const splitCount = pairResults.filter(pr => pr.verdict === 'split').length;
  const splitRatio = pairResults.length > 0 ? splitCount / pairResults.length : 0;
  
  // Confidence formula:
  // - High agreement + large margin = high confidence
  // - Many splits or close race = low confidence
  let confScore = 0.5 + (winMargin * 0.3) + (avgAgreement * 0.2) - (splitRatio * 0.2);
  confScore = Math.max(0.1, Math.min(0.95, confScore));
  
  return {
    level: scoreToLevel(confScore),
    score: confScore,
    winMargin,
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export interface RunPairwiseJudgeArgs {
  candidates: CandidateInfo[];
  originalTask: string;
  /** Override judge backends (default: derive from solver backends) */
  judgeBackendOverride?: string[];
  /** Model to use for all judges (fallback) */
  judgeModel?: string;
  /** Per-backend model mapping */
  judgeModels?: Map<string, string>;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (judgeBackend: string, msg: Message) => void;
}

/**
 * Run pairwise judge evaluation.
 */
export async function runPairwiseJudge(
  args: RunPairwiseJudgeArgs
): Promise<PairwiseJudgeAggregateResult> {
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
  } = args;
  
  if (candidates.length === 0) {
    throw new Error('No candidates to judge');
  }
  
  // Single candidate: trivial winner
  if (candidates.length === 1) {
    return {
      winnerCandidateId: candidates[0].id,
      winnerSolverBackend: candidates[0].solverBackend,
      confidence: 'high',
      confidenceScore: 1.0,
      winMargin: 1.0,
      pairResults: [],
      scores: [{
        candidateId: candidates[0].id,
        solverBackend: candidates[0].solverBackend,
        wins: 0,
        losses: 0,
        ties: 0,
        copelandScore: 0,
        totalPairs: 0,
        headToHead: new Map(),
      }],
      judgeResults: [],
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      hadFailures: false,
      failureCount: 0,
    };
  }
  
  // Determine judge backends
  const solverBackends = [...new Set(candidates.map(c => c.solverBackend))];
  const judgeBackends = judgeBackendOverride ?? solverBackends;
  
  // Generate pairs
  const pairs = generatePairs(candidates, judgeBackends);
  
  // Validate coverage
  const coverage = validatePairCoverage(pairs);
  if (!coverage.valid) {
    throw new Error(
      `Pairwise coverage failed: pairs [${coverage.uncoveredPairs.join(', ')}] have no eligible judges. ` +
      `Provide additional judge backends via override.`
    );
  }
  
  // Build assignments
  const promptHash = hashString(originalTask + candidates.map(c => c.id).join(','));
  const assignments = buildPairwiseAssignments(pairs, judgeBackends, promptHash);
  
  if (assignments.length === 0) {
    throw new Error('No valid judge assignments');
  }
  
  // Execute all judges in parallel
  const executionResults = await Promise.all(
    assignments.map(async (assignment): Promise<PairwiseJudgeExecutionResult> => {
      try {
        const modelForJudge = judgeModels?.get(assignment.judgeBackend) ?? judgeModel;
        
        const prompt = formatPairwisePrompt(candidates, assignment.pairs, originalTask);
        
        const response = await runLlm({
          backend: assignment.judgeBackend,
          model: modelForJudge,
          prompt,
          systemPrompt: PAIRWISE_JUDGE_SYSTEM_PROMPT,
          reasoning: reasoning ?? 'medium',
          sandbox: sandbox ?? 'read-only',
          tools: [],
          cwd,
          onMessage: onMessage ? (msg) => onMessage(assignment.judgeBackend, msg) : undefined,
        });
        
        const { votes, repaired } = parsePairwiseResponse(
          response.text,
          assignment.pairs,
          assignment.judgeBackend,
          modelForJudge ?? 'unknown'
        );
        
        return {
          success: true,
          value: {
            judgeBackend: assignment.judgeBackend,
            judgeModel: modelForJudge ?? 'unknown',
            votes,
            usage: response.usage ?? { inputTokens: 0, outputTokens: 0 },
            sessionId: response.sessionId,
            repaired,
          },
          judgeBackend: assignment.judgeBackend,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          judgeBackend: assignment.judgeBackend,
        };
      }
    })
  );
  
  // Filter successful results
  const validResults = executionResults
    .filter((r): r is PairwiseJudgeExecutionResult & { success: true; value: PairwiseJudgeResult } =>
      r.success && !!r.value
    )
    .map(r => r.value);
  
  const failureCount = executionResults.length - validResults.length;
  
  if (validResults.length === 0) {
    throw new Error('All judges failed');
  }
  
  // Collect all votes
  const allVotes = validResults.flatMap(r => r.votes);
  
  // Aggregate into pair results
  const pairResults = aggregatePairVotes(pairs, allVotes);
  
  // Compute Copeland scores
  const scores = computeCopelandScores(candidates, pairResults);
  
  // Compute confidence
  const { score: confScore, winMargin } = computePairwiseConfidence(scores, pairResults);
  
  // Apply failure penalty
  const failureRatio = executionResults.length > 0 ? failureCount / executionResults.length : 0;
  let penalizedScore = confScore;
  if (failureRatio >= 0.5) penalizedScore *= 0.65;
  else if (failureCount > 0) penalizedScore *= 0.85;
  
  // Combine usage
  const totalUsage = validResults.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 }
  );
  
  const winner = scores[0];
  
  return {
    winnerCandidateId: winner.candidateId,
    winnerSolverBackend: winner.solverBackend,
    confidence: scoreToLevel(penalizedScore),
    confidenceScore: penalizedScore,
    winMargin,
    pairResults,
    scores,
    judgeResults: validResults,
    totalUsage,
    hadFailures: failureCount > 0,
    failureCount,
  };
}
