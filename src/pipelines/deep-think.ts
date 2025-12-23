// DeepThink: parallel solvers → judge aggregation → optional verification.

import { loadGlobalConfig, resolveBackendModel } from '../agent';
import { AsyncQueue } from '../util';
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
  backend?: string;
  model?: string;
  k?: number;
  verify?: boolean;
  context?: string;
  solverReasoning?: Reasoning;
  judgeReasoning?: Reasoning;
  verifyReasoning?: Reasoning;
  categories?: string[];
  modules?: string[];
  cwd?: string;
  solverBackends?: string[];  // Array of backends for parallel solvers (supports randomization)
  solverModel?: string;
  judgeBackend?: string;
  judgeModel?: string;
  verifierBackend?: string;
  verifierModel?: string;
}

export interface DeepThinkResult {
  answer: string;
  confidence: number;
  candidates: string[];
  wasRevised: boolean;
  usage: UsageStats;
  stages: string[];
  trace?: DeepThinkTrace;
}

export interface DeepThinkTrace {
  prompt: string;
  context?: string;
  options: {
    backend: string;
    model?: string;
    k: number;
    verify: boolean;
    categories?: string[];
    modules?: string[];
    solver?: { backend: string; model?: string };
    solverBackends?: string[];  // Randomized backends used
    judge?: { backend: string; model?: string };
    verifier?: { backend: string; model?: string };
  };
  solve: {
    candidates: Array<{
      id: string;
      module: { id: string; category: string; name: string };
      response: string;
      usage?: UsageStats;
    }>;
  };
  judge: {
    selectedIndex: number;
    confidence: number;
    reasoning?: string;
  };
  verify?: {
    checks: Array<{ id: string; question: string; targetClaim?: string }>;
    results: Array<{
      checkId: string;
      answer: string;
      verdict: 'supports' | 'contradicts' | 'uncertain';
      confidence: number;
    }>;
    revision?: { changes: string[]; revised: string };
  };
}

export interface DeepThinkEvent {
  type: 'stage_start' | 'stage_complete' | 'candidate' | 'selected' | 'verified' | 'complete' | 'tool_start' | 'error' | 'ensemble_complete' | 'solver_complete';
  stage?: string;
  content?: string;
  source?: string;
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
  
  const queue = new AsyncQueue<DeepThinkEvent>();
  const usages: (UsageStats | undefined)[] = [];
  const stages: string[] = [];
  const cwd = options.cwd ?? process.cwd();

  const makeToolEvent = (source: string, msg: Message): DeepThinkEvent | null => {
    if (msg.type !== 'tool_start' && msg.type !== 'tool_use') return null;
    return {
      type: 'tool_start',
      source,
      content: msg.toolName,
      toolInput: msg.toolInput,
    };
  };

  // Run the main logic in the background
  (async () => {
    try {
      const globalConfig = await loadGlobalConfig();

      const base = resolveBackendModel({
        explicitBackend: options.backend,
        explicitModel: options.model,
        fallbackBackend: options.backend ?? globalConfig.backend,
        globalConfig,
      });

      // Determine solver backends (supports randomization)
      // If solverBackends is provided, use it; otherwise use single backend
      const solverBackends = options.solverBackends ?? [base.backend];

      // Pre-resolve models for each distinct backend
      const backendModels = new Map<string, string | undefined>();
      for (const backend of new Set(solverBackends)) {
        const resolved = resolveBackendModel({
          explicitBackend: backend,
          explicitModel: options.solverModel,
          fallbackBackend: base.backend,
          fallbackModel: base.model,
          globalConfig,
        });
        if (!resolved.model) {
          throw new Error(`Unable to resolve model for solver backend '${backend}'. Specify --solver-model or set MODEL in config.`);
        }
        backendModels.set(backend, resolved.model);
      }

      const judge = resolveBackendModel({
        explicitBackend: options.judgeBackend,
        explicitModel: options.judgeModel,
        fallbackBackend: base.backend,
        fallbackModel: base.model,
        globalConfig,
      });

      const verifier = resolveBackendModel({
        explicitBackend: options.verifierBackend,
        explicitModel: options.verifierModel,
        fallbackBackend: base.backend,
        fallbackModel: base.model,
        globalConfig,
      });

      if (!judge.model) {
        throw new Error(`Unable to resolve model for judge backend '${judge.backend}'. Specify --judge-model or set MODEL in config.`);
      }
      
      const trace: DeepThinkTrace = {
        prompt,
        context,
        options: {
          backend: base.backend,
          model: base.model,
          k,
          verify,
          categories: options.categories,
          modules: options.modules,
          solver: { backend: solverBackends[0], model: backendModels.get(solverBackends[0]) },
          solverBackends: solverBackends,
          judge: { backend: judge.backend, model: judge.model },
          verifier: { backend: verifier.backend, model: verifier.model },
        },
        solve: { candidates: [] },
        judge: { selectedIndex: 0, confidence: 0 },
      };

      queue.push({ type: 'stage_start', stage: 'solve' });
      stages.push('solve');

      const modules = selectModules({
        k,
        categories: options.categories,
        modules: options.modules,
      });

      const members: EnsembleMember[] = modules.map((module, i) => {
        const backend = solverBackends[i % solverBackends.length];
        const model = backendModels.get(backend);
        return {
          id: `solver-${i}-${module.category}`,
          request: {
            backend,
            model,
            prompt,
            context,
            systemPrompt: buildDeepSolverSystemPrompt({ module }),
            reasoning: solverReasoning,
            sandbox: 'read-only' as const,
            cwd,
          },
        };
      });
      
      const ensembleResult = await runEnsemble(members, (event: EnsembleEvent) => {
        const toolEvent = makeToolEvent(event.memberId, event.message);
        if (toolEvent) queue.push(toolEvent);
        
        if (event.message.type === 'done') {
          queue.push({
            type: 'solver_complete',
            stage: 'solve',
            source: event.memberId,
            usage: event.message.usage,
          });
        }
      });

      usages.push(ensembleResult.totalUsage);
      queue.push({ type: 'ensemble_complete', usage: ensembleResult.totalUsage });
      
      const solverErrors = ensembleResult.outputs.flatMap(o => o.backendErrors ?? []);
      if (solverErrors.length > 0) {
        queue.push({ type: 'error', stage: 'solve', content: solverErrors[0] });
        queue.done();
        return;
      }
      
      if (ensembleResult.successful.length === 0) {
        const exceptionErrors = ensembleResult.outputs
          .filter(o => o.error)
          .map(o => o.error!);
        queue.push({ 
          type: 'error', 
          stage: 'solve', 
          content: exceptionErrors[0] ?? 'All solvers failed to produce output',
        });
        queue.done();
        return;
      }
      
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
      
      const judgeResult = await runJudge({
        backend: judge.backend,
        model: judge.model,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        reasoning: judgeReasoning,
        sandbox: 'read-only',
        cwd,
        candidates: ensembleResult.successful,
        originalTask: prompt,
        onMessage: (msg: Message) => {
          const toolEvent = makeToolEvent('judge', msg);
          if (toolEvent) queue.push(toolEvent);
        },
      });
      usages.push(judgeResult.usage);
      
      trace.judge.selectedIndex = judgeResult.decision.selectedIndex;
      trace.judge.confidence = judgeResult.decision.confidence;
      trace.judge.reasoning = judgeResult.decision.reasoning;
      
      for (let i = 0; i < ensembleResult.successful.length; i++) {
        queue.push({
          type: 'candidate',
          stage: 'solve',
          content: `Candidate ${i + 1}: ${truncate(ensembleResult.successful[i], 200)}`,
        });
      }
      
      queue.push({
        type: 'selected',
        stage: 'solve',
        content: judgeResult.selected,
        confidence: judgeResult.decision.confidence,
      });
      
      queue.push({
        type: 'stage_complete',
        stage: 'solve',
        confidence: judgeResult.decision.confidence,
        usage: ensembleResult.totalUsage,
      });
      
      let finalAnswer = judgeResult.selected;
      let wasRevised = false;
      
      // Verify if judge confidence is low (< 0.7)
      const shouldVerify = verify && judgeResult.decision.confidence < 0.7;
      
      if (shouldVerify) {
        if (!verifier.model) {
          throw new Error(`Unable to resolve model for verifier backend '${verifier.backend}'. Specify --verifier-model or set MODEL in config.`);
        }
        
        queue.push({ type: 'stage_start', stage: 'verify' });
        stages.push('verify');
        
        const verifyResult = await runVerification({
          backend: verifier.backend,
          model: verifier.model,
          systemPrompt: VERIFIER_SYSTEM_PROMPT,
          reasoning: verifyReasoning,
          sandbox: 'full',
          cwd,
          type: 'reasoning',
          draft: finalAnswer,
          originalTask: prompt,
          onMessage: (msg: Message) => {
            const toolEvent = makeToolEvent('verifier', msg);
            if (toolEvent) queue.push(toolEvent);
          },
        });
        usages.push(verifyResult.usage);
        
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
        
        if (verifyResult.revision && !verifyResult.revision.unchanged) {
          finalAnswer = verifyResult.revision.revised;
          wasRevised = true;
          
          trace.verify.revision = {
            changes: verifyResult.revision.changes,
            revised: verifyResult.revision.revised,
          };
          
          queue.push({
            type: 'verified',
            stage: 'verify',
            content: `Revised: ${verifyResult.revision.changes.join(', ')}`,
          });
        }
        
        queue.push({
          type: 'stage_complete',
          stage: 'verify',
        });
      }
      
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
      
      queue.push({
        type: 'complete',
        result,
      });
      queue.done();
    } catch (e) {
      queue.fail(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  yield* queue;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
