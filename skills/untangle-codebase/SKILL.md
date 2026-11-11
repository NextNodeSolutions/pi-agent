---
name: untangle-codebase
description: Refactor a codebase unattended so agents read less per change, break less without noticing and debug faster. Lists every place where pieces that change together are apart or pieces that change apart are tied, redesigns from first principles, turns every doubt into a check instead of a skip, fixes every verified problem and every sure local bug in one verified commit each on a dedicated branch, re-scans until nothing worth fixing is left, and asks one grouped question at the very end only for the fixes a business rule or a product behaviour might forbid. Load for "untangle", "untangle-codebase", "refactor the whole codebase", "clean up the structure", a scheduled hygiene run, or any request to cut coupling, copies, wrappers, workarounds or dead code across a repository. Not for one bug, one feature, or designing a single module's interface (that is the `coding` skill).
disable-model-invocation: true
argument-hint: "[area or concern to focus on] [--pr] [--max-fixes N]"
---

# Untangle codebase

Start a thorough refactor of this codebase and complete it to the end. Treat this as a goal.

The run is unattended until its last step. **A doubt is never a reason to skip: it is a check to run, and the fix goes ahead when the check passes.** The only question of the run is the grouped decision of step 6, for the fixes no check can settle because a business rule or a product behaviour is in play. The outputs are commits on a dedicated branch, the decision log, one short report, and a pull request when `--pr` is given.

**Why do this at all?**

- **Better output:** agents write better code in a well-structured codebase.
- **Cheaper & faster changes:** agents spend fewer tokens searching and more on the problem.
- **Fewer silent breaks:** agents break less without noticing.
- **Faster debugging:** agents find root causes faster.

**Arguments**

| Argument | Effect | Default |
| --- | --- | --- |
| area or concern | Steps 1 and 2 scan only that area; a fix still updates callers anywhere. | Whole repository, hot spots first. |
| `--pr` | Step 7 pushes the branch and opens a pull request. | Branch stays local, nothing is pushed. |
| `--max-fixes N` | Step 4 stops after N committed fixes; the rest of the `do` list is logged `capped`. | No cap. The run ends when nothing worth fixing is left or the revert cap is hit. |

`~/.pi/agent/AGENTS.md` (Development, Tests, Git) and the project's own rules (`AGENTS.md`, `CLAUDE.md`, repo skills) apply unchanged and outrank this skill. The steps below say where this refactor meets them.

## 0. Gates

Check in order before touching anything. The first gate that fails ends the run with a report naming it; a run never starts half-way.

1. **Clean checkout.** Inside a git repository, `git status --porcelain` empty. The current HEAD is the base.
2. **Project rules read.** Root and nested `AGENTS.md` / `CLAUDE.md`, repo skills, ADRs. A fix they forbid goes to the decision of step 6, never to a silent skip.
3. **Verification exists.** From the manifests and CI config (`package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, workflow files), record the exact commands for compile or typecheck and for the existing test suite; lint and format commands too when present. Lint alone is not verification. When the manifests name no compile step for a language the repository contains, use the language's own (`tsc --noEmit`, `python -m compileall`, `cargo check`, `go vet`). Run the verification once: this is the **baseline**, recorded as the exact set of failures (test names, error locations). An area the baseline commands do not reach (another language, a `tools/` folder) is not skipped for that: it gets its own check in step 3. No compile and no test command of any kind → the run does steps 1 to 3 only, writes the decision log, edits nothing, and reports that.
4. **Dedicated branch.** `git switch -c refactor/untangle-<yyyymmdd-HHMM>` (append `-<area>` when focused). Never commit on the base branch.

## 1. Survey

Read-only. Work files go to `<tmpdir>/untangle-<repo>-<timestamp>/` (`$TMPDIR`, else `/tmp`), never into the repository.

- **Start from a skeleton:** script away the function bodies (keep imports, exports, signatures, types), so the whole codebase fits in context.
- **Check the dependency graph often:** script one that shows what imports what, and rerun it as you go.
- **Use Git as evidence:** `git log --name-only` over a long stretch gives hot spots (files that keep changing) and co-change (files that change in the same commits while living in different folders: a hidden link until proven otherwise).
- **Summarize with subagents:** the harness's subagent tool (`subagent` in Pi, `Agent` in Claude Code) summarizes areas in parallel, each returning problems in the decision-log line format, not prose.
- **Enter where leverage is highest:** start looking there first.
- **Keep the decision log on disk** and reread it after a compaction.

## 2. List every problem

Don't change anything yet.

Go through the codebase asking one thing: **should these pieces change together?** Write down every place the code gets the answer wrong, one line per problem with `path:line`, as in the [decision log example](#decision-log-example). A line enters the list only after you have read the code at both of its ends (the copy and its original, the caller and the callee): a subagent's finding is re-read before it enters, and a finding the code does not bear out is dropped. There are only three ways to get it wrong.

**Hidden links:** pieces that must change together, where the code doesn't show it.

- Copies of logic or values: change one and the others must change too, but nothing says so.
- A module that reads a global or file set by another module: change that module and this one breaks, but nothing shows it (self-contained code).
- A feature split across folders by layer, or related code in different folders: one change needs all of them, but the layout hides that (domain-driven code, colocation).
- A call order or convention callers just have to know: change it and callers break, but nothing warns them (explicit over implicit).

**Needless links:** pieces tied together that change for different reasons.

- Callers that depend on internals: the internals change for their own reasons, and the callers break anyway (encapsulation).
- Stable code that imports something more volatile: the stable code has to change whenever the volatile code does (dependency direction).
- A general function with a parameter only one workflow understands: the function has to change whenever that workflow does (caller vocabulary).
- A shallow module: its interface changes whenever its internals do, so its callers change with it (deep modules).

**Surplus:** pieces with no reason of their own to change.

- Wrappers: they only change when the thing they wrap does (pass-through wrappers).
- Extension points and config for things that never vary: nothing will ever change them (speculative generality).
- Dead code: nothing uses it, so nothing will ever need it to change.

Also write down every **special case**: code that exists for one situation instead of following from how the system works. Each one is a requirement the design never accounted for, so use them to work out what the system needs to be.

- An `if` for one value
- A parameter for a specific caller
- A swallowed exception
- A retry or sleep
- A disabled test

Also write down every **bug** met on the way: code whose result contradicts its own name, comment or type, a doc, or a project guarantee. One line, `path:line`, what it does, what it should do. Bugs are handled in step 5.

## 3. Redesign from first principles

Work out the fixes as if the system had known today's requirements from the start. Look for the one fix behind several problems, which often looks nothing like them. Don't fix special cases one by one.

Ask the same thing of every fix, even one that looks better in the code: pieces that change together end up together, pieces that don't aren't tied, and everything depends on what changes less.

Write each fix above the problems it solves, as in the [decision log example](#decision-log-example). Order the fixes: a fix another fix needs comes first, then by problems solved per fix.

Mark every fix `do` or `decision`. **`do` is the default.** A fix becomes `decision` only after the check for its doubt has been run and has failed; the check and its result go on the fix's line. One doubt, one check:

| Doubt | Check to run | `do` when | `decision` when |
| --- | --- | --- | --- |
| **Frozen surface** (something outside the repository depends on it) | Name the consumer outside the repository: the package's `exports`, `bin` and `main` plus its publish config; a route a client calls; a CLI flag a workflow in another repository runs; database schema and migrations; persisted file and message formats; environment variable names in deployment config; CI workflow files. Grep the repository and its CI config for the symbol, flag or route. | Every consumer is inside the repository: the fix updates it. Dependency manifests, `tsconfig`, bundler and task-runner config live in the repository and are not frozen; the lockfile moves only through the package manager. | A consumer outside the repository exists and is named on the line. |
| **Observable behaviour** | Name what observes it: a test, a doc guarantee, a user-visible output, a log line something parses, a value something stores. | Nothing observes it: an internal event order, a message nothing matches on, a dead branch proven unreachable by the types or the schema. A special case goes when the redesign handles its situation and the situation still works. | Something named observes it and the redesign does not keep its situation working. |
| **No verification covers it** | Build one in the work directory, never in the repository: compile or import the area, run the program on the repository's own fixtures or in dry mode, diff its output before and after (build output, generated files, rendered text, the shader or template text inside the bundle). | The before and after outputs are equal, or differ only by the intended change. | No equal-output check can exist (a picture judged by eye, a device-only behaviour): the line names the check the human must run. |
| **Diverging copies** | Find the right copy: the doc, the callers' expectation, `git log -L` on each copy (which changed last, in which commit, why). | One copy is right with that evidence: merge onto it. | The copies encode different intentions and nothing says which holds: the line shows both values and where they diverge. |
| **Project rule** | Quote the rule's line. | The rule does not cover this fix. | The rule forbids it, whether as a guarantee or as a "stays as is until asked" line. The decision names the rule. |
| **A test would change** | Separate what follows the code from what changes meaning. | The test changes only import paths, call sites, or the declared type of a fixture value whose meaning stays. | An assertion, a snapshot, or a fixture's meaning would change while the code it tests survives. |

Never a reason: "trivial" (do it), "budget" (there is none without `--max-fixes`), "process" (a review, a canary or a probe run required before merging belongs to the pull request, not to the fix), or one line that bundles several fixes. "Intended behaviour" and "kept by design" are not fixes at all: the line leaves the fixes section, it was not a problem.

## 4. Fix everything marked `do`

One fix at a time, in order:

1. Apply the fix across all its problems and update every caller in the repository. No shim, no compatibility re-export, no deprecated path: the old shape disappears.
2. In the files the fix touched, apply the `~/.pi/agent/AGENTS.md` comment rule, and run the project's formatter when one is configured. Never reformat an untouched file.
3. Existing tests follow the code: import paths, call sites and declared fixture types of moved, renamed or retyped code are updated, and a test file whose subject was deleted goes with it. Nothing else in a test changes: no new test, no edited assertion, no updated snapshot, no skipped case. A test that fails after a fix is a regression, never a test to adjust.
4. Run the verification commands, plus the check built in step 3 when the fix has one. The fix passes when no failure outside the baseline set appears and the check holds.
5. On failure, fix forward once. On a second failure, discard this fix's uncommitted work with `git restore --staged --worktree . && git clean -fd` (safe because gate 1 guaranteed a clean tree and every commit is a fix), and mark the fix `reverted` with the failure. Three reverts in one run stop step 4: the redesign is wrong somewhere, the log says where, and the remaining `do` fixes are logged `capped: reverts`.
6. On success, commit: `refactor(<scope>): <the fix in one line>`, body = the `path:line` problem lines it solves. Then rerun the dependency graph.

Stop step 4 when every `do` fix is processed, `--max-fixes` is reached, or the revert cap is hit.

## 5. Fix the sure bugs

For each bug of step 2, run the check that proves it: a command, an expression, or a reading of the types or schema whose result contradicts the name, comment, type, doc or guarantee. Then:

- **Sure and local:** the check shows the wrong result, and the fix is one place with callers unchanged, no new abstraction, and covered by the verification plus the check. Fix it now, one commit `fix(<scope>): <what was wrong>`, body = the check with its result before and after. Mark `fixed <sha>`.
- **Sure, not local, or product-facing:** the fix changes what a user sees, what is written, who may do what, an amount, a rule. Mark `decision`, line = the check, the wrong result, the proposed fix.
- **Not shown:** the check could not be run or did not show the wrong result. One line `suspected`, with the check a human can run. Nothing else.

## 6. Check, repeat, then decide

Have subagents search again for special cases, hidden links, needless links, surplus and bugs, in the changed areas and across the repository. New problems go through steps 3 to 5 again, with the same checks. **Do not stop until there is nothing worth fixing left**, or a cap from step 4 ends the run.

You're done scanning when:

- **As few special cases are left in the system as possible.** How many remain is the best measure of how close you are.
- A typical change lands in one place.
- Every import is reasonable, and nothing imports anything more volatile than itself.
- Subagents have no issues left that are worth fixing.
- Intended behavior is the same as when you started. The verification run on the branch tip passes against the baseline set.

Then the one question of the run, when any fix or bug is `decision`:

- Ask once with the harness's question tool (`ask_user_question` in Pi, `AskUserQuestion` in Claude Code): one multi-select question, one option per `decision` item, each option = the fix in one line, what it changes, and the check or rule behind the doubt. More items than the tool takes → batches, most problems solved first.
- Every item the human picks goes back through step 4 as `do`; when the pick lifts a project rule, the rule's line changes in the same commit. Every item the human leaves out is marked `declined`.
- No human can answer (a scheduled routine, `pi -p`, the tool unavailable): the items stay `decision` in the log and in the pull request body; nothing else changes.

## 7. Deliver

- The decision log in its final form, every fix marked `done <sha>`, `fixed <sha>`, `reverted: <failure>`, `capped: <cause>`, `decision: <doubt · check · result>`, `declined`, or `suspected: <check>`, saved in the work directory.
- With `--pr`: push the branch and open a pull request titled `refactor: untangle <area or codebase>` whose body is the decision log. Without `--pr`: nothing is pushed.
- Never merge, force-push, touch another branch, or rewrite history.
- The report to the human is at most fifteen lines: branch and tip; verification on the tip against the baseline, one line; count of `done`, `fixed`, `reverted`; each open `decision` or `suspected`, one line; whether the branch is ready to merge or what blocks it (the project's pre-merge requirements, a check only a human can run); the path of the log or the pull request link. The log is linked, never pasted.

<a id="decision-log-example"></a>**Decision log example**

The list of problems:

```md
- `ui/LogoutDialog.tsx:30` waits 100ms after closing and hopes the message input can take focus by then.
- `ui/Toolbar.tsx:40` and `ui/Menu.tsx:22` call the same actions, each with its own check for when they're disabled.
- `checkout/submit.ts:9` depends directly on `payments/stripe.ts`.
- `shortcuts/keymap.ts:18` has a switch with one case per action, separate from the menu's list.
- `ui/CommandPalette.tsx:55` keeps its own list of actions, and it's missing the newer ones.
- `ui/SettingsDialog.tsx:61` sets a global `skipRefocus` flag to stop the logout dialog it opens from sending focus to the message input.
- `history/undo.ts:30` has a special case for every action that can be undone.
- `refunds/refund.ts:22` wraps every Stripe call in `if (order.provider === "paypal")`.
- Every action handler has to call `track()` by hand, and some don't.
- `ui/Toolbar.test.tsx` and `ui/Menu.test.tsx` test the same actions separately.
- Bug: `shortcuts/keymap.ts:30` sends `Cmd+Z` to redo on macOS; the modifier test reads `shiftKey` before `metaKey`, against the shortcut table in `docs/shortcuts.md`.
```

Then with the fixes, in their final state:

```md
- done 3f2a9c1 · Make the general `Dialog` give focus back to whatever had it before it opened, so the wait and the flag can both go.
  - `ui/LogoutDialog.tsx:30` waits 100ms after closing and hopes the message input can take focus by then.
  - `ui/SettingsDialog.tsx:61` sets a global `skipRefocus` flag to stop the logout dialog it opens from sending focus to the message input.
- decision: diverging copies · `git log -L` shows a PayPal refund refused on purpose (commit 4e1c2a0, "PayPal disputes are manual") while a Stripe refund is partial; no test covers refunds · Define a `PaymentProvider` interface that Stripe and PayPal both implement, so checkout and refunds no longer know which one they're using.
  - `checkout/submit.ts:9` depends directly on `payments/stripe.ts`.
  - `refunds/refund.ts:22` wraps every Stripe call in `if (order.provider === "paypal")`.
- done 8c41d07 · Make every user action a command with a name, a handler and an undo, so the toolbar, menu, shortcuts, palette and undo history all run from one list.
  - `ui/Toolbar.tsx:40` and `ui/Menu.tsx:22` call the same actions, each with its own check for when they're disabled.
  - `shortcuts/keymap.ts:18` has a switch with one case per action, separate from the menu's list.
  - `ui/CommandPalette.tsx:55` keeps its own list of actions, and it's missing the newer ones.
  - `history/undo.ts:30` has a special case for every action that can be undone.
  - Every action handler has to call `track()` by hand, and some don't.
  - `ui/Toolbar.test.tsx` and `ui/Menu.test.tsx` test the same actions separately.
- fixed 5b7e0d2 · `Cmd+Z` undoes on macOS. Check: `commandFor({ metaKey: true, key: "z" })` returned `redo`, now `undo`, as `docs/shortcuts.md` lists.
  - `shortcuts/keymap.ts:30` sends `Cmd+Z` to redo on macOS; the modifier test reads `shiftKey` before `metaKey`.
```
