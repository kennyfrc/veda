---
name: veda-worker
description: "Orchestrate a full plan → implement → verify cycle with Veda, from the caller's point of view. YOU are the orchestrator AND the planner: you author the plan and the design.json yourself (you NEVER delegate planning to navigator-plan), hand the WHOLE design to one worker run (the worker is the driver, executes with write access), read its report.yaml, then run the reviewer against the design. You NEVER implement — every edit and every fix is delegated to the worker agent. Branches on report.yaml (completed → verify; blocked → answer needs + resume, cap 3, then escalate; failed → revise the plan yourself and re-delegate). Exit 0 = the delegation succeeded even when the report's status is failed/blocked; non-zero = protocol failure. Use when you want the implementation DELEGATED to the worker agent, not done by you."
argument-hint: "[veda-flags]"
---

## Your Task: Orchestrate the Design to Completion — the Worker Drives

This skill is written from the caller's point of view: **you are the orchestrator and the planner** — you plan, scope, supply context, and judge quality — while the **worker persona is the driver**, executing the implementation with real write access and reporting back through a structured `<worker_report>`. Your job is to run the loop: design → deliver the whole design to one worker → review the result (review-fix loop).

**YOU NEVER IMPLEMENT, AND YOU NEVER DELEGATE PLANNING. These are the two hard rules of this skill.** You do not edit files, write code, run the build, or fix issues yourself — not once, not "just this small thing." Every implementation and every fix is delegated to the worker persona. If you catch yourself opening an editor or writing a patch, stop: that work belongs in a `-p worker` delegation. Symmetrically, the plan and the program design are yours alone: you write `design.json` yourself (Step 2). You do not call `navigator-plan` to produce it. If you catch yourself reaching for `-p navigator-plan` to plan, stop: that thinking is your job as the orchestrator.

The worker is veda's write-capable seat: `tools: all`, `sandbox: workspace-write`. It edits files, runs tests/typecheck/build, and — whenever the change alters observable behavior — proves it against the live surface (browser via `cdp`, interactive CLI via `xtui`/`tmux`, API edges via scratch probes) with artifacts. Its final message is a mandatory `<worker_report>` (Factory subagent handoff contract), which veda parses into `report.yaml` next to the raw transcript `response.yaml` in the session dir.

**Model:** `{{model}}` is auto-detected by `veda init` from your installed harnesses. If a `-m`/`-b` (or other veda flags) was passed when this skill was invoked, use those instead of `-m {{model}}` in every `veda` command below. The worker is model-agnostic; for cheap routine orchestrations you can set a fast alias (e.g. `MODEL_ALIASES="flash=pi/neuralwatt/deepseek-v4-flash"` in `~/.config/veda/config`) and use `-m flash`.

**Reuse the same `-S` session name** across the whole loop — plan, worker run, and any `resume` — so the design, selection, and `report.yaml` stay in one place and the reviewer can attach the design.

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
# You author the design yourself — there is no navigator-plan step in this lane.
veda -S task-cache-layer -p worker 'Implement design.json'             # design.json you wrote
veda -S task-cache-layer -p reviewer 'Review the implementation'      # same session
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

## Step 2 — Plan and Design (YOU author the plan and design.json)

**The plan comes from you, the orchestrator — never from `navigator-plan`.** This is the big-model lane: the whole point is that the strong model (you) does the thinking and delegates only the typing. Do not run `-p navigator-plan` to produce the design. Reason about the goal, the selected context, and the constraints yourself, then write the program design to the session dir as `design.json`.

Write your design to the session's design path (create the dir if needed).
Session artifacts live project-locally: `<git-root>/.veda/sessions/<SESSION>`.

```bash
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
SESSION_DIR="$PROJECT_ROOT/.veda/sessions/task-cache-layer"
mkdir -p "$SESSION_DIR"
# Write design.json yourself (see schema below) — e.g. with your editor or a heredoc.
```

`design.json` must be a JSON object with these keys (this is the contract the worker reads and the reviewer auto-attaches):

```json
{
  "name": "task-slug",
  "task": "one-line statement of the work",
  "intent": "the outcome and why; the governing constraints",
  "layout": [{ "path": "src/file.ts", "role": "what lives here" }],
  "context": [{ "file": "src/file.ts" }],
  "types": [{ "name": "Thing", "file": "src/file.ts", "fields": "…" }],
  "signatures": [{ "name": "mod.fn", "file": "src/file.ts", "kind": "function", "contract": "…", "params": [], "returns": "…" }],
  "callstacks": [{ "name": "flow", "steps": [{ "ref": "mod.fn" }] }],
  "invariants": ["statement that must always hold"]
}
```

Keep it as rich as the task warrants: exact store schema, mutation/render signatures, interaction invariants, and the verification the worker must run (in `intent` or a dedicated field). The design is the contract the worker and reviewer both check against, so its quality is on you.

**Review your own design before delegating.** Re-read the `design.json` you wrote — check the signatures, call stacks, and invariants make sense and cover the goal. Iterate until it does (cap 1-2 revisions). Do not hand the worker a design you have not yourself validated.

## Step 3 — Deliver the WHOLE Design to One Worker

By design, this loop uses **one worker run for the whole design** — not per-slice delegation. The worker reads `design.json` from the session dir (it has read tools), implements it end-to-end, and reports once. Decompose only if a single delegation genuinely exceeds one focused diff (then the coarse decomposition is the worker's job — keep the worker a pure function: task in → report out).

```bash
veda -S task-cache-layer -p worker -m {{model}} \
  'Implement the program design in full. FIRST read ${SESSION_DIR}/design.json — that file is the contract (read it, do not guess or approximate its contents). Run the verification the design names (tests/typecheck/build), and prove any observable behavior against the running surface with evidence and artifacts. Report exactly once via a <worker_report>; status "completed" only if every named verification passed. Non-goals in design.json stay non-goals.'
```

The prompt above names the **absolute path** to `design.json` (`${SESSION_DIR}/design.json`, where `SESSION_DIR="$PROJECT_ROOT/.veda/sessions/task-NAME"` from Step 2) — the worker runs from the repo, so its **first read is the contract file at that exact path**. Don't rely on the worker inferring the session; always spell the path out.

## Step 4 — Read the Report (not the prose)

```bash
veda -S task-cache-layer -p worker -m {{model}} '…'
```

**Exit-code semantics (critical):** exit `0` means the delegation worked — the protocol block was well-formed — even when `report.status` is `failed` or `blocked` (a truthful negative is a successful report). A **non-zero** exit means a *protocol* failure (missing/malformed `<worker_report>`): inspect the printed tail and `response.yaml`; do not trust any partial work.

Read the structured report, never the free-form flourish:

```bash
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
REPORT="$PROJECT_ROOT/.veda/sessions/task-cache-layer/report.yaml"
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
| `failed` | The work was attempted and its own verification disproved it. Read `discovered_issues`, revise YOUR `design.json` (the plan was wrong, not the typing), then re-run the worker against the revised design (cap 1 replan per design). |

## Step 5 — Review the Whole Result (reviewer at end)

Code review is the closing gate. The **reviewer** runs with no tools: it
reviews the diff + the selected file context + the session's `design.json`
(auto-attached) and reports P0/P1/P2 findings — it doesn't run the build, it
names any missing artifact instead of searching for it. Capture the diff for
selection, then review against the same `design.json` the worker implemented:

```bash
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/orchestrate.diff
veda -S task-cache-layer sel add /tmp/orchestrate.diff
veda -S task-cache-layer sel ls   # verify the diff is in selection
veda -S task-cache-layer -p reviewer -m {{model}} \
  'Implementation complete. Review the diff against this session's design.json (auto-attached) and report P0/P1/P2 findings. End with review: pass or review: needs-fix.'
```

The reviewer auto-attaches the session's `design.json` and reports discrete,
actionable findings grouped by severity: **P0** (must fix), **P1** (should
fix), **P2** (consider). It ends with `review: pass` (no P0/P1) or
`review: needs-fix` (P0/P1 present). This drives the **review → fix →
re-review** loop until `review: pass`:

- **`review: needs-fix` with P0/P1 findings** → delegate the fix back to the
  worker agent: a fresh `-p worker` run in the same session with the findings
  pasted into the prompt ("Fix the reviewer's P0/P1 findings: …"), or `resume`
  the original worker session with them. Re-run the reviewer after the worker
  reports `completed`.
- **Review errors on design grounds** (signatures/invariants/call stacks at
  fault) → revise YOUR `design.json` yourself (the plan is yours), then
  re-delegate to the worker.
- **You never fix code yourself.** Skip P2 (it doesn't block). Escalate any
  remaining disagreement to the user.

## Loop Discipline — you are an orchestrator, not a micromanager

- **You never implement, and you never delegate planning.** If the reviewer finds P0/P1 issues, route the fix back to the worker; if the design is at fault, revise `design.json` yourself. Your hands stay off the code — an orchestrator who edits is a micromanager — and the plan stays in your head, not a persona's.
- **One worker for the whole design.** Deliver the complete design in a single delegation and let the worker decompose internally. Re-delegate only on `blocked` (answer `needs` + resume), `failed` (replan first), or reviewer findings (route them back).
- **Stay in scope, bilaterally.** The `whatWasLeftUndone` list is mandatory — treat partial work claiming completeness as a protocol violation, not a status.
- **Trust evidence, not narration.** `verification.commandsRun` and `evidence` entries name real commands/flags/artifacts. For UI/CLI claims, a visual change with no screenshot/terminal-snap is advisory, not evidence — the reviewer pass (Step 5) is the independent cross-check of testimony vs the transcript.
- **Don't restart shared infra.** If the dev server/API the task needs is down, the worker reports that leg `blocked`; supply/start it yourself, don't tell the worker to restart what it didn't start.
- **Escalate to the user** (via `ask_user`) when a decision changes scope, cost, or direction, or only the user can provide input. You orchestrate; the user decides.

---

Before ending your turn, check your last paragraph. If it is a plan, a list of next steps, or a promise about work you have not done ("I'll...", "let me know when..."), do that work now. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you write your final summary, write it for a reader who did not see any of the working thread. Lead with the outcome in one sentence, then the supporting detail. Drop the working shorthand: write complete sentences, spell out terms, and don't use arrow chains or labels you made up earlier. If you have to choose between short and clear, choose clear.

## Reminders

Onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- You author the plan and `design.json` yourself (Step 2) — never via `-p navigator-plan`.
- `veda -S task-TASKNAME sel add <files>` to build context (and add `/tmp/orchestrate.diff` before review)
- `veda -S task-TASKNAME -p worker -m {{model}} 'Implement design.json in full…'` to delegate the whole design (tools on, workspace-write)
- `veda -S task-TASKNAME resume '<needs answered>'` to continue a blocked worker
- `veda -S task-TASKNAME -p reviewer -m {{model}}` to review the whole diff against design.json (auto-attached)
- Report lives at `<git-root>/.veda/sessions/task-TASKNAME/report.yaml`; read `status`, `whatWasImplemented`, `verification`, `needs`
  (fallback: `~/.config/veda/sessions/` when run outside a git repo)
- Exit 0 = delegation OK (even status failed/blocked); non-zero = protocol failure — inspect the tail
- Worker is write-capable by default; `--sandbox read-only` runs it as a dry-run planner
- `-m flash` (if you set `MODEL_ALIASES` in `~/.config/veda/config`) is a fast/cheap worker default
- Output goes to stdout; use `-o file.md` to save response. **Never pipe veda with `2>&1`** — the response is on stdout, the progress header/trace on stderr, so merging them puts the header into the response and garbles it.
