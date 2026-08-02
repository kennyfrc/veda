# Veda Agent Skills

Project-scoped skills that teach coding agents (Claude Code, OpenAI Codex CLI, Pi) how to
collaborate with the [Veda](https://github.com) Navigator / Verifier models via the `veda` CLI.

These implement the open [Agent Skills](https://agentskills.io/specification) standard — each
skill is a directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`)
plus a Markdown body of instructions.

## Skills

| Skill | Slash label | When to use |
| --- | --- | --- |
| `veda-plan-implement` | `/veda:plan-implement` | **Small-model lane**: align on a plan with Navigator **before** implementing. No execution. |
| `veda-plan-implement-verify` | `/veda:plan-implement-verify` | **Small-model lane**: align on a plan, then **execute** it. Navigator has read-only tools. |
| `veda-deep-plan` | `/veda:deep-plan` | Plan the **hardest** problems with Deep Thinking (parallel solvers + judge + verifier). No execution. |
| `veda-worker-verify` | `/veda:worker-verify` | **Big-model lane**: mandatory **final** verify-fix loop with the Verifier model (adversarial, reports VERDICT). Not for mid-implementation. |
| `veda-worker` | `/veda:worker` | **Big-model lane**: caller-POV orchestration — navigator-plan → one worker run for the whole design → verifier at the end. You orchestrate (plan, scope, review); the worker drives. Use when you want a model to implement, not advise. |

## Installing the skills

### From a Veda install (recommended)

`veda` bundles the five skills and can materialize them into the cross-agent discovery
directories. Once `veda` is installed on your machine:

```bash
veda skills install     # install into ~/.agents/skills/ + ~/.claude/skills/
veda skills list         # show install status and symlink health
veda skills uninstall    # remove the installed skills
```

`veda init` runs `skills install` as one of its steps, so first-time setup is one command:

```bash
veda init                # creates config + personas AND installs the skills
```

The compiled `veda` binary carries the `SKILL.md` files as embedded assets, so `skills
install` works with no repository on disk — it reads the bundled content and writes it to:

- `~/.agents/skills/<name>/SKILL.md` — read **globally** by Pi and OpenAI Codex CLI (Pi
  always trusts this dir; no project-trust prompt).
- `~/.claude/skills/<name>` — a **symlink** to the canonical copy above; Claude Code follows
  symlinks and dedupes by target.

Re-running `veda skills install` is idempotent: it overwrites a canonical file only if its
content changed and re-creates a symlink only if it's missing or points elsewhere. It will
not clobber a non-empty directory you own at the `.claude` path.

### For contributors who clone this repo

The canonical skill source lives in `.agents/skills/`:

```
.agents/skills/
├── veda-plan-implement/SKILL.md
├── veda-plan-implement-verify/SKILL.md
├── veda-deep-plan/SKILL.md
├── veda-worker-verify/SKILL.md
└── veda-worker/SKILL.md
```

`.claude/skills/<name>` entries are **relative symlinks** into `.agents/skills/<name>`, so
the two trees can never drift. Codex and Pi discover them from `.agents/skills/` natively
(no install step) once the project is trusted; Claude Code reads them through the symlinks.

## How each agent discovers them

| Agent | Discovery location | Scope |
| --- | --- | --- |
| **OpenAI Codex CLI** | `~/.agents/skills/` (global) + `.agents/skills/` cwd→repo-root (project) | both |
| **Pi** | `~/.agents/skills/` (global, always trusted) + `.agents/skills/` / `.pi/skills/` (project, after trust) | both |
| **Claude Code** | `~/.claude/skills/` (follows symlinks, dedupes by target) + `.claude/skills/` (project) | both |

Because all three read the **same** `SKILL.md` files (Codex + Pi via `~/.agents/skills/`,
Claude Code via a symlink into it), editing a skill in `.agents/skills/<name>/SKILL.md` and
rebuilding the binary updates it for every agent after `veda skills install`. There is nothing
to keep in sync across agent dirs.

## Onboarding prerequisite

Every skill assumes the agent has onboarded itself with Veda first:

```bash
cat ~/.jdc/agent/old-docs/veda.md
```

## Notes

- Skill `name` values use lowercase + hyphens only (spec rule). The `/veda:plan-implement` style labels
  in docs are descriptive; the actual discoverable names are `veda-plan-implement`,
  `veda-plan-implement-verify`, `veda-deep-plan`,
  `veda-worker-verify`, and `veda-worker`.
- Keep `SKILL.md` under 500 lines; move long reference material into a `references/` subdir.
- The `~/.agents/skills/` location is a *de-facto cross-agent convention* (not mandated by
  the agentskills.io spec, which only defines the `SKILL.md` format) — Pi and Codex both
  chose to read it globally, which is why `veda skills install` targets it as the canonical dir.
