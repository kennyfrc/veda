---
name: veda-worker
description: "Orchestrate a full plan → implement → verify cycle with Veda, from the caller's point of view. YOU are the orchestrator: you plan and drive navigator-plan to produce the design, hand the WHOLE design to one worker run (the worker is the driver, executes with write access), read its report.yaml, then run the verifier against the design. You NEVER implement — every edit and every fix is delegated to the worker agent. Branches on report.yaml (completed → verify; blocked → answer needs + resume, cap 3, then escalate; failed → replan). Exit 0 = the delegation succeeded even when the report's status is failed/blocked; non-zero = protocol failure. Use when you want the implementation DELEGATED to the worker agent, not done by you."
argument-hint: "[veda-flags]"
---

## Your Task: Orchestrate the Design to Completion — the Worker Drives

This skill is written from the caller's point of view: **you are the orchestrator and the planner** — you plan, scope, supply context, and judge quality — while the **worker persona is the driver**, executing the implementation with real write access and reporting back through a structured `<worker_report>`. Your job is to run the loop: design → deliver the whole design to one worker → verify the result.

**YOU NEVER IMPLEMENT. This is the hard rule of this skill.** You do not edit files, write code, run the build, or fix issues yourself — not once, not "just this small thing." Every implementation and every fix is delegated to the worker persona. If you catch yourself opening an editor or writing a patch, stop: that work belongs in a `-p worker` delegation.

The worker is veda's write-capable seat: `tools: all`, `sandbox: workspace-write`. It edits files, runs tests/typecheck/build, and — whenever the change alters observable behavior — proves it against the live surface (browser via `cdp`, interactive CLI via `xtui`/`tmux`, API edges via scratch probes) with artifacts. Its final message is a mandatory `<worker_report>` (Factory subagent handoff contract), which veda parses into `report.yaml` next to the raw transcript `response.yaml` in the session dir.

**Model:** `{{model}}` is auto-detected by `veda init` from your installed harnesses. If a `-m`/`-b` (or other veda flags) was passed when this skill was invoked, use those instead of `-m {{model}}` in every `veda` command below. The worker is model-agnostic; for cheap routine orchestrations you can set a fast alias (e.g. `MODEL_ALIASES="flash=pi/neuralwatt/deepseek-v4-flash"` in `~/.config/veda/config`) and use `-m flash`.

**Reuse the same `-S` session name** across the whole loop — plan, worker run, and any `resume` — so the design, selection, and `report.yaml` stay in one place and the verifier can attach the design.

**Involve the user when the work genuinely requires them.** Use your `ask_user` tool (or plain questions if unavailable) when the goal is ambiguous, a decision would change scope/cost/direction, or input only the user can provide. You orchestrate; the user decides. Otherwise, when the goal is fully specifiable, act.

### Escaping Backticks in Prompts (Critical)

**Backticks in double-quoted prompts get evaluated by bash as command substitution.** If your prompt contains code examples with backticks, they will be executed as commands:

```bash
# BAD - double quotes evaluate backticks:
veda -S task-auth-fix -p worker "Add a `normalize()` helper that strips null bytes"
# Results in: sh: normalize(): command not found

# GOOD - use single quotes (simplest):
veda -S task-auth-fix -p worker 'Implement design.json. Add a `normalize()` helper that strips null bytes; run the slice tests.'

# GOOD - escape backticks in double quotes:
veda -S task-auth-fix -p worker "Add a \`normalize()\` helper that strips null bytes."
```

**Recommendation:** Use single quotes (`'...'`) for prompts containing backticks. If you need variable expansion, escape backticks with backslash in double quotes.

### Session Naming (Critical for Multi-Agent)

**Use a descriptive, contextual session ID** with `-S`, and reuse it for the whole loop. Format: `task-TASKNAME` where TASKNAME describes the work.

```bash
veda -S task-cache-layer -p navigator-plan 'Design the cache layer'   # design.json written to session
veda -S task-cache-layer -p worker 'Implement design.json'             # same session
veda -S task-cache-layer -p verifier 'Verify the implementation'       # same session
```

---

## Step 1 — Scope and Build Context (your orchestrator job)

**The worker receives your session's selection as context, exactly like the navigator does.** Curate it before the worker runs.

```bash
veda -S task-cache-layer sel clear
veda -S task-cache-layer sel add "src/cache/" "src/api/"
veda -S task-cache-layer sel ls   # verify + token count
```

**Token budget (one rule):** start with full files; 75k-125k tokens is acceptable; slice only if you exceed 125k. The worker has its own read tools, so under-select rather than bury it — but the selection is your main channel for pointing it at the right code. Put observations in the prompt itself: error output, a causal timeline, data you collected.

## Step 2 — Plan and Design (navigator-plan produces design.json)

Drive `navigator-plan` in the session to produce the structured program design. Veda parses its `<program>` block and writes `design.xml` / `design.json` / `design.report` to the session dir. Your role is the planner: you may write the plan yourself or delegate it to `navigator-plan` — either way the design is the contract, and implementation is always the worker's job, never yours.

```bash
veda -S task-cache-layer -p navigator-plan -m {{model}} \
  'Goal: [what done looks like]. My understanding: [situation + evidence]. Proposed approach: [details]. Non-goals: [scope limits]. Produce the plan and the program design. What do you think?'
```

**Review the design yourself before delegating.** Read the `~/.config/veda/sessions/task-cache-layer/design.json` — check the signatures, call stacks, and invariants make sense. If you disagree, resume and ask for a revision (cap 1-2 replans). The design is the contract the worker and verifier will both check against, so its quality is on you as the orchestrator.

## Step 3 — Deliver the WHOLE Design to One Worker

By design, this loop uses **one worker run for the whole design** — not per-slice delegation. The worker reads `design.json` from the session dir (it has read tools), implements it end-to-end, and reports once. Decompose only if a single delegation genuinely exceeds one focused diff (then the coarse decomposition is the worker's job — keep the worker a pure function: task in → report out).

```bash
veda -S task-cache-layer -p worker -m {{model}} \
  'Implement the program design in this session (design.json) in full. Run the verification the design names (tests/typecheck/build), and prove any observable behavior against the running surface with evidence and artifacts. Report exactly once via a <worker_report>; status "completed" only if every named verification passed. Non-goals in design.json stay non-goals.'
```

The same session means the worker can `read` `design.json` directly — no need to paste it into the prompt.

## Step 4 — Read the Report (not the prose)

```bash
veda -S task-cache-layer -p worker -m {{model}} '…'
```

**Exit-code semantics (critical):** exit `0` means the delegation worked — the protocol block was well-formed — even when `report.status` is `failed` or `blocked` (a truthful negative is a successful report). A **non-zero** exit means a *protocol* failure (missing/malformed `<worker_report>`): inspect the printed tail and `response.yaml`; do not trust any partial work.

Read the structured report, never the free-form flourish:

```bash
REPORT=~/.config/veda/sessions/task-cache-layer/report.yaml
yq '.status' "$REPORT"          # completed | failed | blocked
yq '.whatWasImplemented' "$REPORT"
yq '.verification' "$REPORT"    # commandsRun + evidence (with artifacts)
yq '.needs' "$REPORT"           # only when blocked
```

Branch on the status:

| Report status | What to do |
|---|---|
| `completed` | Check `whatWasLeftUndone` ("nothing" = done). Go to the review step. Do not re-implement. |
| `blocked` | Supply the single `needs` item and `resume` with it answered: `veda -S task-cache-layer resume '<the missing input>'`. A new block is new information — each resume should narrow toward `completed`. Cap iterations (3) before escalating/cutting scope. |
| `failed` | Route `discovered_issues` to `navigator-plan` to revise the design, or tighten the plan — the work was attempted and its own verification disproved it. Re-run the worker after replan (cap 1 replan per design). |

## Step 5 — Verify the Whole Result (verifier at end)

Adversarial verification is the closing gate. The verifier runs the build/tests itself (read+bash on by default), so the diff is *context*, not the thing it re-reads line-by-line. Capture it for selection, then verify against the same `design.json` the worker implemented:

```bash
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/orchestrate.diff
veda -S task-cache-layer sel add /tmp/orchestrate.diff
veda -S task-cache-layer sel ls   # verify the diff is in selection
veda -S task-cache-layer -p verifier -m {{model}} \
  'Implementation complete. Verify the implementation against this session's design.json (auto-attached). The diff is in selection. You have read+bash — run the build and the tests yourself. List every affordance this change alters and test each on the real surface (cdp for web UI, xtui/tmux for CLI/TUI, curl for APIs). Only P0/P1 issues; skip P2/P3. End with <verifier_report>; verdict PASS only if every check passed and every affordance is verified.'
```

The verifier auto-attaches the session's `design.json`, runs the build/tests itself (read+bash on by default), lists the change's affordances, and adversarially checks the implementation against its signatures and invariants. Read the `<verifier_report>`: `verdict` (`PASS|FAIL|PARTIAL`) is machine-read; `affordances` shows what it enumerated and whether each was tested — a listed-but-untested affordance is not verified, treat it as `PARTIAL`. Loop Verify → (worker fixes) → Verify until `verdict` is `PASS`:

- **FAIL with P0/P1 findings** → delegate the fix back to the worker agent: a fresh `-p worker` run in the same session with the findings pasted into the prompt ("Fix the verifier's P0/P1 findings: …"), or `resume` the original worker session with them. Re-run the verifier after the worker reports `completed`.
- **FAIL on design grounds** (signatures/invariants/call stacks at fault) → route to `navigator-plan` to revise `design.json`, then re-delegate to the worker.
- **You never fix code yourself.** Skip P2/P3. Escalate any remaining disagreement to the user.

## Loop Discipline — you are an orchestrator, not a micromanager

- **You never implement.** If the verifier finds issues, route them back to the worker; if the design is at fault, route to navigator-plan. Your hands stay off the code — an orchestrator who edits is a micromanager.
- **One worker for the whole design.** Deliver the complete design in a single delegation and let the worker decompose internally. Re-delegate only on `blocked` (answer `needs` + resume), `failed` (replan first), or verifier findings (route them back).
- **Stay in scope, bilaterally.** The `whatWasLeftUndone` list is mandatory — treat partial work claiming completeness as a protocol violation, not a status.
- **Trust evidence, not narration.** `verification.commandsRun` and `evidence` entries name real commands/flags/artifacts. For UI/CLI claims, a visual change with no screenshot/terminal-snap is advisory, not evidence — the verifier pass (Step 5) is the independent cross-check of testimony vs the transcript.
- **Don't restart shared infra.** If the dev server/API the task needs is down, the worker reports that leg `blocked`; supply/start it yourself, don't tell the worker to restart what it didn't start.
- **Escalate to the user** (via `ask_user`) when a decision changes scope, cost, or direction, or only the user can provide input. You orchestrate; the user decides.

---

Before ending your turn, check your last paragraph. If it is a plan, a list of next steps, or a promise about work you have not done ("I'll...", "let me know when..."), do that work now. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you write your final summary, write it for a reader who did not see any of the working thread. Lead with the outcome in one sentence, then the supporting detail. Drop the working shorthand: write complete sentences, spell out terms, and don't use arrow chains or labels you made up earlier. If you have to choose between short and clear, choose clear.

## Reminders

Onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `veda -S task-TASKNAME -p navigator-plan -m {{model}} '…'` to produce the design (writes design.json to the session)
- `veda -S task-TASKNAME sel add <files>` to build context (and add `/tmp/orchestrate.diff` before review)
- `veda -S task-TASKNAME -p worker -m {{model}} 'Implement design.json in full…'` to delegate the whole design (tools on, workspace-write)
- `veda -S task-TASKNAME resume '<needs answered>'` to continue a blocked worker
- `veda -S task-TASKNAME -p verifier -m {{model}}` to verify the whole diff against design.json (auto-attached)
- Report lives at `~/.config/veda/sessions/task-TASKNAME/report.yaml`; read `status`, `whatWasImplemented`, `verification`, `needs`
- Exit 0 = delegation OK (even status failed/blocked); non-zero = protocol failure — inspect the tail
- Worker is write-capable by default; `--sandbox read-only` runs it as a dry-run planner
- `-m flash` (if you set `MODEL_ALIASES` in `~/.config/veda/config`) is a fast/cheap worker default
- Output goes to stdout; use `-o file.md` to save response
