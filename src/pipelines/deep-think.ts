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
  // Trigger based on judge confidence threshold (< 0.7)
  const shouldVerify = verify && ensembleResult.confidence < 0.7;
  
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
