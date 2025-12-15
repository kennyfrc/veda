import { collectMessages, extractText, getSessionId, getUsage } from '../backend';
import type { Message, UsageStats } from '../backend';
import type { Step, StepContext, StepResult, Solver } from './types';

export interface CreateStepOptions<I, O> {
  name: string;
  solver: Solver;
  formatPrompt: (input: I, context?: StepContext) => string;
  parseOutput: (messages: Message[]) => O;
}

export function createStep<I, O>(options: CreateStepOptions<I, O>): Step<I, O> {
  const { name, solver, formatPrompt, parseOutput } = options;
  
  return {
    name,
    solver,
    formatPrompt,
    parseOutput,
    
    async run(input: I, context?: StepContext): Promise<StepResult<O>> {
      const prompt = formatPrompt(input, context);
      const additionalContext = context?.additionalContext;
      
      const messages = await collectMessages(solver.run(prompt, additionalContext));
      
      const output = parseOutput(messages);
      const sessionId = getSessionId(messages) ?? '';
      const usage = getUsage(messages) ?? { inputTokens: 0, outputTokens: 0 };
      
      return { output, usage, sessionId, messages };
    },
  };
}

export function createTextStep(options: {
  name: string;
  solver: Solver;
  formatPrompt?: (input: string, context?: StepContext) => string;
}): Step<string, string> {
  return createStep({
    name: options.name,
    solver: options.solver,
    formatPrompt: options.formatPrompt ?? ((input, ctx) => {
      if (ctx?.additionalContext) return `${ctx.additionalContext}\n\n${input}`;
      return input;
    }),
    parseOutput: (messages) => extractText(messages),
  });
}

export function combineUsage(usages: UsageStats[]): UsageStats {
  return usages.reduce(
    (acc, u) => ({
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cachedTokens: (acc.cachedTokens ?? 0) + (u.cachedTokens ?? 0) || undefined,
      costUsd: (acc.costUsd ?? 0) + (u.costUsd ?? 0) || undefined,
    }),
    { inputTokens: 0, outputTokens: 0 }
  );
}
