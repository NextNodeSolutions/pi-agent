# Source

Vendored skill: `untangle-codebase` — lists every place where pieces that change together are apart or tied without reason, redesigns from first principles, fixes everything, re-scans until nothing is left. Adapted here to run unattended under `~/.pi/agent/AGENTS.md`.

- **Upstream repo**: https://github.com/caldoai/skills
- **Path in repo**: `skills/untangle-codebase/SKILL.md`
- **Revision**: `f3cf47774975a7d9fca45730babf4ff7ad765ada` (`f3cf477`, merge of PR #1, 2026-11-05)
- **Vendored on**: 2026-11-06
- **License**: MIT (`LICENSE` beside this file, unmodified, © 2026 Maze)
- **Invocation**: manual only (`disable-model-invocation: true` upstream, kept) → `/skill:untangle-codebase` in Pi, `/untangle-codebase` in Claude Code or a scheduled routine prompt

## Files vendored

`SKILL.md` (adapted, see below), `LICENSE` (unmodified).

## Kept verbatim from upstream

The opening sentence and "Why" bullets, the step-2 taxonomy (hidden links, needless links, surplus, special cases), the step-3 redesign paragraphs, the done criteria (now in step 6), the tips (moved into step 1 as the survey method), and the decision-log example (status markers added, one bug line and its `fixed` entry added).

## Local modifications (reapply on re-vendor)

1. Upstream step 1 "Ask" (Comments / Tests options) removed. Comments follow the `~/.pi/agent/AGENTS.md` comment rule on touched files only; the Tests option is dropped because test authoring is forbidden by that file. The run's only question is the grouped decision of step 6.
2. Step 0 gates added: clean checkout, project rules read, verification baseline recorded (the language's own compile command when the manifests name none), dedicated `refactor/untangle-*` branch. No compile and no test command → log-only run, no edit.
3. Step 2: a problem enters the list only after both ends of the code are read (subagent findings re-read); bugs met on the way are listed.
4. Step 3: `do` / `decision` classification, `do` by default. Each doubt (frozen surface, observable behaviour, no verification, diverging copies, project rule, test change) has one check to run; a fix is `decision` only when its check has failed. "Trivial", "budget", "process", bundled lines, and "intended behaviour" are not reasons. Dependency manifests and build config are not frozen; the lockfile moves only through the package manager.
5. Step 4: one Conventional Commit per fix, verification against the baseline failure set plus the fix's own check, fix-forward once then revert, three-revert cap, formatter on touched files only, tests follow code (import paths, call sites, declared fixture types) but are never adjusted. `--max-fixes` has no default: the run ends when nothing is left or the revert cap is hit.
6. Step 5 added: bugs are proven by a check; sure and local → `fix(<scope>)` commit; sure but product-facing → `decision`; not shown → one `suspected` line.
7. Step 6: re-scan until nothing is left, then one grouped multi-select question (`ask_user_question` in Pi, `AskUserQuestion` in Claude Code) for every `decision` item; picked items go through step 4, the rest are `declined`; with no human to answer, the items stay `decision` in the log and PR body.
8. Step 7 delivery contract: local branch by default, `--pr` for push plus pull request with the log as body, never merge or rewrite history; the report to the human is at most fifteen lines and links the log instead of pasting it.
9. Frontmatter `description` rewritten as a trigger; `argument-hint` extended with `--pr` and `--max-fixes`.
10. Subagent wording made harness-neutral (`subagent` in Pi, `Agent` in Claude Code); work files go to the OS temp directory.

Why 4 to 8 (2026-11-07): four runs on 2026-11-06/07 (infrastructure, syneva, yasmine, infrastructure-circleci) ended with 10 fixes each and 9 to 40 skipped items, most of them "budget", "frozen surface" for in-repo config, "trivial", or bugs left untouched; when the user asked for the skipped items to be fixed, 8 of 9 went through without a failure.

## Lineage

Replaces `improve-codebase-architecture` (vendored 2026-10-01 from https://github.com/mattpocock/skills at `d81f3a1`, path `skills/engineering/improve-codebase-architecture/`), removed on 2026-11-06: its human-oriented HTML report and grilling loop gave way to this unattended workflow. `codebase-design` (same upstream, same revision) was removed the same day: its vocabulary already lives in `coding/architecture.md`.

To update: re-copy upstream `SKILL.md` at a newer revision, reapply the local modifications above, and keep this file's revision and date current.
