---
name: veda-plan
description: Big-model planning lane. Produce an implementation-ready Architect plan + program design (design.json), then complete a self-contained HTML design doc (devdocs/designs/) as the durable driver-facing deliverable. Uses navigator-plan for architect inputs. No implementation, no review. Use when the user wants a plan/design produced, not code written.
argument-hint: "[veda-flags]"
---

## Your Task

Produce a planning deliverable and persist it as a durable design artifact.
You do **not** implement, patch, or review code — this lane ends at the plan.

Two artifacts come out of this lane:

1. **`design.json` — the machine contract (unchanged).** The structured
   program design the worker implements and the reviewer auto-attaches. Write
   it to the session dir (project-local `.veda/sessions/<SESSION>/design.json`
   inside a git repo, else `~/.config/veda/sessions/`). Its shape is the veda
   `<program>` schema: `intent`, `layout`, `context`, `types`, `signatures`,
   `callstacks`, `invariants`.
2. **A self-contained HTML design doc — the durable, driver-facing summary.**
   Fuse the plan + design into one antirez-style HTML doc and write it to
   `devdocs/designs/{topic-slug}.html`. This is what the driver re-reads,
   hands to an agent, and uses to reason about the design without reading
   code. It is a summary artifact the **driver completes**; it never replaces
   `design.json`, which stays the machine contract.

Get the architect inputs from the Navigator model: it carries the Architect
plan + program-design persona. Drive it (or plan yourself and validate with
it) to produce an implementation-ready plan and the `<program>` design block.

## Model

`{{model}}` is auto-detected by `veda init` from your installed harnesses. If
`-m`/`-b` (or other veda flags) was passed when this skill was invoked, use
those instead of `-m {{model}}` in every `veda` command below.

**Reuse the same `-S` session name** across `navigator-plan` and follow-up
`resume`/`navigator-chat` so the conversation continues rather than
restarting.

## Session Naming (Critical for Multi-Agent)

Use a descriptive session ID with `-S`: `plan-TASKNAME`.

```bash
veda -S plan-auth-refactor -m {{model}} ...    # Planning a refactor
veda -S plan-pricing-research -m {{model}} ... # Researching pricing options
veda -S plan-launch-doc -m {{model}} ...       # Drafting a launch document
```

## Setting Context (Critical)

You must run `veda sel add` before sending prompts — this is how Navigator
sees the code and materials. Any text file works.

```bash
veda -S plan-auth-refactor sel clear
veda -S plan-auth-refactor sel add "src/feature/" "docs/notes.md"
veda -S plan-auth-refactor sel ls   # check token count
```

Always start with full files; slice only if you exceed the 125k budget
(`file.c:10-50`). Put observations in the prompt itself: error output, a
causal timeline, data you collected.

## Collaborating with Navigator (Architect)

Commit to a position, don't ask open-ended. The Navigator produces the
Architect-style output — Summary, Current-state analysis, Design, File-by-file
impact, Risks, Implementation order — **plus** the `<program>` design block.

```bash
# 1. Set the context
veda -S plan-auth-refactor sel clear
veda -S plan-auth-refactor sel add "src/auth/" "src/api/users.ts"

# 2. Plan — commit to a position, and carry the user's ASK VERBATIM
#
# Lead the driver->navigator prompt with the USER'S EXACT WORDS, quoted verbatim,
# not a paraphrase — Navigator plans against the ask as given, and your
# interpretation can drift from it. Put the original request first:
veda -S plan-auth-refactor -m {{model}} -p navigator-plan \
  '<USER PROMPT, verbatim, exactly as the user wrote it>

My understanding: [situation + evidence]. Proposed approach: [details]. Non-goals: [scope limits]. Key question: [your real uncertainty]. What do you think?'

Weave the verbatim user prompt in **even when you've restated it above** — the
persona should see the original ask, not just your framing. If you were invoked
with a user message, reproduce it exactly; don't "clean up" or summarize it into
your own wording.

# 3. Continue discussion (session-scoped resume), or pivot to chat
veda -S plan-auth-refactor -m {{model}} resume "What about edge case X?"
veda -S plan-auth-refactor -m {{model}} -p navigator-chat "What about edge case X?"
```

**Involve the user when the work genuinely requires them** (`ask_user`):
ambiguous goal, a decision that changes scope/cost/direction, or input only
the user can provide. Navigator advises; the user decides.

## Deliver

When the plan + design are aligned:

1. **Write `design.json`** to the session dir (`$PROJECT_ROOT/.veda/sessions/<SESSION>/design.json`, create the dir if needed). `PROJECT_ROOT="$(git rev-parse --show-toplevel)"`. This is the machine contract — keep it exactly per the `<program>` schema, unchanged in purpose.
2. **Complete the HTML design doc** at `devdocs/designs/{topic-slug}.html` (create `devdocs/designs/` if absent). Make it self-contained (inline CSS, inline SVG diagrams, no external stylesheets/JS/fonts/CDN) and cover: how things work today, the problem/failure mode, goals/non-goals, the design mechanism, primitives & data model, invariants, verification (executable "done"), tradeoffs, and a TL;DR. The driver completes and owns this doc; the doc summarizes the design, and `design.json` remains the source the worker/reviewer use.

Escaping backticks: use single quotes for prompts containing backticks — double quotes let bash evaluate them as command substitution. **Don't pipe veda with `2>&1`** — the response goes to stdout, progress/trace to stderr; capture stdout alone or `-o file.md`.

## Reminders

Onboard yourself with veda at `~/.pi/agent/docs/veda.md` before acting.
Key commands:
- `veda -S plan-TASKNAME sel add` to build context (quote globs: `"src/*.c"`)
- `veda -S plan-TASKNAME sel ls` to verify selection and token count
- `veda -S plan-TASKNAME -m {{model}} -p navigator-plan` for the Architect plan + design
- `veda -S plan-TASKNAME -m {{model}} -p navigator-chat` for follow-up discussion
- `veda -S plan-TASKNAME -m {{model}} resume` to continue a conversation (session-scoped)
- Write `design.json` to `$PROJECT_ROOT/.veda/sessions/<SESSION>/`; complete the HTML design doc at `devdocs/designs/<topic-slug>.html`
- Output goes to stdout; use `-o file.md` to save response; don't pipe `2>&1`
