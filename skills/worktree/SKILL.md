---
name: worktree
description: Create or reopen a Git worktree from free-text intent, open its draft pull request in the background, and open it in a new background terminal tab running an interactive Pi; with --cloud, the checkout and Pi live on a Boat VM started through the workspace CLI. Use for /worktree, when a session starts a task that changes a repository (it hands the task to the new tab), to fork the current checkout, resume a branch in its own tab, work in the cloud, merge or close a PR, or clean dangling worktrees and tabs. Fuzzy-matches existing branches first and confirms before opening them. The terminal app is reached only through scripts/terminal, so switching terminals never touches this workflow.
---

# Worktree

For a merge or close request, complete the PR action and follow "Clean up ended pull requests". For cleanup alone, go directly to that section. Use the creation steps below for worktree requests.

Treat the whole argument as free text, not a literal branch name. A `--cloud` token anywhere in it selects cloud mode and is removed from the text: resolve the target as below, then follow [cloud.md](cloud.md) in place of "Place the worktree" and "Create or reuse", and load it now.

Before a hand-off, run `scripts/cleanup '<caller-checkout>'` from the main checkout. Continue creating the new worktree after reporting any skipped checkouts or cleanup failure.

**Hand-off**: when the current session starts a task of its own that changes a repository, skip the `target_branch` question (reuse the branch the task names, otherwise create one as step 4 derives) and run every step. In "Open the tab", write the brief to an OS-temp file and launch `pi @<brief file>` in place of bare `pi`; the brief holds the user's request verbatim, the facts the session already established, the branch, and that the draft pull request job is running. The session then stays the coordinator: it never edits the new checkout, reports the hand-off and ends its turn, and answers later questions about the task from its pull request and `git worktree list`. On exit 2 it works in the new checkout itself.

## Resolve the target

1. In the caller's checkout, batch current branch, `HEAD`, short status, and candidates from `git for-each-ref --format='%(refname:short)' refs/heads refs/remotes`. Exclude remote HEAD aliases, collapse local/tracking duplicates, and do not fetch. Save long output in an OS-temp file and read bounded portions. Uncommitted changes stay in the original checkout; mention them if present.
2. Match the free text against branch names with judgment: ticket IDs, intent, wording, abbreviations, likely typos. Prefer exact ticket matches over generic word overlap. Inspect a shortlisted branch's recent commit subjects only when names are insufficient. Never invent matches. With no argument, skip matching and fork the current `HEAD`.
3. If one or more plausible branches exist, ask once with the question tool (id `target_branch`): up to three candidates, the strongest recommended, plus "Create a new branch from current HEAD" and "Cancel". Ask even for an exact match. Mutate nothing while the answer is pending. Cancel stops the workflow. A confirmed branch uses its own tip, not the caller's `HEAD`.
4. With no plausible match, or when the user chose creation, derive the name without another question: `<type>/<ticket-if-present>-<kebab-description>`, dropping the ticket segment when absent. Pick the dominant type (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`); keep the ticket's spelling. Load repository branch conventions when they apply. With no text, derive the description from the current branch, using `worktree` for a detached `HEAD`. Append `-worktree-<YYYYMMDD-HHMMSS>` only on a name collision. Validate with `git check-ref-format --branch <name>`. Capture the caller's `HEAD` as the new branch's base; never switch to develop or pull.

## Place the worktree

- **Main checkout**: the first `worktree` entry of `git worktree list --porcelain`.
- **Path**: `<main-checkout>/<worktreeBaseDir>/<repo-basename>/<branch with "/" replaced by "-">`, with `worktreeBaseDir` read from `~/.pi/agent/extensions/subagent/config.json` (relative values resolve from the main checkout).
- When that base sits inside the repository and `git check-ignore -q <path>` fails, append `/<worktreeBaseDir>/` to `$(git rev-parse --git-common-dir)/info/exclude` so the main checkout stays clean.

## Create or reuse

Find the chosen branch's checkout in `git worktree list --porcelain`.

- **Already checked out**: reuse that checkout; never force a duplicate. If it is the caller's own checkout, say it is already open and stop.
- **Local branch, not checked out**: `git worktree add '<path>' '<branch>'`.
- **Remote-only branch**: check the local name is free, then `git worktree add --track -b '<local>' '<path>' '<remote-ref>'`.
- **New branch**: `git worktree add -b '<branch>' '<path>' '<captured-commit>'`.

On error, inspect the reported state before retrying. Never grant repository trust automatically.

Verify: `git -C <checkout> branch --show-current` names the branch, and its `HEAD` equals the captured base (or the confirmed tip).

## Open the draft pull request

Once the checkout exists, created or reused, start `scripts/draft-pr '<checkout>' '<title>' [<base>]` as a background job and go on without waiting. Its completion prints the pull request URL; a failure goes into the report while the worktree stays usable.

- **Title**: a Conventional Commit naming the task's single intention. It becomes the squash commit, so retitle the pull request when the intention changes.
- **Base**: omit it for the repository's default branch; pass the caller's branch when the work stacks on it.
- It pushes the branch, adding an empty `chore: start <branch>` commit when the branch has no commit of its own yet. Where a project `AGENTS.md` requires approval before a push, obtain it before starting the job.
- A branch that already has an open pull request gets its URL back, never a second one.

## Clean up ended pull requests

Run `scripts/cleanup [<repo-or-checkout>]` to sweep the repository's registered worktrees. It reports each checkout as removed or skipped, with a reason. Run it after merging or closing a PR. Creating a PR keeps its checkout and tab.

The cleanup script owns the safety checks. It preserves the main checkout, paths outside `worktreeBaseDir`, open PRs, dirty checkouts, commits GitHub does not hold, and tabs with working agents or unknown status. It also preserves tabs shared with terminals outside that checkout and agents awaiting background work. It fetches PR heads to prove commit ancestry even after a squash merge or remote branch deletion. Eligible local branches are deleted with their expected commit as a guard.

`extensions/tools/worktree-cleanup/` automatically runs the same script after bash calls containing `gh pr merge` or `gh pr close`, then retries asynchronously once the agent settles. A skipped checkout stays for the next sweep. A PR ended on GitHub is discovered at the next hand-off. Terminal inspection must succeed before any deletion, including when no tab exists. All Git operations run from the main checkout. The caller's checkout is handled last, and its tab closes only after Git cleanup finishes.

`scripts/cleanup --helper <worktree>` removes one worktree for the lifecycle sweeper (`~/.pi/agent/skills/agent-lifecycle/SKILL.md`). The `worktree` class of `~/.pi/agent/skills/agent-lifecycle/policy.json` states when it may go.

## Open the tab

```bash
~/.pi/agent/skills/worktree/scripts/terminal open --folder '<checkout>' --title "$(git -C '<checkout>' branch --show-current)" -- pi
```

It opens a tab beside the caller without moving focus, or reuses the tab already sitting in that folder, and prints one JSON line. Read [terminal-port.md](terminal-port.md) for the output fields, exit codes, and how to switch terminals; load it when the script fails or the user changes terminal.

- `created` with `ready: true`: Pi runs the hand-off brief, or waits at its prompt when the user asked for the tab. Never type into the tab afterwards.
- `created` with `ready: false`: report the terminal id as started but unconfirmed; never relaunch blindly or answer approval dialogs.
- `reused`: leave its processes alone; never start a second Pi.
- Exit 2: the caller is outside the configured terminal. Keep the worktree and report its path.

Report the branch, path, pull request, tab status, and Pi readiness, distinguishing creation from reuse. Install dependencies or start services only on request.
