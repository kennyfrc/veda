---
name: veda-deep-plan
description: >
  Plan the hardest problems with Veda Deep Thinking — parallel solvers, a judge, and a
  verifier converge on the best plan. Use when a single planning call is not enough:
  architectural design, subtle bugs with no obvious cause, decisions with no clear
  answer. Drives `veda -S deep-TASKNAME -m {{model}} deep "..."`; does not execute.
  Invoke when the user says deep plan, hard problem, multiple approaches, converge, or
  wants several independent attempts before committing.
argument-hint: "[veda-flags]"
---

## Your Task

Plan the hardest problems using Veda's Deep Thinking mode: `veda -S deep-TASKNAME -m {{model}} deep "..."`. This is for problems where a single planning call is not enough — you want several independent attempts that converge on the right answer.

Deep mode runs **k parallel solvers** (default 6), each using a different reasoning strategy. A **judge** picks the best answer. A **verifier** kicks in when confidence is low. This is a homegrown Deepthink, inspired by Self-Consistency, Universal Self-Consistency, and Chain-of-Verification.

**When to use this:** a single planning call is the cheaper default. Reach for Deep Thinking only when the problem is genuinely hard — architectural design with many tradeoffs, subtle bugs where the cause is opaque, or decisions where you want independent perspectives before committing. Deep mode costs k× more tokens than a single call; reserve it for when that cost earns its keep.

**Model:** `{{model}}` is auto-detected by `veda init` from your installed harnesses. If a `-m`/`-b` (or other veda flags) was passed when this skill was invoked, use those instead of `-m {{model}}` in every `veda` command below.

**Reuse the same `-S` session name** across deep runs and follow-up `resume`/`navigator-chat` so the conversation continues rather than restarting.

**Involve the user when the work genuinely requires them.** Use your `ask_user` tool (or plain questions if unavailable) when the goal is ambiguous, a decision would change scope, cost, or direction, or input only the user can provide. The judge picks the best plan; the user decides whether to act on it. Otherwise, when you have enough information to act, act.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda deep "The function uses `console.log`"
# Results in: sh: console.log: command not found

# GOOD - use single quotes (simplest):
veda -S deep-auth-refactor -m {{model}} deep 'The function uses `console.log` to output.'

# GOOD - escape backticks in double quotes:
veda deep "The function uses \`console.log\`"
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes.

## Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S` to isolate your selection from other concurrent agents. Format: `deep-TASKNAME` where TASKNAME briefly describes the work.

```bash
veda -S deep-auth-refactor -m {{model}} deep ...    # Planning a hard refactor
veda -S deep-race-bug -m {{model}} deep ...          # Debugging a subtle race condition
veda -S deep-sync-arch -m {{model}} deep ...         # Designing a real-time sync architecture
```

---

## Setting Context (Critical)

**You must run `veda sel add` before sending prompts.** The solvers and judge see only what you share — source code, specs, error logs, data, research documents. Any text file works.

```bash
# Clear and build selection (use your session name)
veda -S deep-auth-refactor sel clear
veda -S deep-auth-refactor sel add "src/feature/" "docs/notes.md"

# Check token count
veda -S deep-auth-refactor sel ls
```

**Token budget (one rule):** Always start with full files. Check `sel ls`. 75k-125k tokens is acceptable. Only use slices if you exceed 125k, and pare down starting with the largest files. More context is better, so prefer full files when possible.

**What to share:** whatever the problem touches, plus its immediate neighbors. The solvers cannot see your terminal or environment, so put observations in the prompt itself: error output, a causal timeline, data you collected, constraints you discovered. State your hypothesis if you have one; if you are stuck, say where.

### File Slices (Line Ranges)

Only when over the 125k budget:

```bash
veda -S deep-auth-refactor sel add main.c:10-50       # Lines 10-50 only
veda -S deep-auth-refactor sel add main.c:100-        # Line 100 to end of file
veda -S deep-auth-refactor sel add config.ts:25       # Single line 25
veda -S deep-auth-refactor sel add "src/*.c:1-80"     # First 80 lines of each file
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |
| `"src/*.c:1-50"` | First 50 lines of each matched file |

---

## Running Deep Mode

Deep mode runs k solvers in parallel, a judge picks the best, and a verifier checks the result. Your opening message should commit to a position, not ask an open-ended question:

- Share the user's prompt verbatim, plus who the work is for and what the output enables
- State the goal and your proposed approach (take a stance; the solvers stress-test it)
- Provide evidence anchors: file and section references for your key claims
- Name constraints and non-goals
- Ask 1-2 specific questions where you are genuinely uncertain

Example flow:
```bash
# 1. Set the context
veda -S deep-sync-arch sel clear
veda -S deep-sync-arch sel add "src/sync/" "docs/architecture.md"

# 2. Run deep thinking (default: 6 solvers + judge + verifier)
veda -S deep-sync-arch -m {{model}} deep 'Goal: design a real-time sync layer that handles offline edits and conflict resolution. My understanding: [situation + evidence]. Proposed approach: CRDT for text fields, last-write-wins for metadata, tombstones for deletes. Non-goals: real-time presence, binary diff. Key question: is CRDT overkill for our edit rate? What do you think?'

# 3. Tune the solver count for the problem's difficulty
veda -S deep-sync-arch -m {{model}} deep -k 4 '...'     # Fewer solvers (faster, cheaper)
veda -S deep-sync-arch -m {{model}} deep -k 8 '...'     # More solvers (harder problems)

# 4. Skip verification when you just want quick alternatives
veda -S deep-sync-arch -m {{model}} deep --no-verify '...'

# 5. Save the trace for debugging or replay
veda -S deep-sync-arch -m {{model}} deep --trace /tmp/deep-sync-trace.yaml '...'

# 6. Continue discussion on the same session (single model, cheaper)
veda -S deep-sync-arch -m {{model}} -p navigator-chat "The judge picked approach B. What about edge case X?"
```

**Per-stage model overrides** let you mix providers — e.g., cheap solvers and an expensive judge:

```bash
# Solvers on K3, judge on Sol, verifier on Opus
veda -S deep-sync-arch --solver-model k3 --judge-model sol --verifier-model opus deep '...'

# Distribute solvers across backends (round-robin)
veda -S deep-sync-arch --distribute-solvers deep '...'

# One solver per model (mixed providers, same prompt each)
veda -S deep-sync-arch --solver-models sol,k3,fable deep '...'
```

**Backend/Model Precedence:** The `-b` and `-m` flags apply to **all stages** (solver, judge, verifier, revision) unless overridden by per-stage flags (`--solver-model`, `--judge-model`, `--verifier-model`, `--revision-model`).

### Reading the output

Deep mode prints each solver's candidate, then the judge's selection, then (if verification ran) the verifier's verdict. The **judge's selected answer** is your plan. If the verifier flagged the result, read its objections before acting — they are the "second opinion" that earns the token cost.

Confirm alignment before you start executing. **Once aligned, you (the Driver) proceed to execution.** The solvers, judge, and verifier do not execute; you do.

---

## Execution

After deep mode converges on a plan:
- Carry out the plan using your native tools; keep it scoped to what was agreed
- For follow-up questions mid-execution, use a **single** `navigator-chat` call (cheaper than re-running deep mode):
  ```bash
  veda -S deep-sync-arch -m {{model}} -p navigator-chat "Quick question: should X handle Y this way?"
  ```
- Re-run deep mode only if a mid-execution surprise genuinely changes the approach (not for routine questions)
- Escalate to the user (via `ask_user`) per the rule above: scope, cost, or direction changes, or input only they can provide

Before ending your turn, check your last paragraph. If it is a plan, a list of next steps, or a promise about work you have not done ("I'll...", "let me know when..."), do that work now. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you write your final summary, write it for a reader who did not see any of the working thread. Lead with the outcome in one sentence, then the supporting detail. Drop the working shorthand: write complete sentences, spell out terms, and don't use arrow chains or labels you made up earlier. If you have to choose between short and clear, choose clear.

## Reminders

Onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `veda -S deep-TASKNAME sel add` to build context (quote globs: `"src/*.c"`)
- `veda -S deep-TASKNAME sel add file.c:10-50` to add line-range slices
- `veda -S deep-TASKNAME sel ls` to verify selection and token count
- `veda -S deep-TASKNAME -m {{model}} deep "..."` for deep thinking (k=6 solvers + judge + verify)
- `veda -S deep-TASKNAME -m {{model}} deep -k <N> "..."` to set solver count (1-12)
- `veda -S deep-TASKNAME -m {{model}} deep --no-verify "..."` to skip verification
- `veda -S deep-TASKNAME -m {{model}} deep --trace /tmp/trace.yaml "..."` to save a trace
- `veda -S deep-TASKNAME -m {{model}} -p navigator-chat "..."` for follow-up discussion (cheaper than re-running deep)
- `veda -S deep-TASKNAME -m {{model}} resume` to continue a conversation (session-scoped)
- `veda -S deep-TASKNAME -m {{model}} deep --json "..."` for JSON output (pipe to `jq`)
- Per-stage overrides: `--solver-model`, `--judge-model`, `--verifier-model`, `--revision-model`
- Output goes to stdout; use `-o file.md` to save response

Do not execute yet; all we want to do is converge on a solid plan.
