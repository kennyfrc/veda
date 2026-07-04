## Your Task

Please collaborate, discuss, align with the Navigator model on the plan, using `veda -S plan-TASKNAME -p navigator-plan`. The Navigator has **read-only tools** (`Read`, `Grep`, `Glob`, `LS`, `git status/log/diff`) but cannot edit or run mutating commands — it advises, you implement. You still provide curated context through `veda sel add` to focus the Navigator's attention and control token cost; the Navigator can verify your claims against the actual code using its read tools. Always start with full files. The 80k-150k token range is acceptable. Only use slices if you exceed 150k tokens. Use `-p navigator-plan` to start, then switch to `-p navigator-chat` if you'd like to discuss further. Only use `navigator-plan` once or unless the user instructs you to do so.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains code examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda -p navigator-plan "The function uses `console.log`"
# Results in: sh: console.log: command not found

# GOOD - use single quotes (simplest):
veda -S plan-auth-refactor -p navigator-plan 'The function uses `console.log` to output.'

# GOOD - escape backticks in double quotes:
veda -p navigator-plan "The function uses \`console.log\`"
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes. 


## Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S` to isolate your selection from other concurrent agents. Format: `plan-TASKNAME` where TASKNAME briefly describes the work.

```bash
# Examples of good session names:
veda -S plan-auth-refactor ...    # Planning auth refactoring
veda -S plan-cache-layer ...      # Planning cache implementation
veda -S plan-api-redesign ...     # Planning API changes
```

---

## Setting Context (Critical)

**You must run `veda sel add` before sending prompts**—this is how you provide files for Navigator to see. They have no other way to access code.

```bash
# Clear and build selection (use your session name)
veda -S plan-auth-refactor sel clear
veda -S plan-auth-refactor sel add "src/feature/" "src/shared/utils.ts"

# Check token count
veda -S plan-auth-refactor sel ls
```

**Always start by selecting full files.** Check token count with `sel ls`. The 80k-150k range is acceptable.

### File Slices (Line Ranges)

**Only use slices if you exceed ~150k tokens.** When paring down, target ~120k tokens.

```bash
# Select specific line ranges (only when over budget)
veda -S plan-auth-refactor sel add main.c:10-50       # Lines 10-50 only
veda -S plan-auth-refactor sel add main.c:100-        # Line 100 to end of file
veda -S plan-auth-refactor sel add config.ts:25       # Single line 25
veda -S plan-auth-refactor sel add "src/*.c:1-80"     # First 80 lines of each .c file
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |
| `"src/*.c:1-50"` | First 50 lines of each matched file |

**Selection strategy:**
1. Start with full files—always
2. Check `sel ls` for token count
3. If under 150k tokens → you're done, full files are fine
4. If over 150k tokens → pare down to ~120k using slices on the largest files

Prefer full files when possible—more context is better for Navigator.

---

## Collaborating with Navigator

Use `veda -S plan-TASKNAME -p navigator-plan` to start planning, then `veda -S plan-TASKNAME -p navigator-chat` for follow-up discussion.

Think of Navigator as a senior engineer you're pairing with. Your opening message to the Navigator should commit to a position, not ask an open-ended question:

- State the goal and your proposed approach (take a stance — the Navigator stress-tests it)
- Provide evidence anchors (file:function references for your key claims)
- Name constraints and non-goals
- Ask 1-2 specific questions where you are genuinely uncertain

Expect the Navigator to respond with: alternative approaches, a recommended Plan A + a fallback, stepwise verifiable increments, kill criteria, and open questions. Align before you start implementing.

Example flow:
```bash
# 1. Set the context
veda -S plan-auth-refactor sel clear
veda -S plan-auth-refactor sel add "src/auth/" "src/api/users.ts"

# 2. Start planning conversation — commit to a position
veda -S plan-auth-refactor -p navigator-plan 'Goal: migrate session auth to JWT. Proposed approach: add jwt.sign in login handler, add verify middleware in src/auth/middleware.ts. Non-goal: OAuth. Key question: should we rotate keys per-env? What do you think?'

# 3. Continue discussion (session-scoped resume)
veda -S plan-auth-refactor resume "What about edge case X?"
# Or switch to chat mode for back-and-forth
veda -S plan-auth-refactor -p navigator-chat "What about edge case X?"
```

Use `veda -S plan-TASKNAME resume` to continue the same conversation, or start fresh with a new prompt.

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
  ```bash
  veda -S plan-auth-refactor -p navigator-chat "Quick question: should X handle Y this way?"
  ```

## Reminders

Make sure to onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `veda -S plan-TASKNAME sel add` to build context (quote globs: `"src/*.c"`)
- `veda -S plan-TASKNAME sel add file.c:10-50` to add specific line ranges (slices)
- `veda -S plan-TASKNAME sel ls` to verify selection and token count
- `veda -S plan-TASKNAME -p navigator-plan` for initial planning (xhigh reasoning)
- `veda -S plan-TASKNAME -p navigator-chat` for follow-up discussion (medium reasoning)
- `veda -S plan-TASKNAME resume` to continue a conversation (session-scoped)
- Output goes to stdout; use `-o file.md` to save response
- **Use a descriptive session name** (e.g., `plan-auth-refactor`) to avoid conflicts with other agents

Do not code yet, all we want to do is iterate on a solid plan.
