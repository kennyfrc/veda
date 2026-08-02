---
name: veda-worker-verify
description: Run a mandatory final verify-fix loop with the Veda Verifier model after implementation is complete. Drives `veda -S review-TASKNAME -m {{model}} -p verifier`, looping Verify, Fix, Verify until the Verifier's verdict is PASS. Only fix [P0]/[P1] high-confidence issues; skip P2/P3. Not for mid-implementation use. Invoke when the user says review, verify, final review, or wants completed code checked.
argument-hint: "[veda-flags]"
---

## Your Task: Verify-Fix Loop with the Verifier after Implementation

You must always perform at least one final verification with the Verifier model via `veda -S review-TASKNAME -m {{model}} -p verifier` after all implementation work is complete.
That final verification must run recursively in a Verify → Fix → Verify loop until the Verifier's `<verifier_report>` verdict is `PASS`.
You must not use the Verifier mid-implementation; the Verifier is for the final verification phase only.

During implementation, keep the work on track via mid-implementation validation such as build/compilation/test-style checks (using the tools you have), not via the Verifier.

**Reuse the same `-S` session name** across the verify loop (Verify, Fix, Verify) so each `resume` continues the prior verification rather than starting fresh.

**Involve the user when the work genuinely requires them.** Use your `ask_user` tool (or plain questions if unavailable) when the goal is ambiguous, a decision would change scope, cost, or direction, or input only the user can provide. You navigate; the user decides. Otherwise, when you have enough information to act, act.

You are the driver and the orchestrator for this verify leg: you plan and scope the work yourself and run the verifier against the result. If the plan itself needs a second opinion, handle that separately with your own planning — it is not this skill's job.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.**

```bash
# BAD - double quotes evaluate backticks:
veda -p verifier "Check if `getData()` handles errors"
# Results in: sh: getData(): command not found

# GOOD - use single quotes (simplest):
veda -S review-data-handler -m {{model}} -p verifier 'Check if `getData()` handles errors correctly.'

# GOOD - escape backticks in double quotes:
veda -p verifier "Check if \`getData()\` handles errors"
```

### Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S` to isolate your selection from other concurrent agents. Format: `review-TASKNAME` where TASKNAME briefly describes the work being verified.

```bash
veda -S review-auth-refactor ...    # Verifying auth refactoring
veda -S review-cache-impl ...       # Verifying cache implementation
veda -S review-api-fix ...          # Verifying API bug fix
```

### Verifier Model notes

* Receives final verification requests via `veda -S review-TASKNAME -m {{model}} -p verifier`.
* Runs with `read,bash,grep,glob` on by default — it runs the build and the tests itself; its job is to try to break the implementation, not confirm it.
* Lists every affordance the change alters and tests each on the real surface (cdp for web UI, xtui/tmux for CLI/TUI, curl for APIs). A listed-but-untested affordance is not verified.
* Verifies the completed implementation against its contract (design.json auto-attached when present), flags issues with priority tags [P0]-[P3], and ends with a machine-parseable `<verifier_report>` whose `verdict` is `PASS | FAIL | PARTIAL`. Read `affordances` and `probes` too.
* Must be used at least once at the end of implementation for a final, holistic verification.
* May be called multiple times during the final verification phase (Verify → Fix → Verify loop) but must not be used mid-implementation.

### Verify-Fix Loop with Verifier (Mandatory)

After implementation is complete and mid-implementation validation is done, run a recursive final verification loop with the Verifier.
There must be at least one final verification request, and you must loop until the verdict is `PASS`.

**1. Capture the diff (exclude binaries):**

```bash
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff
# Or scope to specific paths: git diff -- path/to/src/ > /tmp/changes.diff
```

**2. Build selection and verify it:**

```bash
veda -S my-review sel clear
veda -S my-review sel add /tmp/changes.diff
veda -S my-review sel add src/changed_file.c src/related.c include/header.h
veda -S my-review sel ls   # CRITICAL: confirm the diff is in selection before sending
```

**The verifier cannot check your changes without the diff file.** Before every request: confirm `/tmp/changes.diff` is non-empty (`wc -l`) and appears in `veda -S my-review sel ls`.

**3. Send the verification request:**

```bash
veda -S my-review -m {{model}} -p verifier "Final Verification Request: Implementation for this task is complete.
Key files and the diff are selected. Verify correctness against the design (auto-attached when present): you have read+bash — run the build and tests yourself. List every affordance this change alters and test each on the real surface (cdp / xtui·tmux / curl). Report only P0/P1 issues. End with <verifier_report>; verdict PASS only if every check passed and every affordance is verified."
```

**4. Handle the response:**

* **Only fix [P0] and [P1] issues** — ignore [P2]/[P3] (nice-to-haves can introduce new bugs)
* **Only fix high-confidence findings** — if the verifier hedges ("might", "could potentially", "consider"), skip it
* **Exit when:** verdict is `PASS`, OR no [P0]/[P1] remain

**5. If issues found, loop:**

* Fix only the [P0]/[P1] high-confidence issues
* Regenerate and re-add the diff (verifier cannot see your fixes without it)
* Request re-verification

```bash
# After fixing, regenerate diff
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff

# Update selection
veda -S my-review sel rm /tmp/changes.diff
veda -S my-review sel add /tmp/changes.diff
veda -S my-review sel ls   # verify again

# Re-request
veda -S my-review -m {{model}} -p verifier "Final Verification Follow-up: I have addressed your feedback:
[briefly describe what you fixed]
Please re-verify and report VERDICT."
```

**Important:** Always regenerate and re-add the diff before each re-verification. **Always verify with `sel ls` before sending.**

### What NOT to fix

* Verifier's opinion on architecture you intentionally chose
* Style/formatting nits unless they violate documented standards
* Adding validation not in original requirements
* Speculative robustness ("what if X is negative/null/empty?") for inputs that are always valid in context
* try/catch, error handling, or fallbacks not requested
* Pre-existing problems the patch did not introduce

### Success Criteria

* Verifier's `<verifier_report>` verdict is `PASS`
* No remaining [P0]/[P1] issues (ignore P2/P3)

---

## Reminders

Onboard yourself with veda at `~/.jdc/agent/old-docs/veda.md` before acting.

Key commands:
- `git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff` to capture changes **(exclude binaries, regenerate before EVERY re-verify)**
- `veda -S my-review sel rm /tmp/changes.diff && veda -S my-review sel add /tmp/changes.diff` to refresh the diff
- `veda -S my-review sel clear` then `veda -S my-review sel add` to build context
- `veda -S my-review sel ls` to verify selection and token count
- `veda -S my-review -m {{model}} -p verifier` for verification requests (medium reasoning, read+bash on)
- `veda -S my-review -m {{model}} resume` to continue the verification conversation (session-scoped)
- Look for the `<verifier_report>` `verdict`: `PASS | FAIL | PARTIAL`
- **Only fix [P0]/[P1]** — skip P2/P3 and low-confidence suggestions

Before every request, verify:
1. ✅ Diff file exists and is non-empty: `wc -l /tmp/changes.diff`
2. ✅ Diff is in selection: `veda -S my-review sel ls` shows `/tmp/changes.diff`

**If the verifier reports "no diff/context available" or gives low confidence due to missing context, the diff was not properly included. Re-add it and retry.**
