/**
 * Unified Judge Interface
 * 
 * Provides a single entry point for judge operations that works with
 * single-judge, multi-judge (ranking), and pairwise modes.
 */

import type { Message, UsageStats } from '../backend';
import { runJudge } from './judge';
import {
  runMultiJudge,
  type CandidateInfo,
  type ConfidenceLevel,
  CONFIDENCE_SCORES,
} from './multi-judge';
import {
  runPairwiseJudge,
  type PairResult,
} from './pairwise-judge';
import type { Reasoning, Sandbox } from './llm';

export type JudgeMode = 'single' | 'multi' | 'pairwise';

/** Rationale from a judge who ranked the winner highest */
export interface WinnerRationale {
  judgeBackend: string;
  judgeModel: string;
  reasoning: string;
  /** For pairwise mode: which pair this rationale came from */
  pairContext?: {
    pairNum: number;
    candidateA: string;
    candidateB: string;
  };
}

/** Per-judge decision (for trace/stats) */
export interface JudgeDecisionRecord {
  judgeBackend: string;
  judgeModel: string;
  /** For single-judge: selected candidate index. For multi-judge: rankings */
  selectedIndex?: number;
  rankings?: Array<{
    candidateId: string;
    rank: number;
    confidence: ConfidenceLevel;
    reasoning?: string;
  }>;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reasoning?: string;
  consensusAnalysis?: string;
  indexMapping: number[] | string[];
  seed?: string;
  sessionId?: string;
  usage: UsageStats;
}

/** Aggregation result (for multi-judge and pairwise) */
export interface AggregationRecord {
  method: 'single' | 'normalized_rank_average' | 'pairwise_copeland';
  selectedIndex: number;
  selectedCandidateId: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  winMargin: number;
  reasoning?: string;
  /** Pairwise-specific: number of pairs compared */
  pairCount?: number;
  /** Pairwise-specific: average agreement rate across pairs */
  agreementRate?: number;
}

/** Unified judge result that works for both modes */
export interface UnifiedJudgeResult {
  mode: JudgeMode;
  
  /** The selected candidate content */
  selected: string;
  /** Index in the original candidates array */
  selectedIndex: number;
  /** Candidate ID (for multi-judge) */
  selectedCandidateId?: string;
  
  /** Final confidence (0-1) */
  confidence: number;
  /** Final confidence level */
  confidenceLevel: ConfidenceLevel;
  /** Win margin over runner-up (for verification trigger) */
  winMargin: number;
  
  /** Final reasoning (from single judge or aggregation) */
  reasoning?: string;
  /** Final consensus analysis */
  consensusAnalysis?: string;
  
  /** Index mapping (display order → original order) for single-judge backward compat */
  indexMapping: number[];
  
  /** Per-judge decisions (1 for single, N for multi) */
  judges: JudgeDecisionRecord[];
  
  /** Aggregation info (present for multi-judge) */
  aggregation?: AggregationRecord;
  
  /** Combined usage across all judges */
  usage: UsageStats;
  
  /** Session ID from the "primary" judge (for resume) */
  sessionId?: string;
  
  /** True if any judge pools failed (multi-judge only) */
  hadFailures?: boolean;
  
  /** Rationales from judges who ranked the winner highest (rank=1 in their pool) */
  winnerRationales?: WinnerRationale[];
  
  /** Pairwise-specific: per-pair results */
  pairResults?: PairResult[];
  
  /** Pairwise-specific: raw votes from all judges (for stats recording) */
  pairwiseVotes?: Array<{
    pairId: string;
    judgeBackend: string;
    judgeModel: string;
    candidateA: string;
    candidateB: string;
    outcome: 'A' | 'B' | 'tie';
    confidence: 'high' | 'medium' | 'low';
  }>;
}

export interface RunUnifiedJudgeArgs {
  /** Candidates to evaluate */
  candidates: string[];
  /** Candidate metadata (required for multi-judge) */
  candidateInfos?: CandidateInfo[];
  /** Original task/prompt for context */
  originalTask: string;
  
  /** Judge mode */
  mode: JudgeMode;
  
  /** Backend for single-judge (or override list for multi-judge) */
  backend: string;
  /** Model for judge(s) - fallback if judgeModels not specified */
  model?: string;
  /** Per-backend model mapping for multi-judge */
  judgeModels?: Map<string, string>;
  /** System prompt (single-judge only) */
  systemPrompt?: string;
  
  /** Reasoning level */
  reasoning?: Reasoning;
  /** Sandbox mode */
  sandbox?: Sandbox;
  /** Working directory */
  cwd?: string;
  
  /** Message callback */
  onMessage?: (judgeBackend: string, msg: Message) => void;
}

/**
 * Run judge evaluation with unified interface.
 * 
 * Supports three modes:
 * - 'single': One judge evaluates all candidates (ranking)
 * - 'multi': Multiple judges with round-robin exclusion (ranking, legacy)
 * - 'pairwise': Multiple judges with head-to-head comparisons (recommended)
 */
export async function runUnifiedJudge(args: RunUnifiedJudgeArgs): Promise<UnifiedJudgeResult> {
  const {
    candidates,
    candidateInfos,
    originalTask,
    mode,
    backend,
    model,
    judgeModels,
    systemPrompt,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  } = args;
  
  if (candidates.length === 0) {
    throw new Error('No candidates to judge');
  }
  
  // Determine if multi-backend judging is possible
  const uniqueBackends = candidateInfos 
    ? new Set(candidateInfos.map(c => c.solverBackend)).size 
    : 1;
  
  // Route to appropriate adapter based on mode
  if (mode === 'pairwise' && candidateInfos && uniqueBackends > 1) {
    // Pairwise requires 2+ backends for cross-provider judging
    return runPairwiseJudgeAdapter({
      candidateInfos,
      originalTask,
      judgeModel: model,
      judgeModels,
      reasoning,
      sandbox,
      cwd,
      onMessage,
    });
  } else if (mode === 'multi' && uniqueBackends > 1 && candidateInfos) {
    // Legacy multi-judge (ranking-based)
    return runMultiJudgeAdapter({
      candidateInfos,
      originalTask,
      judgeModel: model,
      judgeModels,
      reasoning,
      sandbox,
      cwd,
      onMessage,
    });
  } else {
    // Single-judge fallback
    return runSingleJudgeAdapter({
      candidates,
      originalTask,
      backend,
      model,
      systemPrompt,
      reasoning,
      sandbox,
      cwd,
      onMessage: onMessage ? (msg) => onMessage(backend, msg) : undefined,
    });
  }
}

/**
 * Adapter for single-judge mode.
 */
async function runSingleJudgeAdapter(args: {
  candidates: string[];
  originalTask: string;
  backend: string;
  model?: string;
  systemPrompt?: string;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (msg: Message) => void;
}): Promise<UnifiedJudgeResult> {
  const { candidates, originalTask, backend, model, systemPrompt, reasoning, sandbox, cwd, onMessage } = args;
  
  const result = await runJudge({
    backend,
    model,
    systemPrompt: systemPrompt ?? '',
    reasoning,
    sandbox,
    cwd,
    candidates,
    originalTask,
    onMessage,
  });
  
  const decision = result.decision;
  
  // Build winner rationale for single-judge (if reasoning present)
  const winnerRationales: WinnerRationale[] = decision.reasoning
    ? [{ judgeBackend: backend, judgeModel: model ?? 'unknown', reasoning: decision.reasoning }]
    : [];
  
  return {
    mode: 'single',
    selected: result.selected,
    selectedIndex: decision.selectedIndex,
    confidence: decision.confidence,
    confidenceLevel: decision.confidenceLevel,
    winMargin: 1.0, // Single-judge doesn't have runner-up comparison
    reasoning: decision.reasoning,
    consensusAnalysis: decision.consensusAnalysis,
    indexMapping: result.indexMapping,
    judges: [{
      judgeBackend: backend,
      judgeModel: model ?? 'unknown',
      selectedIndex: decision.selectedIndex,
      confidence: decision.confidence,
      confidenceLevel: decision.confidenceLevel,
      reasoning: decision.reasoning,
      consensusAnalysis: decision.consensusAnalysis,
      indexMapping: result.indexMapping,
      sessionId: result.sessionId,
      usage: result.usage,
    }],
    usage: result.usage,
    sessionId: result.sessionId,
    winnerRationales: winnerRationales.length > 0 ? winnerRationales : undefined,
  };
}

/**
 * Adapter for multi-judge mode.
 */
async function runMultiJudgeAdapter(args: {
  candidateInfos: CandidateInfo[];
  originalTask: string;
  judgeModel?: string;
  judgeModels?: Map<string, string>;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (judgeBackend: string, msg: Message) => void;
}): Promise<UnifiedJudgeResult> {
  const { candidateInfos, originalTask, judgeModel, judgeModels, reasoning, sandbox, cwd, onMessage } = args;
  
  const result = await runMultiJudge({
    candidates: candidateInfos,
    originalTask,
    judgeModel,
    judgeModels,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });
  
  // Find the winning candidate's index in original array
  const winnerIndex = candidateInfos.findIndex(c => c.id === result.winnerCandidateId);
  const winnerContent = candidateInfos[winnerIndex]?.content ?? '';
  
  // Build per-judge decision records (include reasoning for trace)
  const judges: JudgeDecisionRecord[] = result.judgeResults.map(jr => ({
    judgeBackend: jr.judgeBackend,
    judgeModel: jr.judgeModel,
    rankings: jr.rankings.map(r => ({
      candidateId: r.candidateId,
      rank: r.rank,
      confidence: r.confidence,
      reasoning: r.reasoning,
    })),
    confidence: CONFIDENCE_SCORES[jr.rankings[0]?.confidence ?? 'medium'],
    confidenceLevel: jr.rankings[0]?.confidence ?? 'medium',
    consensusAnalysis: jr.consensusAnalysis,
    indexMapping: jr.indexMapping,
    sessionId: jr.sessionId,
    usage: jr.usage,
  }));
  
  // Extract winner rationales from judges who ranked winner as #1 in their pool
  const winnerRationales: WinnerRationale[] = [];
  for (const jr of result.judgeResults) {
    const winnerRanking = jr.rankings.find(r => r.candidateId === result.winnerCandidateId);
    // Only include if this judge gave winner rank=1 (best in their pool) and has reasoning
    if (winnerRanking && winnerRanking.rank === 1 && winnerRanking.reasoning) {
      winnerRationales.push({
        judgeBackend: jr.judgeBackend,
        judgeModel: jr.judgeModel,
        reasoning: winnerRanking.reasoning,
      });
    }
  }
  
  // Build index mapping from candidate IDs to indices (for backward compat)
  const indexMapping = result.scores.map(s => 
    candidateInfos.findIndex(c => c.id === s.candidateId)
  );
  
  // Format winner ID for display (convert solver-0 to solver-1, etc.)
  const displayWinnerId = result.winnerCandidateId.replace(
    /^solver-(\d+)/,
    (_, idx) => `solver-${parseInt(idx, 10) + 1}`
  );
  
  // Synthesize reasoning from scores
  const synthesizedReasoning = `Winner: ${displayWinnerId} (avg rank: ${result.scores[0]?.avgRank.toFixed(1)}). ` +
    `Win margin: ${result.winMargin.toFixed(3)}. ` +
    `Judged by ${result.judgeResults.length} judge(s): ${result.judgeResults.map(j => j.judgeBackend).join(', ')}.`;
  
  return {
    mode: 'multi',
    selected: winnerContent,
    selectedIndex: winnerIndex,
    selectedCandidateId: result.winnerCandidateId,
    confidence: result.confidenceScore,
    confidenceLevel: result.confidence,
    winMargin: result.winMargin,
    reasoning: synthesizedReasoning,
    indexMapping,
    judges,
    aggregation: {
      method: 'normalized_rank_average',
      selectedIndex: winnerIndex,
      selectedCandidateId: result.winnerCandidateId,
      confidence: result.confidenceScore,
      confidenceLevel: result.confidence,
      winMargin: result.winMargin,
    },
    usage: result.totalUsage,
    sessionId: result.judgeResults[0]?.sessionId,
    hadFailures: result.hadFailures,
    winnerRationales: winnerRationales.length > 0 ? winnerRationales : undefined,
  };
}

/**
 * Adapter for pairwise judge mode.
 */
async function runPairwiseJudgeAdapter(args: {
  candidateInfos: CandidateInfo[];
  originalTask: string;
  judgeModel?: string;
  judgeModels?: Map<string, string>;
  reasoning?: Reasoning;
  sandbox?: Sandbox;
  cwd?: string;
  onMessage?: (judgeBackend: string, msg: Message) => void;
}): Promise<UnifiedJudgeResult> {
  const { candidateInfos, originalTask, judgeModel, judgeModels, reasoning, sandbox, cwd, onMessage } = args;
  
  const result = await runPairwiseJudge({
    candidates: candidateInfos,
    originalTask,
    judgeModel,
    judgeModels,
    reasoning,
    sandbox,
    cwd,
    onMessage,
  });
  
  // Find the winning candidate's index in original array
  const winnerIndex = candidateInfos.findIndex(c => c.id === result.winnerCandidateId);
  const winnerContent = candidateInfos[winnerIndex]?.content ?? '';
  
  // Build per-judge decision records (with pairwise votes)
  const judges: JudgeDecisionRecord[] = result.judgeResults.map(jr => ({
    judgeBackend: jr.judgeBackend,
    judgeModel: jr.judgeModel,
    // Store pairwise votes in rankings field for compatibility
    rankings: jr.votes.map(v => ({
      candidateId: v.winner ?? 'tie',
      rank: v.choice === 'A' ? 1 : v.choice === 'B' ? 2 : 0,
      confidence: v.confidence,
      reasoning: v.reasoning,
    })),
    confidence: CONFIDENCE_SCORES[jr.votes[0]?.confidence ?? 'medium'],
    confidenceLevel: jr.votes[0]?.confidence ?? 'medium',
    indexMapping: [],
    sessionId: jr.sessionId,
    usage: jr.usage,
  }));
  
  // Extract winner rationales: reasoning from votes where this candidate won
  // Include pair context so display can show which comparison this rationale is for
  const winnerRationales: WinnerRationale[] = [];
  for (const jr of result.judgeResults) {
    for (const vote of jr.votes) {
      if (vote.winner === result.winnerCandidateId && vote.reasoning) {
        // Find the pair index and candidates for context
        const pairIdx = result.pairResults.findIndex(p => p.pairId === vote.pairId);
        const pair = result.pairResults[pairIdx];
        
        winnerRationales.push({
          judgeBackend: jr.judgeBackend,
          judgeModel: jr.judgeModel,
          reasoning: vote.reasoning,
          pairContext: pair ? {
            pairNum: pairIdx + 1,
            candidateA: pair.candidateA,
            candidateB: pair.candidateB,
          } : undefined,
        });
        break; // One rationale per judge
      }
    }
  }
  
  // Build index mapping from scores (Copeland order)
  const indexMapping = result.scores.map(s =>
    candidateInfos.findIndex(c => c.id === s.candidateId)
  );
  
  // Format winner ID for display
  const displayWinnerId = result.winnerCandidateId.replace(
    /^solver-(\d+)/,
    (_, idx) => `solver-${parseInt(idx, 10) + 1}`
  );
  
  // Synthesize reasoning
  const winnerScore = result.scores[0];
  const avgAgreement = result.pairResults.length > 0
    ? result.pairResults.reduce((sum, p) => sum + p.agreementRate, 0) / result.pairResults.length
    : 1.0;
  
  const synthesizedReasoning =
    `Winner: ${displayWinnerId} ` +
    `(Copeland: ${winnerScore.copelandScore}, wins: ${winnerScore.wins}, losses: ${winnerScore.losses}). ` +
    `Win margin: ${result.winMargin.toFixed(3)}. ` +
    `${result.pairResults.length} pairs compared by ${result.judgeResults.length} judge(s). ` +
    `Agreement rate: ${(avgAgreement * 100).toFixed(0)}%.`;
  
  return {
    mode: 'pairwise',
    selected: winnerContent,
    selectedIndex: winnerIndex,
    selectedCandidateId: result.winnerCandidateId,
    confidence: result.confidenceScore,
    confidenceLevel: result.confidence,
    winMargin: result.winMargin,
    reasoning: synthesizedReasoning,
    indexMapping,
    judges,
    aggregation: {
      method: 'pairwise_copeland',
      selectedIndex: winnerIndex,
      selectedCandidateId: result.winnerCandidateId,
      confidence: result.confidenceScore,
      confidenceLevel: result.confidence,
      winMargin: result.winMargin,
      pairCount: result.pairResults.length,
      agreementRate: avgAgreement,
    },
    pairResults: result.pairResults,
    // Flatten all votes for stats recording
    pairwiseVotes: result.judgeResults.flatMap(jr =>
      jr.votes.map(v => {
        // Find the pair to get candidateA/B
        const pair = result.pairResults.find(p => p.pairId === v.pairId);
        return {
          pairId: v.pairId,
          judgeBackend: jr.judgeBackend,
          judgeModel: jr.judgeModel,
          candidateA: pair?.candidateA ?? '',
          candidateB: pair?.candidateB ?? '',
          outcome: v.choice as 'A' | 'B' | 'tie',
          confidence: v.confidence,
        };
      })
    ),
    usage: result.totalUsage,
    sessionId: result.judgeResults[0]?.sessionId,
    hadFailures: result.hadFailures,
    winnerRationales: winnerRationales.length > 0 ? winnerRationales : undefined,
  };
}

/**
 * Check if multi-judge is possible for given candidates.
 */
export function canUseMultiJudge(candidateInfos: CandidateInfo[]): boolean {
  const uniqueBackends = new Set(candidateInfos.map(c => c.solverBackend)).size;
  return uniqueBackends > 1;
}

/**
 * Check if pairwise judge can be used.
 * Pairwise requires 2+ backends for cross-provider judging.
 * Single backend falls back to single-judge mode.
 */
export function canUsePairwiseJudge(candidateInfos: CandidateInfo[]): boolean {
  if (candidateInfos.length < 2) return false;
  const uniqueBackends = new Set(candidateInfos.map(c => c.solverBackend)).size;
  return uniqueBackends > 1;
}

/**
 * Determine effective judge mode.
 * - 'pairwise' → stays 'pairwise' if 2+ backends, else falls back to 'single'
 * - 'multi' → stays 'multi' if 2+ backends, else falls back to 'single'
 * - 'single' → stays 'single'
 */
export function getEffectiveJudgeMode(
  requestedMode: JudgeMode,
  candidateInfos: CandidateInfo[]
): JudgeMode {
  if (requestedMode === 'single') return 'single';
  if (requestedMode === 'pairwise') {
    return canUsePairwiseJudge(candidateInfos) ? 'pairwise' : 'single';
  }
  // 'multi' mode
  return canUseMultiJudge(candidateInfos) ? 'multi' : 'single';
}
