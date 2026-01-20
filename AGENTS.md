# AGENTS.md

## Build

```bash
bun run build
```

## Test

```bash
bun test
bun run typecheck
```

## Release (version/tag sync)

When cutting a release, keep **`package.json` version** and the **git tag** in sync:

- `package.json` version: `X.Y.Z`
- git tag: `vX.Y.Z`

Recommended flow:

```bash
# 1) Bump version in package.json

# 2) Verify
bun test
bun run typecheck
bun run build

# 3) Commit + tag (tag should match package.json)
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")

git commit -am "chore(release): v$VERSION"
# or if you want explicit paths:
# git add -- package.json src/... && git commit -m "chore(release): v$VERSION" -- package.json src/...

git tag -a "v$VERSION" -m "v$VERSION"

# 4) Push
# git push && git push --tags
```

## Code

- TypeScript with strict mode
- ES modules
- Root entry: `src/index.ts`
- Tests in `tests/`

## Style

**Deep primitives**: Plain data structs with standalone functions.

Core primitives:
- `LlmRequest` / `runLlm` — single model invocation
- `Ensemble` / `runEnsemble` — parallel LLM calls
- `Judge` / `runJudge` — select best candidate
- `Verification` / `runVerification` — fact-checking (Chain-of-Verification)

**Deep thinking pipeline**:
- `Solver` — runs with a reasoning strategy (8 categories: analytical, creative, systematic, strategic, evaluative, contextual, empirical, reflective)
- `Persona` — config wrapper (navigator-plan, navigator-chat, reviewer)
- `Session` — state isolation for concurrent agents

**Principles**:
- Inline until duplication appears
- Additive over invasive evolution
- Let callers drive control flow (callbacks optional, provide immediate-mode)
- Derive data, don't store it
