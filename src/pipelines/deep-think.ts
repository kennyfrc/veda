// DeepThink: parallel solvers with diverse reasoning → judge aggregation → optional verification.

import { getDefaults, loadGlobalConfig, resolveModel } from '../agent';
import type { Message, UsageStats } from '../backend';
import {
  runEnsemble,
  runJudge,
  runVerification,
  combineUsage,
  selectModules,
  type EnsembleMember,
  type EnsembleEvent,
  type Reasoning,
} from '../core';
import { buildDeepSolverSystemPrompt, JUDGE_SYSTEM_PROMPT, VERIFIER_SYSTEM_PROMPT } from './prompts';

export interface DeepThinkOptions {
  /** Backend to use (defaults to configured default) */
  backend?: string;
  /** Model override (defaults to backend's default model) */
  model?: string;
  /** Number of solvers/candidates (default: 3, max: 8) */
  k?: number;
  /** Enable verification (default: true) */
  verify?: boolean;
  /** Context string */
  context?: string;
  /** Reasoning level for solvers (default: 'medium') */
  solverReasoning?: Reasoning;
  /** Reasoning level for judge (default: 'medium') */
  judgeReasoning?: Reasoning;
  /** Reasoning level for verifier (default: 'high') */
  verifyReasoning?: Reasoning;
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
    backend: string;
    model?: string;
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
  type: 'stage_start' | 'stage_complete' | 'candidate' | 'selected' | 'verified' | 'complete' | 'tool_start';
  stage?: string;
  /** For most events: descriptive content. For tool_start: tool name */
  content?: string;
  /** For tool_start: source identifier (e.g., "solver-0", "judge", "verifier") */
  source?: string;
  /** For tool_start: tool input/arguments */
  toolInput?: unknown;
  confidence?: number;
  usage?: UsageStats;
  result?: DeepThinkResult;
}

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
  
  // Get defaults and resolve backend/model
  const defaults = await getDefaults();
  const globalConfig = await loadGlobalConfig();
  const backendName = options.backend ?? defaults.backend;
  
  // Resolve model for this backend (explicit override or backend default)
  const model = resolveModel({
    backend: backendName,
    explicitModel: options.model,
    globalConfig,
  });
  
  const usages: (UsageStats | undefined)[] = [];
  const stages: string[] = [];
  const cwd = options.cwd ?? process.cwd();
  
  // Event queue for tool_start events from callbacks
  const pendingEvents: DeepThinkEvent[] = [];
  
  // Helper to create tool_start event from message
  const makeToolEvent = (source: string, msg: Message): DeepThinkEvent | null => {
    if (msg.type !== 'tool_start') return null;
    return {
      type: 'tool_start',
      source,
      content: msg.toolName,
      toolInput: msg.toolInput,
    };
  };
  
  // Initialize trace data
  const trace: DeepThinkTrace = {
    prompt,
    context,
    options: {
      backend: backendName,
      model,
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
  
  // Build ensemble members (plain data)
  const members: EnsembleMember[] = modules.map((module, i) => ({
    id: `solver-${i}-${module.category}`,
    request: {
      backend: backendName,
      model,
      prompt,
      context,
      systemPrompt: buildDeepSolverSystemPrompt({ module }),
      reasoning: solverReasoning,
      sandbox: 'read-only' as const,
      cwd,
    },
  }));
  
  // Run ensemble with event callback
  const ensembleResult = await runEnsemble(members, (event: EnsembleEvent) => {
    const toolEvent = makeToolEvent(event.memberId, event.message);
    if (toolEvent) pendingEvents.push(toolEvent);
  });
  usages.push(ensembleResult.totalUsage);
  
  // Yield any pending tool events from solvers
  while (pendingEvents.length > 0) {
    yield pendingEvents.shift()!;
  }
  
  // Populate trace with solver candidates and modules
  for (let i = 0; i < ensembleResult.outputs.length; i++) {
    const output = ensembleResult.outputs[i];
    const module = modules[i];
    trace.solve.candidates.push({
      id: output.id,
      module: {
        id: module.id,
        category: module.category,
        name: module.name,
      },
      response: output.text,
      usage: output.usage,
    });
  }
  
  // Run judge to select best candidate
  const judgeResult = await runJudge({
    backend: backendName,
    model,
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    reasoning: judgeReasoning,
    sandbox: 'read-only',
    cwd,
    candidates: ensembleResult.successful,
    originalTask: prompt,
    onMessage: (msg: Message) => {
      const toolEvent = makeToolEvent('judge', msg);
      if (toolEvent) pendingEvents.push(toolEvent);
    },
  });
  usages.push(judgeResult.usage);
  
  // Yield any pending tool events from judge
  while (pendingEvents.length > 0) {
    yield pendingEvents.shift()!;
  }
  
  // Update trace with judge decision
  trace.judge.selectedIndex = judgeResult.decision.selectedIndex;
  trace.judge.confidence = judgeResult.decision.confidence;
  trace.judge.reasoning = judgeResult.decision.reasoning;
  
  // Emit candidate events
  for (let i = 0; i < ensembleResult.successful.length; i++) {
    yield {
      type: 'candidate',
      stage: 'solve',
      content: `Candidate ${i + 1}: ${truncate(ensembleResult.successful[i], 200)}`,
    };
  }
  
  yield {
    type: 'selected',
    stage: 'solve',
    content: judgeResult.selected,
    confidence: judgeResult.decision.confidence,
  };
  
  yield {
    type: 'stage_complete',
    stage: 'solve',
    confidence: judgeResult.decision.confidence,
    usage: ensembleResult.totalUsage,
  };
  
  let finalAnswer = judgeResult.selected;
  let wasRevised = false;
  
  // Stage 2: Optional verification
  // Trigger based on judge confidence threshold (< 0.7)
  const shouldVerify = verify && judgeResult.decision.confidence < 0.7;
  
  if (shouldVerify) {
    yield { type: 'stage_start', stage: 'verify' };
    stages.push('verify');
    
    const verifyResult = await runVerification({
      backend: backendName,
      model,
      systemPrompt: VERIFIER_SYSTEM_PROMPT,
      reasoning: verifyReasoning,
      sandbox: 'full',
      cwd,
      type: 'reasoning',
      draft: finalAnswer,
      originalTask: prompt,
      onMessage: (msg: Message) => {
        const toolEvent = makeToolEvent('verifier', msg);
        if (toolEvent) pendingEvents.push(toolEvent);
      },
    });
    usages.push(verifyResult.usage);
    
    // Yield any pending tool events from verifier
    while (pendingEvents.length > 0) {
      yield pendingEvents.shift()!;
    }
    
    // Initialize verification trace
    trace.verify = {
      checks: verifyResult.checks.map(c => ({
        id: c.id,
        question: c.question,
        targetClaim: c.targetClaim,
      })),
      results: verifyResult.results.map(r => ({
        checkId: r.checkId,
        answer: r.answer,
        verdict: r.contradictsDraft ? 'contradicts' : (r.confidence >= 0.7 ? 'supports' : 'uncertain'),
        confidence: r.confidence,
      })),
    };
    
    // Check if revision happened
    if (verifyResult.revision && !verifyResult.revision.unchanged) {
      finalAnswer = verifyResult.revision.revised;
      wasRevised = true;
      
      // Add revision to trace
      trace.verify.revision = {
        changes: verifyResult.revision.changes,
        revised: verifyResult.revision.revised,
      };
      
      yield {
        type: 'verified',
        stage: 'verify',
        content: `Revised: ${verifyResult.revision.changes.join(', ')}`,
      };
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
    confidence: judgeResult.decision.confidence,
    candidates: ensembleResult.successful,
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

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
