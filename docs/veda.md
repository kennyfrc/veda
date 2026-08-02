# veda — plan, implement, verify with delegated agents

## What it is

`veda` is a CLI your agent consults to plan, delegate implementation, and
verify work. It wraps codex, claude-code, droid, and pi behind **personas** —
seats with distinct capabilities and handoff contracts. You drive; veda's
personas advise, implement (via the worker), and verify (via the verifier).

## Personas

| Persona | Role | Reasoning | Tools / sandbox | Handoff |
|---|---|---|---|---|
| `navigator-plan` | Architect: plan + `<program>` design in one call | high | none (read-only) | `<plan_report>`; `<program>` block → `design.json` in the session dir |
| `navigator-chat` | In-flight advisor, short high-signal turns | medium | none (read-only) | `<chat_report>` |
| `verifier` | Adversarial correctness checker — tries to break it, lists the change's affordances and tests each | medium | `read,bash,grep,glob` (default on) | `<verifier_report>` with `verdict: PASS\|FAIL\|PARTIAL` |
| `worker` | Write-capable driver: edits files, runs tests, proves behavior against the live surface | high | `all` + `workspace-write` (both overridable) | mandatory `<worker_report>` → `report.yaml` |

Shared discipline: every persona ends with a flat depth-1 XML report block;
`status` + `salient_summary` are the common spine. Personas never implement
unless they are the worker — the verifier checks, the navigators advise, and
the **you (the caller) or the worker** writes code.

## Skills (bundled, two lanes)

Small-model lane — the model implements itself, delegates planning/verification up:
- `veda-plan-implement` — align with navigator-plan, then implement yourself.
- `veda-plan-implement-verify` — same, plus a final verifier pass.

Big-model lane — the model plans itself, delegates execution/verification:
- `veda-worker` — orchestrate: plan/design → ONE worker run for the whole
  design → read `report.yaml` → verification loop until `PASS`. You never
  implement; every edit and fix is a `-p worker` delegation.
- `veda-deep-plan` — hardest problems: parallel solvers + judge + verifier.

## Core workflow

1. **Build context yourself first**, then share it:

```bash
veda -S task-NAME sel clear
veda -S task-NAME sel add "src/auth/" "src/api/users.ts"   # quote globs
veda -S task-NAME sel ls                                    # verify + token count
```

Target ~75k-125k tokens. Start with full files; slice only above budget
(`file.c:10-50`, `file.c:15-`, `"src/*.c:1-80"`).

2. **Reuse one `-S` session name across the whole loop** (plan, worker run,
   resumes, verify) so `design.json`, selection, and `report.yaml` stay together.

3. **Send prompts that commit to a position** — goal, your understanding,
   proposed approach, non-goals, and 1-2 real questions. Put observations in
   the prompt (error output, causal timeline, data) — personas only see what
   you select plus the session's artifacts.

```bash
veda -S task-NAME -p navigator-plan -m sol 'Goal: … My understanding: … What do you think?'
veda -S task-NAME resume 'What about edge case X?'        # continue, session-scoped
veda -S task-NAME -p navigator-chat -m sol 'Quick question: …'
```

## Delegating to the worker (big-model lane)

```bash
veda -S task-NAME -p worker -m sol 'Implement the program design in full. FIRST read <project>/.veda/sessions/task-NAME/design.json — that file is the contract (read it, don't guess or approximate it). Run the verification the design names; prove observable behavior against the running surface with evidence. Report once via <worker_report>; status "completed" only if every named verification passed.'
```

Always name the **absolute path** to `design.json` (here `<project>/.veda/sessions/task-NAME/design.json`) in the worker prompt — the worker runs from the repo and its first read must be the contract at that exact path; don't rely on it inferring the session.

- The worker ends with a mandatory `<worker_report>`; veda parses it into
  `<project>/.veda/sessions/task-NAME/report.yaml` (next to the raw `response.yaml`).
  Inside a git repo, session artifacts live in the project's `.veda/`; outside,
  veda falls back to `~/.config/veda/sessions/`.
- **Exit codes:** `0` = the delegation worked (protocol block well-formed) even
  when `status` is `failed`/`blocked` — a truthful negative is a successful
  report. Non-zero = protocol failure (missing/malformed block): inspect the
  tail + `response.yaml`; don't trust partial work.
- **Branch on `report.yaml`:** `completed` → verify; `blocked` → answer the
  single `needs` item and `resume` (cap 3, then escalate); `failed` → route
  `discovered_issues` back to `navigator-plan`, replan (cap 1), re-delegate.

## Verifying (verifier)

```bash
git diff -- . ':(exclude)*.png' ':(exclude)*.jpg' ':(exclude)*.woff*' > /tmp/changes.diff
veda -S task-NAME sel add /tmp/changes.diff
veda -S task-NAME -p verifier -m sol 'Verify against this session's design.json (auto-attached). Run the build and tests yourself. List every affordance this change alters and test each on the real surface (cdp for web UI, xtui/tmux for CLI/TUI, curl for APIs). End with <verifier_report>; verdict PASS only if every check passed and every affordance is verified.'
```

- The verifier has `read,bash,grep,glob` on by default — it runs the build and
  tests itself. `design.json` auto-attaches when it exists in the session.
- `<verifier_report>` `verdict`: `PASS` (done), `FAIL` (P0/P1 → delegate the
  fix to the worker, re-verify), `PARTIAL` (environmental limits only — a
  listed-but-untested affordance is not verified). Only act on P0/P1.

## Models

- Aliases: `-m sol` (gpt-5.6-sol, codex, max), `-m k3` (kimi-k3, pi, max),
  `-m flash` (pi/neuralwatt/deepseek-v4-flash — cheap, good for worker runs).
- `pi/...` model strings auto-infer the pi backend; `gpt-...` → codex;
  `claude-...` → claude-code. `-b` forces a backend.
- User aliases: `MODEL_ALIASES="name=full-model[:reasoning]"` in
  `~/.config/veda/config` — overrides the built-ins everywhere `-m` works.
- Reasoning ladder: `minimal|low|medium|high|xhigh|max`. Explicit
  `--reasoning` beats persona default, which beats alias hint.

## Where things live

- `~/.config/veda/config` — backend, persona, model, `MODEL_ALIASES`,
  per-backend models, `DEFAULT_SANDBOX`.
- `<project>/.veda/sessions/<session>/` (project-local; `~/.config/veda/sessions/`
  when run outside a git repo) — `design.json` (+ `design.xml`/
  `design.report`), `report.yaml`, `response.yaml`, `selection/`, `thread.json`,
  `checkpoint.yaml`. The session base is the nearest git root's `.veda/`;
  an explicit `VEDA_HOME` env override always wins.
- Skills install to `~/.agents/skills/` (+ symlinks in `~/.claude/skills/`).

## Operating rules

- **Evidence over narration.** `verification.commandsRun` / `evidence` entries
  name real commands, flags, and artifacts. A visual change without a
  screenshot/terminal-snap is advisory, not evidence.
- **Never restart shared infra.** If a service the task needs is down, the
  worker reports that leg `blocked`; the caller supplies/starts it.
- **Escalate to the user** when a decision changes scope, cost, or direction.
- **Backticks in prompts:** use single quotes — double quotes let bash
  evaluate backticks as command substitution.
- **`-o file.md`** saves the response instead of stdout.
- **Never pipe veda with `2>&1`** (and don't capture both streams together).
  veda writes its response/`<worker_report>` to **stdout** and its progress
  header + trace to **stderr**; `2>&1` merges the header into the response and
  garbles it. Read the streams separately, or use `-o file.md` to save only
  the response.
