## Your Task

Full driver–navigator–reviewer lifecycle: collaborate with the Navigator, implement the plan, then have the Reviewer review the completed work. Same as `PLAN.md` (plan + align with Navigator) plus execution, plus a final Reviewer pass. The Navigator has **read-only tools** (`Read`, `Grep`, `Glob`, `LS`, `git status/log/diff`) but cannot edit or run mutating commands — it advises, you implement. The Reviewer reviews after implementation is complete. You still provide curated context via `veda sel add`.

**Always pass `-m` (model) explicitly.** The `fable` alias auto-selects the droid backend with `claude-fable-5`. Use `-b <backend> -m <model>` for explicit control.

Use `-p navigator-plan` to start, then switch to `-p navigator-chat` for follow-up discussion. Only use `navigator-plan` once per task unless the user instructs otherwise.

**Involve the user when the work genuinely requires them.** Use your `ask_user` tool (or plain questions if unavailable) when the goal is ambiguous, a decision would change scope, cost, or direction, or input only the user can provide. Navigator advises; the user decides. Otherwise, when you have enough information to act, act.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda -p navigator-plan "The function uses `console.log`"
# Results in: sh: console.log: command not found

# GOOD - use single quotes (simplest):
veda -S impl-auth-feature -m fable -p navigator-plan 'The function uses `console.log` to output.'

# GOOD - escape backticks in double quotes:
veda -p navigator-plan "The function uses \`console.log\`"
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes.

## Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S` to isolate your selection from other concurrent agents. Format: `impl-TASKNAME` for the plan/implement phase, `review-TASKNAME` for the Reviewer pass.

```bash
veda -S impl-auth-refactor -m fable ...    # Plan + implement
veda -S review-auth-refactor -m fable ...  # Reviewer pass
```

---

## Setting Context (Critical)

**You must run `veda sel add` before sending prompts.** This is how Navigator/Reviewer see your working materials: source code, drafts, notes, specs, data, research documents, transcripts. Any text file works.

```bash
# Clear and build selection (use your session name)
veda -S impl-auth-refactor sel clear
veda -S impl-auth-refactor sel add "src/feature/" "docs/notes.md"

# Check token count
veda -S impl-auth-refactor sel ls
```

**Token budget (one rule):** Always start with full files. Check `sel ls`. 75k-125k tokens is acceptable. Only use slices if you exceed 125k, and pare down starting with the largest files. More context is better, so prefer full files when possible.

**What to share:** whatever the problem touches, plus its immediate neighbors. Navigator cannot see your terminal or environment, so put observations in the prompt itself: error output, a causal timeline, data you collected, drafts under discussion. State your hypothesis if you have one; if you are stuck, say where.

### File Slices (Line Ranges)

Only when over the 125k budget:

```bash
veda -S impl-auth-refactor sel add main.c:10-50       # Lines 10-50 only
veda -S impl-auth-refactor sel add main.c:100-        # Line 100 to end of file
veda -S impl-auth-refactor sel add config.ts:25       # Single line 25
veda -S impl-auth-refactor sel add "src/*.c:1-80"     # First 80 lines of each file
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |
| `"src/*.c:1-50"` | First 50 lines of each matched file |

---

## Collaborating with Navigator

Think of Navigator as a senior collaborator you're pairing with. Your opening message should commit to a position, not ask an open-ended question:

- Share the user's prompt verbatim, plus who the work is for and what the output enables, so Navigator understands the actual ask rather than your interpretation
- State the goal and your proposed approach (take a stance; Navigator stress-tests it)
- Provide evidence anchors: file and section references for your key claims
- Name constraints and non-goals
- Ask 1-2 specific questions where you are genuinely uncertain
- Invite Navigator to help in any way, especially if you're stuck; a fresh perspective on a dead end is often the breakthrough

Example flow:
```bash
# 1. Set the context
veda -S impl-auth-refactor sel clear
veda -S impl-auth-refactor sel add "src/auth/" "src/api/users.ts"

# 2. Start planning conversation - commit to a position
veda -S impl-auth-refactor -m fable -p navigator-plan 'Goal: [what done looks like, and for whom]. My understanding: [situation + evidence]. Proposed approach: [details]. Non-goals: [scope limits]. Key question: [your real uncertainty]. What do you think?'

# 3. Continue discussion (session-scoped resume)
veda -S impl-auth-refactor -m fable resume "What about edge case X?"
# Or switch to chat mode for back-and-forth
veda -S impl-auth-refactor -m fable -p navigator-chat "What about edge case X?"
```

Confirm alignment before you start executing. **Once aligned, you (the Driver) proceed to implementation.** Navigator does not execute; you do.

---

## Execution

After aligning with Navigator:
- Carry out the plan using your native tools; keep it scoped to what was agreed
- Validate as you go (check files, search for issues)
- Checkpoint with Navigator at plan-step boundaries, reporting only what you can point to evidence for: "step N done, verified by X"
- When results contradict expectations, paste the actual output verbatim and ask "repair or switch?"
- Two similar failures = mandatory Navigator consult before a third attempt
- Escalate to the user (via `ask_user`) per the rule above: scope, cost, or direction changes, or input only they can provide
- You can consult Navigator mid-execution:
  ```bash
  veda -S impl-auth-refactor -m fable -p navigator-chat "Quick question: should X handle Y this way?"
  ```

---

## Final Review with Reviewer

After implementation is complete, update selection to include changed files and diff, then call Reviewer on a separate `review-TASKNAME` session:

```bash
# Save diff
git diff > /tmp/changes.diff

# Build selection with diff and key files
veda -S review-auth-refactor sel clear
veda -S review-auth-refactor sel add /tmp/changes.diff
veda -S review-auth-refactor sel add src/changed_file.c src/related.c

# Verify diff is in selection before sending
veda -S review-auth-refactor sel ls

# Request review
veda -S review-auth-refactor -m fable -p reviewer "Implementation complete. Summary: [brief summary]. Please review."
```

Loop (Review → Fix → Review) until the Reviewer confirms no remaining issues:
```bash
# After fixing issues, regenerate diff
git diff > /tmp/changes.diff
veda -S review-auth-refactor sel rm /tmp/changes.diff
veda -S review-auth-refactor sel add /tmp/changes.diff
veda -S review-auth-refactor sel ls  # Verify diff is included
veda -S review-auth-refactor -m fable resume "Fixed the P1 issues. Please re-review."
```

---

Before ending your turn, check your last paragraph. If it is a plan, a list of next steps, or a promise about work you have not done ("I'll...", "let me know when..."), do that work now. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you write your final summary, write it for a reader who did not see any of the working thread. Lead with the outcome in one sentence, then the supporting detail. Drop the working shorthand: write complete sentences, spell out terms, and don't use arrow chains or labels you made up earlier. If you have to choose between short and clear, choose clear.

## Reminders

Onboard yourself with veda at `~/.jdc/agent/old-docs/veda.md` before acting.
Key commands:
- `veda -S impl-TASKNAME sel add` to build context (quote globs: `"src/*.c"`)
- `veda -S impl-TASKNAME sel add file.c:10-50` to add line-range slices
- `veda -S impl-TASKNAME sel ls` to verify selection and token count
- `veda -S impl-TASKNAME -m fable -p navigator-plan` for initial planning (high reasoning)
- `veda -S impl-TASKNAME -m fable -p navigator-chat` for follow-up discussion (medium reasoning)
- `veda -S review-TASKNAME -m fable -p reviewer` for code review (medium reasoning)
- `veda -S impl-TASKNAME -m fable resume` to continue a conversation (session-scoped)
- Output goes to stdout; use `-o file.md` to save response
