---
name: worktree
description: Create or reopen a Git worktree from free-text intent, open its draft pull request in the background, and open it in a new background terminal tab running an interactive Pi; with --cloud, the checkout and Pi live on a Boat VM started through the workspace CLI. Use for /worktree, before the current session starts work on a branch, for requests to fork the current checkout, to resume a branch in its own tab, or to work on a branch entirely in the cloud. Fuzzy-matches existing branches first and confirms before opening them. The terminal app is reached only through scripts/terminal, so switching terminals never touches this workflow.
---

# Worktree

Treat the whole argument as free text, not a literal branch name. A `--cloud` token anywhere in it selects cloud mode and is removed from the text: resolve the target as below, then follow [cloud.md](cloud.md) in place of "Place the worktree" and "Create or reuse", and load it now.

**Own task**: when the current session needs a branch for its own work, skip the `target_branch` question (reuse the branch the task names, otherwise create one as step 4 derives) and skip "Open the tab": the session itself moves its work into the new checkout.

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

## Open the tab

```bash
~/.pi/agent/skills/worktree/scripts/terminal open --folder '<checkout>' --title '<branch>' -- pi
```

It opens a tab beside the caller without moving focus, or reuses the tab already sitting in that folder, and prints one JSON line. Read [terminal-port.md](terminal-port.md) for the output fields, exit codes, and how to switch terminals; load it when the script fails or the user changes terminal.

- `created` with `ready: true`: Pi waits at its prompt. Never submit the ticket or start implementation.
- `created` with `ready: false`: report the terminal id as started but unconfirmed; never relaunch blindly or answer approval dialogs.
- `reused`: leave its processes alone; never start a second Pi.
- Exit 2: the caller is outside the configured terminal. Keep the worktree and report its path.

Report the branch, path, pull request, tab status, and Pi readiness, distinguishing creation from reuse. Install dependencies or start services only on request.
