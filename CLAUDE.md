# CLAUDE.md

This repo uses [Maina](https://mainahq.com) for verification-first development.
Read `.maina/constitution.md` for project DNA — stack rules, conventions, and gates.

## Maina Workflow

Follow this order for every feature:
`brainstorm -> ticket -> plan -> design -> spec -> implement -> verify -> review -> fix -> commit -> review -> pr`

## MCP Tools

Maina exposes MCP tools — use them in every session:

| Tool | When to use |
|------|-------------|
| `getContext` | Before starting — understand branch state and verification status |
| `verify` | After changes — run the full verification pipeline |
| `checkSlop` | On changed files — detect AI-generated slop patterns |
| `reviewCode` | On your diff — two-stage review (spec compliance + code quality) |
| `suggestTests` | When implementing — generate TDD test stubs |
| `getConventions` | Understand project coding conventions |
| `explainModule` | Understand a module's purpose and dependencies |
| `analyzeFeature` | Analyze a feature directory for consistency |
| `wikiQuery` | Search wiki for codebase knowledge — "how does auth work?" |
| `wikiStatus` | Wiki health check — article counts, staleness, coverage |

## Wiki

If `.maina/wiki/` exists, use wiki tools for context:
- `wikiQuery` before coding — understand existing patterns and decisions
- `wikiStatus` to check health
- Wiki articles are loaded automatically as Context Engine Layer 5

## Commands

```bash
# Workflow
maina brainstorm  # explore ideas interactively
maina ticket      # create GitHub issue with module tagging
maina plan <name> # scaffold feature branch + directory
maina design      # create ADR (architecture decision record)
maina spec        # generate TDD test stubs from plan

# Verify & Review
maina verify      # run full verification pipeline (12+ tools)
maina review      # two-stage code review
maina slop        # detect AI-generated slop patterns
maina commit      # verify + commit staged changes

# Wiki (codebase knowledge)
maina wiki init    # compile codebase knowledge wiki
maina wiki query   # ask questions about the codebase
maina wiki compile # recompile wiki (incremental)
maina wiki status  # wiki health dashboard
maina wiki lint    # check wiki for issues

# Context & Info
maina context     # generate focused codebase context
maina explain     # explain a module with wiki context
maina doctor      # check tool health
maina stats       # verification metrics
maina status      # branch health overview
```

## Conventions

- Runtime: bun
- Test: `bun test`
- Conventional commits (feat, fix, refactor, test, docs, chore)
- No `console.log` in production code
- Diff-only: only fix issues on changed lines
- TDD always — write tests first

## Constitution

Nine load-bearing rules live in `.maina/constitution.md` and are enforced
mechanically by `bun run constitution:check` (CI-gated in diff-only mode):

1. **Zero runtime overhead** — heavy direct deps need a `dep-justification:` line in the changeset.
2. **Standard Schema only** for validation in public signatures (no `ZodType<T>`).
3. **Every package wires `@workkit/testing`** in devDependencies (or opts out via `"//constitution-allow"`).
4. **Single `src/index.ts` export** per package; subpaths via `exports` map only.
5. **No cross-package imports** unless the target is in `dependencies`/`peerDependencies`.
6. **Changeset required** when `packages/*/src/**` changes (private packages exempt).
7. **No `console.log`** in `packages/*/src/**` (use `@workkit/logger`).
8. **Diff-only fixes** — change only the lines on the diff.
9. **TDD always** — tests precede implementation.

Escape hatches: `// constitution-allow:<rule> reason="..."` on the offending line. The CI report counts opt-outs so accumulated debt is visible.

Run locally before pushing:

```bash
bun run constitution:check                # full repo
bun run constitution:check -- --diff-only # only files changed since master
```
