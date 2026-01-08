/**
 * Unified Judge Interface
 * 
 * Provides a single entry point for judge operations that works with
 * both single-judge and multi-judge modes.
 */

import type { Message, UsageStats } from '../backend';
import { runJudge } from './judge';
import {
  runMultiJudge,
  type CandidateInfo,
  type ConfidenceLevel,
  CONFIDENCE_SCORES,
} from './multi-judge';
import type { Reasoning, Sandbox } from './llm';

export type JudgeMode = 'single' | 'multi';

/** Rationale from a judge who ranked the winner highest */
export interface WinnerRationale {
  judgeBackend: string;
  judgeModel: string;
  reasoning: string;
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

/** Aggregation result (for multi-judge) */
export interface AggregationRecord {
  method: 'single' | 'normalized_rank_average';
  selectedIndex: number;
  selectedCandidateId: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  winMargin: number;
  reasoning?: string;
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
 * Automatically selects single or multi-judge based on mode and candidate backends.
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
  
  // Determine if multi-judge is possible
  const uniqueBackends = candidateInfos 
    ? new Set(candidateInfos.map(c => c.solverBackend)).size 
    : 1;
  
  // Fall back to single-judge if:
  // - Mode is explicitly 'single'
  // - Only one unique backend (no cross-provider possible)
  // - No candidateInfos provided
  const useMultiJudge = mode === 'multi' && uniqueBackends > 1 && candidateInfos;
  
  if (useMultiJudge && candidateInfos) {
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
 * Check if multi-judge is possible for given candidates.
 */
export function canUseMultiJudge(candidateInfos: CandidateInfo[]): boolean {
  const uniqueBackends = new Set(candidateInfos.map(c => c.solverBackend)).size;
  return uniqueBackends > 1;
}

/**
 * Determine effective judge mode.
 * Returns 'single' if multi-judge is not possible (single backend).
 */
export function getEffectiveJudgeMode(
  requestedMode: JudgeMode,
  candidateInfos: CandidateInfo[]
): JudgeMode {
  if (requestedMode === 'single') return 'single';
  return canUseMultiJudge(candidateInfos) ? 'multi' : 'single';
}
