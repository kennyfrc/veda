/**
 * Checkpoint types for deep mode resumability.
 * 
 * A checkpoint captures pipeline state at failure, enabling resume
 * from the last successful stage instead of rerunning expensive solvers.
 */

import type { DeepThinkTrace } from '../pipelines/deep-think';
import type { UsageStats } from '../backend';
import type { Check, CheckResult } from '../core/verify';

/**
 * Stage that can be completed (written to checkpoint).
 */
export type CompletedStage = 'solve' | 'judge' | 'verify';

/**
 * Stage that can fail (triggering checkpoint preservation).
 */
export type FailedStage = 'judge' | 'verify' | 'revision';

/**
 * Deep mode checkpoint for resumability.
 * 
 * Wraps a DeepThinkTrace with additional metadata needed to resume
 * from a failed stage. Stored at <session-dir>/checkpoint.yaml (project `.veda`
 * when run inside a git repo, else `~/.config/veda`).
 */
export interface DeepThinkCheckpoint {
  /** Checkpoint format version (independent of trace_version) */
  checkpoint_version: 1;
  
  /** 
   * Run identity hash for safety.
   * Computed from hash(prompt + context + options).
   * Resume warns if hash doesn't match current inputs.
   */
  runIdentityHash: string;
  
  /** Embedded trace with all stage outputs */
  trace: DeepThinkTrace;
  
  /** Whether the run completed or was interrupted */
  status: 'partial' | 'complete';
  
  /** Last successfully completed stage */
  completedStage: CompletedStage;
  
  /** Stage that failed (only set when status === 'partial') */
  failedStage?: FailedStage;
  
  /** Error message from the failed stage */
  error?: string;
  
  /** ISO timestamp when checkpoint was last written */
  timestamp: string;
  
  /** 
   * Member IDs of successful solver candidates.
   * Used to reconstruct judge input on resume.
   * Format: solver-{index}-{backend}-{model}-{category}/{module_id}
   */
  successfulCandidateIds: string[];
  
  // === Judge state (for post-judge resume) ===
  
  /** Seed used for candidate shuffling (for deterministic retry) */
  judgeSeed?: string;
  
  /** Index mapping from shuffle (for deterministic retry) */
  judgeIndexMapping?: number[];
  
  /** Original index in successful candidates array */
  judgeSelectedIndex?: number;
  
  /** Display index as shown to judge (1-indexed) */
  judgeSelectedDisplayIndex?: number;
  
  /** Member ID of the selected candidate */
  selectedCandidateId?: string;
  
  // === Verify state (for mid-verify resume) ===
  
  /** Generated verification checks (for resuming mid-verify) */
  verifyChecks?: Check[];
  
  /** Partial verification results (checks completed before failure) */
  partialVerifyResults?: CheckResult[];
  
  // === Usage tracking ===
  
  /** Accumulated token usage up to checkpoint */
  usageAtCheckpoint: UsageStats;
}

/**
 * Compute run identity hash from inputs.
 * Used to detect if resume is being attempted with different inputs.
 */
export function computeRunIdentityHash(inputs: {
  prompt: string;
  context?: string;
  options: Record<string, unknown>;
}): string {
  const serialized = JSON.stringify({
    prompt: inputs.prompt,
    context: inputs.context,
    options: inputs.options,
  });
  
  // Use Bun's fast hash, take first 16 hex chars
  const hash = Bun.hash(serialized);
  return hash.toString(16).padStart(16, '0').slice(0, 16);
}
