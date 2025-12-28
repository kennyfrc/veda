/**
 * Escape XML special characters to prevent prompt injection/malformation.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const VERIFIER_SYSTEM_PROMPT = `<conversation_rules>
You are a meticulous verifier checking the accuracy and completeness of solutions.

## Role
- Generate questions that could verify key claims in a solution
- Answer verification questions by **actively inspecting and testing the codebase**
- Help revise solutions when issues are found

## Capabilities
You have **full access** to the local repository:
- Read, search, and inspect any files
- Run tests, type checks, and linters
- Execute code and scripts
- Write temporary files to \`/tmp\` for verification

You **cannot**:
- Modify source files in the repository
- Make network requests to external services

## Verification Focus
1. **Factual accuracy**: Are claims correct? Run commands to verify.
2. **Logic**: Is the reasoning sound? Test edge cases.
3. **Completeness**: Are all cases handled? Check the code paths.
4. **Consistency**: Do parts of the solution agree? Cross-reference files.

## Be Proactive
**Don't just reason—run commands to verify.** Evidence from real execution is more reliable than speculation.

- **Run the test suite** to catch regressions
- **Run type checks** to verify type safety
- **Execute code snippets** to confirm behavior
- **Search the codebase** for usages and patterns
- **Read the actual files** mentioned in solutions

If a solution claims "function X does Y", call the function and check. If it claims "file A imports B", read the file and confirm.

## Evidence-Based Verification
When answering verification questions:
- **Run commands first**, reason second
- **Cite specific files, line numbers, and command outputs**
- **Include actual output** from tests, type checks, or scripts
- If you cannot verify something, say "uncertain" and explain why

## Writing Verification Scripts
When existing tests are insufficient:
1. **Create scripts in /tmp** (e.g., \`/tmp/verify-<name>.ts\`)
2. **Run the script** and capture output
3. **Delete the script after** - clean up with \`rm /tmp/verify-*.{ts,py,js,sh}\`

Be thorough but focused. Generate questions that could actually reveal errors, not trivial checks.
</conversation_rules>`;

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
- Assess the difficulty of verifying this claim

Difficulty levels:
- **easy**: Simple lookup or check (read a file, run a command, check an import)
- **moderate**: Requires some analysis (trace logic, check multiple files, test edge case)
- **hard**: Complex reasoning (prove correctness, analyze algorithm, verify invariants)

Format:
<checks>
<check id="1">
<question>Your verification question</question>
<claim>The specific claim or aspect being verified</claim>
<difficulty>easy|moderate|hard</difficulty>
</check>
...
</checks>`;
}

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
 * Factored verification prompt: answers a single check WITHOUT access to the original draft.
 * This isolation prevents copying hallucinations from the draft.
 */
export function getFactoredAnswerCheckPrompt(
  check: { id: string; question: string; targetClaim?: string },
  originalTask: string
): string {
  // Escape XML special characters to prevent prompt malformation/injection
  // Note: We escape task/question/claim content but NOT check.id, since:
  // 1. IDs are typically simple strings ("1", "2") assigned by the system
  // 2. Escaping IDs would cause mismatch when comparing response ID to check.id
  const safeTask = escapeXml(originalTask);
  const safeQuestion = escapeXml(check.question);
  const safeClaim = check.targetClaim ? escapeXml(check.targetClaim) : undefined;

  return `Answer this verification question independently, from first principles.

<task_context>
${safeTask}
</task_context>

<check id="${check.id}">
<question>${safeQuestion}</question>
${safeClaim ? `<claim>${safeClaim}</claim>` : ''}
</check>

**Important**: Investigate this claim independently. Do NOT assume any prior answer is correct.
Run commands, read files, or test code to gather evidence before concluding.

Format your response as:
<result id="${check.id}">
<answer>Your direct answer with evidence (cite files, line numbers, command outputs)</answer>
<verdict>supports|contradicts|uncertain</verdict>
<confidence>high|medium|low</confidence>
</result>`;
}

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
