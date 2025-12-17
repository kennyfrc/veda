## Your Task: Review-Fix Loop with Reviewer Process after Implementation

You must always perform at least one final review with the Reviewer model via `veda -S $VEDA_SESSION -p reviewer` after all implementation work is complete.  
That final review must run recursively in a Review → Fix → Review loop until Reviewer is satisfied that no further changes are needed.  
You must not use Reviewer mid-implementation; Reviewer is for the final review phase only.

During implementation, you should keep the work on track via mid-implementation validation such as build/compilation/test-style checks (using the tools you have), not via Reviewer.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains code examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda -p reviewer "Check if `getData()` handles errors"
# Results in: sh: getData(): command not found

# GOOD - use single quotes (simplest):
veda -S $VEDA_SESSION -p reviewer 'Check if `getData()` handles errors correctly.'

# GOOD - escape backticks in double quotes:
veda -p reviewer "Check if \`getData()\` handles errors"
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes.

### Session Isolation (Critical for Multi-Agent)

**Always use `-S $VEDA_SESSION`** (or set `VEDA_SESSION` env var) to isolate your selection from other concurrent agents. Each agent should have a unique session ID.

```bash
# Set session ID (stable per shell, unique per terminal)
export VEDA_SESSION="${VEDA_SESSION:-agent-$$}"
# Or pass explicitly: veda -S my-session ...
```

### Reviewer Model notes

* Receives final review requests via `veda -S $VEDA_SESSION -p reviewer`.
* Reviews with diffs included in selection (save diff to file, add to selection).
* Reviews the completed implementation, flags issues with priority tags [P0]-[P3], and provides an overall verdict.
* Must be used at least once at the end of implementation for a final, holistic review.
* May be called multiple times during the final review phase (Review → Fix → Review loop) but must not be used mid-implementation.
* Does not perform edits.

### Review-Fix Loop with Reviewer (Mandatory)

After implementation is complete and mid-implementation validation is done, you must run a recursive final review loop with Reviewer.
There must be at least one final review request, and you must loop until Reviewer is satisfied.

1. Final review request

Call Reviewer to initiate final review of the completed implementation:

* Save the diff (excluding binaries): `git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.gif' ':(exclude)*.ico' ':(exclude)*.woff' ':(exclude)*.woff2' ':(exclude)*.ttf' ':(exclude)*.eot' ':(exclude)*.mp4' ':(exclude)*.webm' ':(exclude)*.pdf' ':(exclude)*.zip' ':(exclude)*.tar' ':(exclude)*.gz' > /tmp/changes.diff`
  * Or scope to specific paths: `git diff -- path/to/src/ > /tmp/changes.diff`
* Build selection with diff + relevant source files via `veda -S $VEDA_SESSION sel add`
* Send review request via `veda -S $VEDA_SESSION -p reviewer`

Example final review request:

```bash
# Save diff (exclude binary files to avoid token explosion)
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff
# Or scope to changed source files only:
# git diff -- src/ lib/ > /tmp/changes.diff

# Build selection with diff and key files
veda -S $VEDA_SESSION sel clear
veda -S $VEDA_SESSION sel add /tmp/changes.diff
veda -S $VEDA_SESSION sel add src/changed_file.c src/related.c include/header.h

# Use file slices if files are large (focus on relevant sections)
veda -S $VEDA_SESSION sel add large_file.c:100-200  # Only the changed function

# Check token count
veda -S $VEDA_SESSION sel ls

# Request review
veda -S $VEDA_SESSION -p reviewer "Final Review Request: Implementation for this task is complete.
Overall summary of changes:
- Added X feature
- Modified Y to handle Z
- Updated config for W

Key files are selected. Please perform a holistic review checking for correctness, integration issues, regressions, and adherence to codebase patterns."
```

2. Review → Fix → Review loop

**Goal:** Fix what's broken, nothing more. Resist suggestions that add complexity without solving real problems.

Enter a loop with these **gates**:

* **Only fix [P0] and [P1] issues** — ignore [P2]/[P3] (nice-to-haves can introduce new bugs)
* **Only fix high-confidence findings** — if Reviewer hedges ("might", "could potentially", "consider"), skip it
* **Exit when:** verdict is "patch is correct", OR no [P0]/[P1] remain

For each iteration:
  * Fix only the [P0]/[P1] high-confidence issues
  * Regenerate diff and re-add to selection
  * Request re-review

Example follow-up final review:

```bash
# CRITICAL: Always regenerate diff after fixes (exclude binaries)
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff

# Re-add diff to selection (file content changed, must re-add)
veda -S $VEDA_SESSION sel rm /tmp/changes.diff
veda -S $VEDA_SESSION sel add /tmp/changes.diff

# Request re-review with updated diff
veda -S $VEDA_SESSION -p reviewer "Final Review Follow-up: I have addressed your feedback:
- Fixed X (P1 issue)
- Added handling for Y
- Updated Z as suggested

Please re-review and confirm whether any issues remain or if the implementation is now acceptable."
```

**Important:** Always regenerate and re-add the diff before each re-review. Reviewer cannot see your fixes without the updated diff.

**Exit conditions** (any of these):

* Reviewer's verdict is "patch is correct"
* No remaining [P0]/[P1] issues (ignore P2/P3)

**Do NOT fix:**
* [P2]/[P3] findings — these are nice-to-haves that often introduce new bugs
* Low-confidence suggestions — "might", "could potentially", "consider" = skip
* Style/formatting nits unless they violate documented standards

**Reject over-engineering suggestions (even if P1):**
* Adding validation not in original requirements — "what if X is negative/null/empty?"
* Adding type checks or null guards for inputs that are always valid in context
* Adding try/catch, error handling, or fallbacks not requested
* Adding parameters, methods, or features beyond task scope
* "More defensive" or "more robust" suggestions
* Contract changes that would break existing callers

**Sanity check before fixing any issue:**
1. Is this actually broken, or just "could be better"?
2. Would this fix change behavior for existing valid inputs?
3. Is this adding scope the user didn't ask for?

If the answer to #2 or #3 is yes → skip it.


## Reminders

Make sure to onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff` to capture changes **(exclude binaries, regenerate before EVERY re-review)**
- `veda -S $VEDA_SESSION sel rm /tmp/changes.diff && veda -S $VEDA_SESSION sel add /tmp/changes.diff` to refresh diff in selection
- `veda -S $VEDA_SESSION sel clear` then `veda -S $VEDA_SESSION sel add` to build context
- `veda -S $VEDA_SESSION sel add file.c:10-50` to add specific line ranges (slices)
- `veda -S $VEDA_SESSION sel ls` to verify selection and token count  
- `veda -S $VEDA_SESSION -p reviewer` for review requests (medium reasoning, read-only sandbox)
- `veda -S $VEDA_SESSION resume` to continue the review conversation (session-scoped)
- Look for verdict: "patch is correct" or "patch is incorrect"
- **Only fix [P0]/[P1]** — skip P2/P3 and low-confidence suggestions
- Output goes to stdout; use `-o file.md` to save response
- **Always use `-S $VEDA_SESSION`** to avoid conflicts with other agents

### File Slices for Reviews

Use file slices to focus on specific code sections during review. **Only use slices when you significantly exceed the token budget**—otherwise, prefer full files for better review context.

```bash
veda -S $VEDA_SESSION sel add src/auth.c:50-120   # Only the modified function
veda -S $VEDA_SESSION sel add "src/*.h:1-30"      # Headers (just declarations)
```

| Syntax | Description |
|--------|-------------|
| `file.c:10-20` | Lines 10 to 20 (inclusive) |
| `file.c:15-` | Line 15 to end of file |
| `file.c:8` | Single line 8 |

