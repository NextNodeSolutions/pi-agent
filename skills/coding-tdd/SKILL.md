---
name: coding-tdd
description: >-
    Test pace for reproduced behavioural bugs, new units that branch on input
    or state, and explicitly authorized test work. Load before authoring a
    test. Authorization lives in AGENTS.md under Tests, enforced by test_pace.
---

# Test pace

## Obtain the verdict

Follow `~/.pi/agent/AGENTS.md` under Tests. Use `test_pace` before adding a test without explicit human authorization. With `none`, prove the change through a runnable command, API call or real flow and proceed without test authoring.

For Claude Code, run the same decision with `node --experimental-transform-types ~/.pi/agent/bin/test-pace.ts --session <current transcript JSONL> --intent <named production bug or requirement> <exact test paths...>`. The script reads the human request from the transcript. Its output is a decision, not a Pi session grant.

## Follow the pace

| Verdict | Work order |
|---|---|
| `bug` | Reproduce the defect through a public interface. Write one test naming it. Run it and show red, apply the smallest fix, then show green. |
| `logic` | State each observable requirement. Write one failing test for the next requirement, implement enough to pass, then refactor with the test green. Repeat only for another stated requirement. |
| `none` | Build directly. Run the existing checks that cover the change. |

For explicitly authorized work outside these verdicts, follow the user's scope. Build prototypes and glue directly before locking an accepted requirement. A behaviour-preserving refactor uses the existing suite.

## Keep the cycle small

- Exercise the public input and output. The named bug or requirement is the test's title.
- Show the failing assertion before the fix. An unrelated runner, import or environment failure does not reproduce the bug.
- Run the single case or file during the cycle. Run the required suite once before presenting or committing.
- Refactor only after green. A new requirement starts a new failing test.
- Read `~/.pi/agent/skills/coding/testing.md` before authoring. It owns falsifiability, independent expected values, boundary fakes and determinism.

Failure contracts: `~/.pi/agent/skills/coding-error-design/SKILL.md`. Dependency boundaries: `~/.pi/agent/skills/coding-boundaries/SKILL.md`.
