/**
 * DeepThink Pipeline - Full deep reasoning mode.
 * 
 * Uses:
 * - Model diversity (different backends) for self-consistency
 * - Judge aggregation to select best answer
 * - Optional Chain-of-Verification to check and revise
 */

import { getBackend, extractText, collectMessages } from '../backend';
import { getDefaults } from '../agent';
import type { UsageStats } from '../backend';
import {
  createSolver,
  createSolverPool,
  createStringEnsemble,
  createJudgeAggregator,
  createVerification,
  combineUsage,
  type Solver,
} from '../primitives';
import { SOLVER_SYSTEM_PROMPT, SOLVER_VARIANTS, JUDGE_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from './prompts';

export interface DeepThinkOptions {
  /** Backend to use (defaults to configured default) */
  backend?: string;
  /** Number of solvers/candidates (default: 3) */
  k?: number;
  /** Enable verification (default: true) */
  verify?: boolean;
  /** Context string */
  context?: string;
  /** Reasoning level for solvers (default: 'medium') */
  solverReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Reasoning level for judge (default: 'medium') */
  judgeReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Reasoning level for verifier (default: 'high') */
  verifyReasoning?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface DeepThinkResult {
  /** Final answer */
  answer: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** All candidate answers */
  candidates: string[];
  /** Whether answer was revised by verification */
  wasRevised: boolean;
  /** Usage statistics */
  usage: UsageStats;
  /** Stages completed */
  stages: string[];
}

export interface DeepThinkEvent {
  type: 'stage_start' | 'stage_complete' | 'candidate' | 'selected' | 'verified' | 'complete';
  stage?: string;
  content?: string;
  confidence?: number;
  usage?: UsageStats;
  result?: DeepThinkResult;
}

/**
 * Run the DeepThink pipeline.
 */
export async function* runDeepThink(
  prompt: string,
  options: DeepThinkOptions = {}
): AsyncGenerator<DeepThinkEvent> {
  const { 
    k = 3, 
    verify = true, 
    context,
    solverReasoning = 'medium',
    judgeReasoning = 'medium',
    verifyReasoning = 'high',
  } = options;
  
  // Get default backend
  const defaults = await getDefaults();
  const backendName = options.backend ?? defaults.backend;
  
  const usages: UsageStats[] = [];
  const stages: string[] = [];
  
  // Stage 1: Parallel solving with model diversity
  yield { type: 'stage_start', stage: 'solve' };
  stages.push('solve');
  
  // Create solver pool using default backend with prompt variants
  const solvers = createDiverseSolvers(backendName, k, solverReasoning);
  
  // Create judge
  const judgeSolver = createSolver({
    id: 'judge',
    backend: backendName,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    config: { reasoning: judgeReasoning },
  });
  
  // Create ensemble
  const ensemble = createStringEnsemble({
    name: 'solvers',
    solvers,
    aggregator: createJudgeAggregator(judgeSolver),
  });
  
  // Run ensemble
  const ensembleResult = await ensemble.run(prompt, {
    originalTask: prompt,
    priorSteps: [],
    additionalContext: context,
  });
  
  usages.push(ensembleResult.usage);
  
  // Emit candidate events
  for (let i = 0; i < ensembleResult.candidates.length; i++) {
    yield {
      type: 'candidate',
      stage: 'solve',
      content: `Candidate ${i + 1}: ${truncate(ensembleResult.candidates[i], 200)}`,
    };
  }
  
  yield {
    type: 'selected',
    stage: 'solve',
    content: ensembleResult.selected,
    confidence: ensembleResult.confidence,
  };
  
  yield {
    type: 'stage_complete',
    stage: 'solve',
    confidence: ensembleResult.confidence,
    usage: ensembleResult.usage,
  };
  
  let finalAnswer = ensembleResult.selected;
  let wasRevised = false;
  
  // Stage 2: Optional verification
  // Use multi-signal gate instead of just judge confidence:
  // 1. Minority pick: judge chose answer not in majority
  // 2. Low agreement: top cluster < 70% of candidates
  // 3. Low margin: difference between top and second < 20%
  // 4. Judge confidence as secondary backstop
  const shouldVerify = verify && needsVerification(
    ensembleResult.candidates,
    ensembleResult.selected,
    ensembleResult.confidence
  );
  
  if (shouldVerify) {
    yield { type: 'stage_start', stage: 'verify' };
    stages.push('verify');
    
    const verifierSolver = createSolver({
      id: 'verifier',
      backend: backendName,
      systemPrompt: VERIFIER_SYSTEM_PROMPT,
      config: { reasoning: verifyReasoning },
    });
    
    const verification = createVerification({
      type: 'reasoning',
      solver: verifierSolver,
    });
    
    // Generate checks
    const checks = await verification.generateChecks(finalAnswer, {
      originalTask: prompt,
      priorSteps: [{ name: 'solve', output: finalAnswer }],
    });
    
    if (checks.length > 0) {
      // Answer checks
      const results = await verification.answerChecks(checks);
      
      // Check for contradictions
      const contradictions = results.filter(r => r.contradictsDraft);
      
      if (contradictions.length > 0) {
        // Revise
        const revision = await verification.revise(finalAnswer, results);
        
        if (!revision.unchanged) {
          finalAnswer = revision.revised;
          wasRevised = true;
          
          yield {
            type: 'verified',
            stage: 'verify',
            content: `Revised: ${revision.changes.join(', ')}`,
          };
        }
      }
    }
    
    yield {
      type: 'stage_complete',
      stage: 'verify',
    };
  }
  
  // Complete
  const totalUsage = combineUsage(usages);
  
  const result: DeepThinkResult = {
    answer: finalAnswer,
    confidence: ensembleResult.confidence,
    candidates: ensembleResult.candidates,
    wasRevised,
    usage: totalUsage,
    stages,
  };
  
  yield {
    type: 'complete',
    result,
  };
}

/**
 * Determine if verification is needed based on multiple signals.
 * 
 * Triggers verification when:
 * 1. Judge picked a minority answer (not in top cluster)
 * 2. Low agreement: top cluster < 70% of candidates
 * 3. Low margin: difference between top and second cluster < 20%
 * 4. Judge confidence is low (< 0.7) as secondary backstop
 */
function needsVerification(
  candidates: string[],
  selected: string,
  judgeConfidence: number
): boolean {
  if (candidates.length <= 1) {
    return false; // Nothing to disagree on
  }
  
  // Cluster candidates by normalized content
  const clusters = clusterCandidates(candidates);
  const sortedClusters = [...clusters.entries()]
    .sort((a, b) => b[1].length - a[1].length);
  
  const topCluster = sortedClusters[0];
  const secondCluster = sortedClusters[1];
  
  const n = candidates.length;
  const topShare = topCluster[1].length / n;
  const margin = secondCluster 
    ? (topCluster[1].length - secondCluster[1].length) / n 
    : 1;
  
  // Check if selected answer is in top cluster
  const normalizedSelected = normalizeForClustering(selected);
  const selectedInTop = topCluster[1].some(
    c => normalizeForClustering(c) === normalizedSelected
  );
  
  // Trigger verification if any condition met:
  // 1. Minority pick
  if (!selectedInTop) {
    return true;
  }
  
  // 2. Low agreement (< 70%)
  if (topShare < 0.7) {
    return true;
  }
  
  // 3. Low margin (< 20%)
  if (margin < 0.2) {
    return true;
  }
  
  // 4. Low judge confidence (< 0.7) as backstop
  if (judgeConfidence < 0.7) {
    return true;
  }
  
  return false;
}

/**
 * Cluster candidates by normalized string similarity.
 * Returns map of normalized form → original candidates.
 */
function clusterCandidates(candidates: string[]): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  
  for (const candidate of candidates) {
    const normalized = normalizeForClustering(candidate);
    
    // Find existing cluster with similar normalized form
    let found = false;
    for (const [key, members] of clusters) {
      if (areSimilar(normalized, key)) {
        members.push(candidate);
        found = true;
        break;
      }
    }
    
    if (!found) {
      clusters.set(normalized, [candidate]);
    }
  }
  
  return clusters;
}

/**
 * Normalize text for clustering comparison.
 * Extracts key content, ignoring formatting and filler.
 */
function normalizeForClustering(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#]/g, '') // Remove markdown
    .replace(/\s+/g, ' ')   // Normalize whitespace
    .replace(/[.,!?;:'"()-]/g, '') // Remove punctuation
    .trim()
    .slice(0, 100); // Compare first 100 chars for efficiency
}

/**
 * Check if two normalized strings are similar enough to be in same cluster.
 */
function areSimilar(a: string, b: string): boolean {
  // Exact match after normalization
  if (a === b) return true;
  
  // Very short strings (likely simple answers like "yes", "no", "42")
  // must match more strictly
  if (a.length < 20 || b.length < 20) {
    // One starts with the other (handles "yes" vs "yes because...")
    if (a.startsWith(b) || b.startsWith(a)) return true;
    
    // Extract first significant word for simple answers
    // Skip common articles/starters
    const skipWords = new Set(['the', 'a', 'an', 'i', 'it', 'is', 'to', 'in', 'for']);
    const getFirstSignificant = (s: string) => {
      const words = s.split(' ');
      for (const w of words) {
        if (w.length > 1 && !skipWords.has(w)) return w;
      }
      return words[0];
    };
    
    const firstA = getFirstSignificant(a);
    const firstB = getFirstSignificant(b);
    if (firstA && firstB && firstA === firstB) {
      return true;
    }
  }
  
  // For longer answers, require higher similarity
  // Only cluster if they share substantial prefix (not just "The...")
  const minPrefixLen = Math.min(30, Math.min(a.length, b.length));
  if (a.slice(0, minPrefixLen) === b.slice(0, minPrefixLen)) {
    return true;
  }
  
  return false;
}

/**
 * Create diverse solvers using a single backend with prompt variants.
 * Diversity comes from different system prompt phrasings, not different models.
 */
function createDiverseSolvers(
  backendName: string, 
  k: number,
  reasoning: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium'
): Solver[] {
  const solvers: Solver[] = [];
  
  for (let i = 0; i < k; i++) {
    const variantIdx = i % SOLVER_VARIANTS.length;
    
    solvers.push(createSolver({
      id: `solver-${i}`,
      backend: backendName,
      systemPrompt: SOLVER_VARIANTS[variantIdx],
      config: { reasoning },
    }));
  }
  
  return solvers;
}

/**
 * Truncate text to max length.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
