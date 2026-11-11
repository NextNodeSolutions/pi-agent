---
name: dotfiles-sync
description: >-
    Sync dotfiles changes into the chezmoi source repo: add new config files,
    re-add modified ones, commit and push. Use when the user asks to update,
    save, back up, or sync dotfiles or configuration.
---

# Dotfiles Sync

Direction rule: the Mac Studio is the source of truth — this push skill belongs there. The MacBook Pro only receives: bring it up to date with `dotfiles-pull` (remote is truth, pull without exception).

Keep the chezmoi source repo (`~/.local/share/chezmoi`, remote `walid-mos/dotfiles`) in sync with the live config. chezmoi runs in the default (copy) model: the source is the single truth, live files are copies.

`~/.pi` is outside chezmoi: `~/.pi/agent` is a checkout of the public `NextNodeSolutions/pi-agent` repository. Commit Pi changes there with Git, under its `README.md` and `ARCHITECTURE.md`; never `chezmoi add` anything under `~/.pi`. Its `client/` overlays stay on their machine — the dotfiles repo is public too.

## Procedure

**1. Scope.** List managed top-level targets:

```bash
chezmoi managed | cut -d/ -f1 | sort -u
```

Only work inside these trees. Bringing a NEW top-level folder under management requires explicit user confirmation first.

**2. Candidates.**

- New files: `chezmoi unmanaged` (it already respects `.chezmoiignore`)
- Modified managed files: `chezmoi status`
- Deleted live targets: `chezmoi status` lines whose first column is `D` (the source still carries a file the live config no longer has); normally already empty, since `chezmoi-reconcile` runs at every Pi and Claude Code session start and stop

**3. Classify** every candidate against `.chezmoiignore` in the source repo:

- Legitimate config → propose ADD
- Volatile (state, caches, logs, sessions, `node_modules`, binaries, secrets, tokens, credentials, `*.local`) → propose adding a pattern to `.chezmoiignore`
- Ambiguous → ask the user
- Deleted live target → propose FORGET. Never FORGET a target that still exists live: that unmanages it instead of recording its removal.

Never re-ignore something already ignored; never remove an ignore entry without asking.

**4. Confirm.** Present a summary table (ADD / RE-ADD / FORGET / IGNORE with full paths), then wait for explicit approval. Deny-list beats everything: a file matching `.chezmoiignore` is never committed, even if the user says "add everything".

**5. Execute only the approved paths.**

```bash
chezmoi add <approved-dest-paths...>       # enumerate new files, never a whole tree
chezmoi re-add <approved-dest-paths...>    # modified managed files
chezmoi forget <approved-dest-paths...>    # live targets deleted on purpose: drops them from the source
# update .chezmoiignore only if approved
chezmoi git -- status --short
chezmoi git -- add -- <approved-source-paths...> # include .chezmoiignore only if approved
chezmoi git -- diff --cached --check
chezmoi git -- diff --cached --stat
```

Inspect the staged diff and remove any unapproved or secret path from staging before committing. Then branch, commit and merge as `AGENTS.md` at the chezmoi source root says: read it before the first commit.

## Rules

- Never `chezmoi add` a whole directory blindly - enumerate leaf targets (`node_modules` trap).
- Secrets/tokens/credentials: never add, never echo content, never commit.
- The deny-list lives in the repo (`.chezmoiignore`), not in this skill - keep it that way.
