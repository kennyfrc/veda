---
name: veda-design-implement-review
description: Plan, design, implement, and review with Veda. Uses navigator-plan-design (a fused persona that produces the plan AND the structured XML program design in one call), then you implement against the design, then the reviewer checks the implementation against the design's signatures and invariants. Use when you want a full plan-design-implement-review cycle with a machine-checkable design handoff.
argument-hint: "[veda-flags]"
---

## Your Task

Run the full cycle: **plan+design → implement → review**. Three stages:

1. **Plan + Design** with `navigator-plan-design` — one call produces both the implementation plan (prose) and the structured program design (`<program>` XML block with types, signatures, call stacks, invariants). Veda parses, validates, and writes `design.xml` / `design.json` / `design.report` to the session directory.
2. **Implement** — you (the Driver) implement against the design using your native tools. The design's signatures, call stacks, and invariants are the contract.
3. **Review** with `reviewer` — the reviewer auto-attaches the session's `design.json` and checks the implementation against the design's signatures and invariants.

**Model:** `{{model}}` is auto-detected by `veda init` from your installed harnesses. If a `-m`/`-b` (or other veda flags) was passed when this skill was invoked, use those instead of `-m {{model}}` in every `veda` command below.

**Reuse the same `-S` session name** across all stages so the design artifacts land in the same session directory the reviewer reads.

### Escaping Backticks in Prompts (Critical)

Use single quotes (`'...'`) for prompts containing backticks:

```bash
# BAD:
veda -p navigator-plan-design "The function uses `console.log`"
# GOOD:
veda -S design-auth-refactor -m {{model}} -p navigator-plan-design 'The function uses `console.log` to output.'
```

## Session Naming (Critical for Multi-Agent)

Format: `design-TASKNAME`.

```bash
veda -S design-auth-refactor -m {{model}} ...    # Full design cycle on auth refactor
veda -S design-cache-eviction -m {{model}} ...   # Full design cycle on cache work
```

---

## Setting Context (Critical)

**You must run `veda sel add` before sending prompts.**

```bash
veda -S design-auth-refactor sel clear
veda -S design-auth-refactor sel add "src/auth/" "src/api/users.ts"
veda -S design-auth-refactor sel ls   # check token count
```

**Token budget:** 75k–125k tokens is acceptable. Only use slices if you exceed 125k.

---

## Stage 1: Plan + Design (navigator-plan-design)

One call. The model produces the plan (prose) and the program design (XML) in the same response.

```bash
veda -S design-auth-refactor -m {{model}} -p navigator-plan-design 'Goal: [what done looks like]. My understanding: [situation + evidence]. Proposed approach: [details]. Non-goals: [scope limits]. Key question: [your real uncertainty]. Produce the plan and the program design. What do you think?'
```

**What happens automatically:** when `navigator-plan-design` responds, veda's post-processor:
- Extracts the `<program>` block from the response
- Validates it (every signature's file is in layout, every callstack ref resolves, invariants present when signatures exist, no duplicates, path hygiene)
- On success: writes `design.xml`, `design.json`, `design.report` to `~/.config/veda/sessions/design-auth-refactor/`
- On failure: prints errors and exits nonzero — **retry the call** with the error feedback
- Prints `[design] <path>` lines to stderr

**Verify the design landed:**
```bash
ls ~/.config/veda/sessions/design-auth-refactor/design.*
cat ~/.config/veda/sessions/design-auth-refactor/design.report
```

**Review the design yourself before implementing.** Read `design.json`, check the signatures and invariants make sense. If you disagree, resume and ask for a revision:
```bash
veda -S design-auth-refactor -m {{model}} resume 'The design is missing invariants for session handling. Revise.'
```

---

## Stage 2: Implement (you, the Driver)

Carry out the design using your native tools. The design's signatures, call stacks, and invariants are the contract:

- Implement each signature from `design.json`, matching its contract, params, and return type
- Preserve every invariant
- Follow the layout (which files get what)
- Validate as you go (build, typecheck, test)

```bash
# Checkpoint with Navigator mid-implementation if stuck
veda -S design-auth-refactor -m {{model}} -p navigator-chat 'Quick question: the design says evict takes (cache, now) but the existing API passes (cache, ttlMs). Should I adapt the caller or change the signature?'
```

- Two similar failures = mandatory Navigator consult before a third attempt
- Escalate to the user via `ask_user` when a decision changes scope, cost, or direction

**Do not end implementation until the build passes and the invariants hold.**

---

## Stage 3: Review (reviewer — auto-attaches the design)

The reviewer auto-attaches the session's `design.json` and checks the implementation against the design's signatures, call stacks, and invariants.

```bash
veda -S design-auth-refactor -m {{model}} -p reviewer 'Review the implementation against the program design. Check: (1) every signature in design.json is implemented with the correct contract, params, and return type; (2) every invariant holds; (3) the call stacks match the design; (4) no scope creep beyond the layout.'
```

**Review-fix loop:** if the reviewer finds [P0]/[P1] issues, fix them and re-review:
```bash
# Fix the issues, then resume the review
veda -S design-auth-refactor -m {{model}} resume 'Fixed the [P0] issue: evict now checks maxSize after trimming. Re-review.'
```

Only fix [P0]/[P1] high-confidence issues. Skip P2/P3. Loop Review → Fix → Review until the reviewer is satisfied.

---

## Backgrounded Execution (Preferred)

Each `veda -p navigator-plan-design` / `reviewer` prompt is a high-reasoning model round-trip — 5–10+ minutes. **Run in the background** whenever your harness supports it:

```bash
veda -S design-auth-refactor -m {{model}} -p navigator-plan-design -o /tmp/veda-plan-out.md 'Goal: … What do you think?'
```

While the model thinks, keep working: read files, write probes, stage edits. When you need the answer, wait on the job and read the `-o` file.

This is safe because veda persists selection, thread id, and design artifacts under `~/.config/veda/sessions/<session>/` on disk.

**Ordering:** a `resume` depends on the prior prompt finishing. Wait for the prior job before sending the follow-up.

---

## End-of-Turn Discipline

Before ending your turn, check your last paragraph. If it is a plan, a list of next steps, or a promise about work you have not done, do that work now. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you write your final summary, write it for a reader who did not see any of the working thread. Lead with the outcome in one sentence, then the supporting detail. Write complete sentences, spell out terms, and don't use arrow chains or labels you made up earlier.

## Reminders

Key commands:
- `veda -S design-TASKNAME sel add` to build context (quote globs: `"src/*.c"`)
- `veda -S design-TASKNAME -m {{model}} -p navigator-plan-design` for Stage 1 (plan + design, one call)
- `~/.config/veda/sessions/design-TASKNAME/design.json` is the machine-checkable design handoff
- `veda -S design-TASKNAME -m {{model}} -p navigator-chat` for mid-implementation questions
- `veda -S design-TASKNAME -m {{model}} -p reviewer` for Stage 3 (review — auto-attaches design.json)
- `veda -S design-TASKNAME -m {{model}} resume` to continue any stage's conversation
