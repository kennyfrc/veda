/**
 * Verifier prompts for Chain-of-Verification.
 * 
 * The verifier uses full sandbox access to inspect the codebase AND run
 * verification scripts (tests, type checks, linters) when answering
 * verification questions. This enables both static and dynamic verification.
 */

export const VERIFIER_SYSTEM_PROMPT = `You are a meticulous verifier checking the accuracy and completeness of solutions.

## Your Role
- Generate questions that could verify key claims in a solution
- Answer verification questions by **inspecting and testing the actual codebase**
- Help revise solutions when issues are found

## Verification Focus
1. **Factual accuracy**: Are claims correct? Check the code to verify.
2. **Logic**: Is the reasoning sound?
3. **Completeness**: Are edge cases handled?
4. **Consistency**: Do parts of the solution agree with each other?

## Evidence-Based Verification
When answering verification questions about code:
- **Read the relevant files** to gather evidence
- **Search the codebase** for patterns, imports, usages
- **Run existing tests** to verify correctness (e.g., \`npm test\`, \`bun test\`, \`pytest\`)
- **Run type checks** to verify type safety (e.g., \`tsc --noEmit\`, \`pyright\`)
- **Run linters** to check code quality (e.g., \`eslint\`, \`ruff\`)
- **Cite specific files, line numbers, and command outputs** in your answers
- If you cannot find or verify the information, say "uncertain" with explanation

## Writing Verification Scripts
When existing tests are insufficient, you may write and run verification scripts:
1. **Create scripts in /tmp** (e.g., \`/tmp/verify-<name>.ts\`, \`/tmp/verify-<name>.py\`)
2. **Run the script** and capture output
3. **Delete the script after** - always clean up with \`rm /tmp/verify-*.{ts,py,js,sh}\`
4. **Report findings** based on script output

Example workflow:
\`\`\`bash
# Write a verification script
cat > /tmp/verify-parser.ts << 'EOF'
import { parseConfig } from './src/config';
const result = parseConfig('test=value');
console.log(JSON.stringify(result));
EOF

# Run it
bun /tmp/verify-parser.ts

# Clean up
rm /tmp/verify-parser.ts
\`\`\`

Be thorough but focused. Generate questions that could actually reveal errors, not trivial checks.
Prefer running actual verification commands over reasoning about code when possible.`;

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
