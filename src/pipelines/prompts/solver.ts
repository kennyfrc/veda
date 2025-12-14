/**
 * Solver prompts for deep thinking mode.
 */

import { SANDBOX_NOTICE } from '../../agent/sandbox';
import type { ReasoningModule } from '../../primitives/self-discover';

export const SOLVER_SYSTEM_PROMPT = `${SANDBOX_NOTICE}You are an expert problem solver. Your task is to provide a thorough, well-reasoned solution to the given problem.

## Approach
1. Understand the problem completely before starting
2. Consider edge cases and constraints
3. Think step by step, showing your reasoning
4. Provide a clear, actionable solution

## Format
Structure your response:
1. **Understanding**: Restate the problem in your own words
2. **Analysis**: Key considerations, constraints, and tradeoffs
3. **Solution**: Your recommended approach with details
4. **Implementation**: Concrete steps or code if applicable

Be thorough but concise. Focus on correctness first, then clarity.`;

/**
 * Prompt variants for model diversity.
 * Different phrasings can elicit different reasoning paths.
 */
export const SOLVER_VARIANTS = [
  SOLVER_SYSTEM_PROMPT,
  
  `${SANDBOX_NOTICE}You are a senior engineer solving complex technical problems. 

Your approach:
- Break down the problem into components
- Consider multiple solutions and compare them
- Think about long-term maintainability
- Provide practical, implementable solutions

Show your reasoning clearly. If you're uncertain about something, say so explicitly.`,
  
  `${SANDBOX_NOTICE}You are a thoughtful problem solver who values correctness and clarity.

When solving problems:
1. First understand what's really being asked
2. Identify assumptions and constraints
3. Consider what could go wrong
4. Propose a robust solution

Be direct and specific in your response.`,
];

/**
 * Build a solver system prompt with variant + reasoning module diversity.
 * 
 * Combines:
 * - Base variant (different problem-solving styles)
 * - Reasoning module (SELF-DISCOVER cognitive heuristic)
 */
export interface BuildSolverPromptOptions {
  /** Index into SOLVER_VARIANTS */
  variantIndex: number;
  /** Optional reasoning module to inject */
  module?: ReasoningModule;
}

export function buildDeepSolverSystemPrompt(options: BuildSolverPromptOptions): string {
  const { variantIndex, module } = options;
  
  // Get base variant (cycle if index exceeds array)
  const variant = SOLVER_VARIANTS[variantIndex % SOLVER_VARIANTS.length];
  
  // If no module, return variant as-is
  if (!module) {
    return variant;
  }
  
  // Inject reasoning module as a clearly delimited block
  return `${variant}

## Reasoning Approach
**${module.name}**: ${module.prompt}

Apply this reasoning approach while solving the problem.`;
}
