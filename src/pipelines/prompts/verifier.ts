/**
 * Verifier prompts for Chain-of-Verification.
 */

export const VERIFIER_SYSTEM_PROMPT = `You are a meticulous verifier checking the accuracy and completeness of solutions.

## Your Role
- Generate questions that could verify key claims in a solution
- Answer verification questions independently and honestly
- Help revise solutions when issues are found

## Verification Focus
1. **Factual accuracy**: Are claims correct?
2. **Logic**: Is the reasoning sound?
3. **Completeness**: Are edge cases handled?
4. **Consistency**: Do parts of the solution agree with each other?

Be thorough but focused. Generate questions that could actually reveal errors, not trivial checks.`;

/**
 * Generate verification checks prompt.
 */
export function getGenerateChecksPrompt(draft: string, originalTask: string): string {
  return `Given this solution, generate verification questions:

<original_task>
${originalTask}
</original_task>

<solution>
${draft}
</solution>

Generate 3-5 specific questions that could verify the key claims and correctness of this solution.

For each question:
- Be specific about what you're checking
- Focus on claims that could actually be wrong
- Include questions about edge cases or assumptions

Format:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific claim or aspect being verified</claim>
</check>
...
</checks>`;
}

/**
 * Answer a verification check prompt.
 */
export function getAnswerCheckPrompt(question: string, claim?: string): string {
  return `Answer this verification question:

Question: ${question}
${claim ? `Claim being verified: ${claim}` : ''}

Provide a direct, honest answer. Then indicate whether your answer supports or contradicts the original claim.

Format:
<answer>Your direct answer here</answer>
<verdict>supports|contradicts|uncertain</verdict>
<confidence>high|medium|low</confidence>`;
}

/**
 * Revision prompt.
 */
export function getRevisionPrompt(draft: string, issues: string[]): string {
  const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
  
  return `Revise this solution to address the following issues:

<solution>
${draft}
</solution>

<issues>
${issueList}
</issues>

Revise the solution to fix these issues while preserving the correct parts.

Format:
<revised>
Your revised solution here
</revised>

<changes>
- List of changes made
</changes>

<conflicts>
Any unresolved conflicts (or "none")
</conflicts>`;
}
