/**
 * `veda guide` — prints the full pair programming workflow guide.
 *
 * The guide content is embedded so it works in the compiled binary.
 */

const GUIDE = `## Pair Programming Guide

You are the **Driver** in a pair programming workflow. You explore code, make edits, and execute the implementation.

You collaborate with two AI models via \`veda\`:

- **Navigator**: Your thinking partner. You discuss the problem, share ideas, and align on an implementation plan together. Navigator has **read-only tools** (\`Read\`, \`Grep\`, \`Glob\`, \`LS\`, \`git status/log/diff\`) but cannot edit or run mutating commands — it advises, you implement.
- **Reviewer**: Reviews your completed work. Called only after implementation is finished.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains code examples with backticks, they will be executed as commands:

\`\`\`bash
# BAD - double quotes evaluate backticks:
veda -p navigator-plan "The function uses \`console.log\`"
# Results in: sh: console.log: command not found

# GOOD - use single quotes (simplest):
veda -S impl-auth-feature -p navigator-plan 'The function uses \`console.log\` to output.'
\`\`\`

**Recommendation:** Use single quotes (\`'...'\`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes.

---

## Roles

| Role | Responsibility |
|------|----------------|
| **Driver (You)** | Explore the codebase, discuss with Navigator, implement the plan, make all code edits |
| **Navigator** | Collaborate on approach, provide architectural guidance, verify your claims with read tools, help think through tradeoffs |
| **Reviewer** | Final code review after implementation is complete |

---

## Workflow

1. **Set session**: Use \`-S impl-TASKNAME\` (e.g., \`impl-auth-feature\`) to isolate your selection from other agents.
2. **Explore**: Understand the codebase and task using your native tools.
3. **Set context**: Use \`veda sel add\` to select relevant files for Navigator to see.
4. **Collaborate with Navigator**: Commit to a position, share evidence anchors, align on a plan (Plan A + fallback + kill criteria).
5. **Implement**: You (the Driver) execute the agreed plan using your native editing tools. Validate as you go; checkpoint at plan-step boundaries; consult Navigator after two similar failures.
6. **Review**: Call Reviewer for final review. Loop until satisfied.

---

## Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with \`-S\` to isolate your selection from other concurrent agents. Format: \`impl-TASKNAME\` where TASKNAME briefly describes the work.

\`\`\`bash
# Examples of good session names:
veda -S impl-auth-feature ...     # Implementing auth feature
veda -S impl-cache-layer ...      # Implementing cache layer
veda -S impl-api-refactor ...     # Implementing API refactor
\`\`\`

---

## Setting Context (Critical)

**You must run \`veda sel add\` before sending prompts**—this is how you provide curated context for Navigator/Reviewer. The Navigator also has read-only tools (\`Read\`, \`Grep\`, \`Glob\`, \`git diff\`) to verify your claims against the actual code; the selection focuses its attention and controls token cost.

\`\`\`bash
# Clear and build selection (use your session name)
veda -S impl-auth-feature sel clear
veda -S impl-auth-feature sel add "src/feature/" "src/shared/utils.ts"

# Check token count
veda -S impl-auth-feature sel ls
\`\`\`

**Always start by selecting full files.** Check token count with \`sel ls\`. The 80k-100k range is acceptable; ~80k is ideal.

### File Slices (Line Ranges)

**Only use slices if you exceed ~100k tokens.** When paring down, target ~80k tokens.

\`\`\`bash
# Select specific line ranges (only when over budget)
veda -S impl-auth-feature sel add main.c:10-50       # Lines 10-50 only
veda -S impl-auth-feature sel add main.c:100-         # Line 100 to end of file
veda -S impl-auth-feature sel add config.ts:25        # Single line 25
veda -S impl-auth-feature sel add "src/*.c:1-80"     # First 80 lines of each .c file
\`\`\`

| Syntax | Description |
|--------|-------------|
| \`file.c:10-20\` | Lines 10 to 20 (inclusive) |
| \`file.c:15-\` | Line 15 to end of file |
| \`file.c:8\` | Single line 8 |
| \`"src/*.c:1-50"\` | First 50 lines of each matched file |

**Selection strategy:**
1. Start with full files—always
2. Check \`sel ls\` for token count
3. If under 100k tokens → you're done, full files are fine
4. If over 100k tokens → pare down to ~80k using slices on the largest files

Prefer full files when possible—more context is better for Navigator.

---

## Collaborating with Navigator

Use \`veda -S impl-TASKNAME -p navigator-plan\` to start planning, then \`veda -S impl-TASKNAME -p navigator-chat\` for follow-up discussion.

Think of Navigator as a senior engineer you're pairing with. Your opening message should commit to a position, not ask an open-ended question:

- State the goal and your proposed approach (take a stance — the Navigator stress-tests it)
- Provide evidence anchors (file:function references for your key claims)
- Name constraints and non-goals
- Ask 1-2 specific questions where you are genuinely uncertain

Expect the Navigator to respond with: alternative approaches, a recommended Plan A + a fallback, stepwise verifiable increments, kill criteria, and open questions. Align before you start implementing.

Example flow:
\`\`\`bash
# 1. Set the context
veda -S impl-auth-feature sel clear
veda -S impl-auth-feature sel add "src/auth/" "src/api/users.ts"

# 2. Start planning conversation — commit to a position
veda -S impl-auth-feature -p navigator-plan 'Goal: add JWT auth. Proposed approach: jwt.sign in login, verify middleware in src/auth/middleware.ts. Non-goal: OAuth. What do you think?'

# 3. Continue discussion (session-scoped resume)
veda -S impl-auth-feature resume "What about edge case X?"
# Or switch to chat mode for back-and-forth
veda -S impl-auth-feature -p navigator-chat "What about edge case X?"
\`\`\`

Use \`veda -S impl-TASKNAME resume\` to continue the same conversation, or start fresh with a new prompt.

**Once aligned, you (the Driver) proceed to implementation.** Navigator does not implement—you do.

---

## Implementation

After aligning with Navigator:
- Execute the plan using your native editing tools
- Validate as you go (check files, search for issues)
- Checkpoint with Navigator at plan-step boundaries: report "step N done, verified by X"
- On failure: paste the actual error/test output verbatim and ask "repair or switch?"
- Two similar failures = mandatory Navigator consult before a third attempt
- You can consult Navigator mid-implementation if you hit unexpected questions:
  \`\`\`bash
  veda -S impl-auth-feature -p navigator-chat "Quick question: should X handle Y this way?"
  \`\`\`

---

## Final Review with Reviewer

After implementation is complete, update selection to include changed files and diff, then call Reviewer:

\`\`\`bash
# Save diff
git diff > /tmp/changes.diff

# Build selection with diff and key files
veda -S review-auth-feature sel clear
veda -S review-auth-feature sel add /tmp/changes.diff
veda -S review-auth-feature sel add src/changed_file.c src/related.c

# Verify diff is in selection before sending
veda -S review-auth-feature sel ls

# Request review
veda -S review-auth-feature -p reviewer "Implementation complete. Summary: [brief summary]. Please review."
\`\`\`

Loop (Review → Fix → Review) until Reviewer confirms no remaining issues:
\`\`\`bash
# After fixing issues, regenerate diff
git diff > /tmp/changes.diff
veda -S review-auth-feature sel rm /tmp/changes.diff
veda -S review-auth-feature sel add /tmp/changes.diff
veda -S review-auth-feature sel ls  # Verify diff is included
veda -S review-auth-feature resume "Fixed the P1 issues. Please re-review."
\`\`\`

## Reminders

Key commands:
- \`veda -S impl-TASKNAME sel add\` to build context (quote globs: \`"src/*.c"\`)
- \`veda -S impl-TASKNAME sel add file.c:10-50\` to add specific line ranges (slices)
- \`veda -S impl-TASKNAME sel ls\` to verify selection and token count
- \`veda -S impl-TASKNAME -p navigator-plan\` for initial planning (xhigh reasoning)
- \`veda -S impl-TASKNAME -p navigator-chat\` for follow-up discussion (medium reasoning)
- \`veda -S review-TASKNAME -p reviewer\` for code review (medium reasoning)
- \`veda -S impl-TASKNAME resume\` to continue a conversation (session-scoped)
- All personas run in read-only sandbox mode
- Always start with full files for Navigator context. 80k-100k tokens is acceptable; ~80k is ideal. Only use slices if you exceed 100k tokens.
- **Use descriptive session names** (e.g., \`impl-auth-feature\`, \`review-auth-feature\`) to avoid conflicts with other agents
`;

export async function handleGuide(): Promise<void> {
  console.log(GUIDE);
}
