/**
 * DeepThink Pipeline - Full deep reasoning mode.
 * 
 * Based on:
 * - Self-Consistency (Wang et al., 2022) - sample diverse reasoning paths, aggregate
 *   https://arxiv.org/abs/2203.11171
 * - Universal Self-Consistency (Chen et al., 2023) - LLM as judge to select best
 *   https://arxiv.org/abs/2311.17311
 * - Chain-of-Verification (Dhuliawala et al., 2023) - fact-check before finalizing
 *   https://arxiv.org/abs/2309.11495
 * 
 * Uses:
 * - Reasoning modules for cognitive diversity (different problem-solving strategies)
 * - Prompt variants for stylistic diversity
 * - Judge aggregation to select best answer
 * - Optional Chain-of-Verification to check and revise
 */

import { getDefaults } from '../agent';
import type { UsageStats } from '../backend';
import {
  createSolver,
  createStringEnsemble,
  createJudgeAggregator,
  createVerification,
  combineUsage,
  selectModules,
  type Solver,
  type ReasoningModule,
} from '../primitives';
import { buildDeepSolverSystemPrompt, JUDGE_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from './prompts';

export interface DeepThinkOptions {
  /** Backend to use (defaults to configured default) */
  backend?: string;
  /** Number of solvers/candidates (default: 4, max: 8) */
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
  /** Specific categories to sample modules from */
  categories?: string[];
  /** Exact module IDs to use (overrides k and categories) */
  modules?: string[];
  /** Working directory for verifier to access project files (default: process.cwd()) */
  cwd?: string;
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
  /** Trace data for --trace output */
  trace?: DeepThinkTrace;
}

export interface DeepThinkTrace {
  /** Prompt sent to solvers */
  prompt: string;
  /** Context string (if any) */
  context?: string;
  /** Options used */
  options: {
    k: number;
    verify: boolean;
    categories?: string[];
    modules?: string[];
  };
  /** Solver candidates with module info */
  solve: {
    candidates: Array<{
      id: string;
      module: {
        id: string;
        category: string;
        name: string;
      };
      response: string;
      usage?: UsageStats;
    }>;
  };
  /** Judge aggregation */
  judge: {
    selectedIndex: number;
    confidence: number;
    reasoning?: string;
  };
  /** Verification (if run) */
  verify?: {
    checks: Array<{
      id: string;
      question: string;
      targetClaim?: string;
    }>;
    results: Array<{
      checkId: string;
      answer: string;
      verdict: 'supports' | 'contradicts' | 'uncertain';
      confidence: number;
    }>;
    revision?: {
      changes: string[];
      revised: string;
    };
  };
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
    k = 4, 
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
  
  // Initialize trace data
  const trace: DeepThinkTrace = {
    prompt,
    context,
    options: {
      k,
      verify,
      categories: options.categories,
      modules: options.modules,
    },
    solve: { candidates: [] },
    judge: { selectedIndex: 0, confidence: 0 },
  };
  
  // Stage 1: Parallel solving with cognitive diversity
  yield { type: 'stage_start', stage: 'solve' };
  stages.push('solve');
  
  // Select reasoning modules for diverse problem-solving strategies
  const modules = selectModules({
    k,
    categories: options.categories,
    modules: options.modules,
  });
  
  // Create diverse solvers with variant + module combinations
  const solvers = createDiverseSolvers(backendName, modules, solverReasoning);
  
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
  
  // Populate trace with solver candidates and modules
  for (let i = 0; i < ensembleResult.candidates.length; i++) {
    const module = modules[i];
    trace.solve.candidates.push({
      id: `solver-${i}-${module.category}`,
      module: {
        id: module.id,
        category: module.category,
        name: module.name,
      },
      response: ensembleResult.candidates[i],
    });
  }
  
  // Find which candidate was selected
  const selectedIndex = ensembleResult.candidates.findIndex(
    c => c === ensembleResult.selected
  );
  trace.judge.selectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  trace.judge.confidence = ensembleResult.confidence;
  
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
      config: { 
        reasoning: verifyReasoning,
        // Pass cwd so verifier can access project files in read-only mode
        cwd: options.cwd ?? process.cwd(),
      },
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
    
    // Initialize verification trace
    trace.verify = {
      checks: checks.map(c => ({
        id: c.id,
        question: c.question,
        targetClaim: c.targetClaim,
      })),
      results: [],
    };
    
    if (checks.length > 0) {
      // Answer checks
      const results = await verification.answerChecks(checks);
      
      // Populate trace with check results
      trace.verify.results = results.map(r => ({
        checkId: r.checkId,
        answer: r.answer,
        verdict: r.contradictsDraft ? 'contradicts' : (r.confidence >= 0.7 ? 'supports' : 'uncertain'),
        confidence: r.confidence,
      }));
      
      // Check for contradictions
      const contradictions = results.filter(r => r.contradictsDraft);
      
      if (contradictions.length > 0) {
        // Revise
        const revision = await verification.revise(finalAnswer, results);
        
        if (!revision.unchanged) {
          finalAnswer = revision.revised;
          wasRevised = true;
          
          // Add revision to trace
          trace.verify.revision = {
            changes: revision.changes,
            revised: revision.revised,
          };
          
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
    trace,
  };
  
  yield {
    type: 'complete',
    result,
  };
}

/**
 * Create diverse solvers using reasoning modules for cognitive diversity.
 * 
 * Diversity comes from:
 * 1. Different reasoning modules (cognitive heuristics)
 * 2. Different prompt variants (stylistic differences)
 */
function createDiverseSolvers(
  backendName: string, 
  modules: ReasoningModule[],
  reasoning: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium'
): Solver[] {
  return modules.map((module, i) => {
    const systemPrompt = buildDeepSolverSystemPrompt({
      variantIndex: i,
      module,
    });
    
    return createSolver({
      id: `solver-${i}-${module.category}`,
      backend: backendName,
      systemPrompt,
      config: { reasoning },
    });
  });
}

/**
 * Truncate text to max length.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
