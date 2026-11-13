---
name: agent-lifecycle
description: Close finished hc agent terminals without losing unread results or conversations. Load when inspecting automatic closes, keeping a terminal open, reopening a closed conversation, or enabling the Command Center sweeper.
---

# Agent lifecycle

Read the policy with `agent-lifecycle policy`. [policy.json](policy.json) owns the class table, delays and explanations. Code and this command read that file. Change the policy there, not in another agent's brief.

## Inspect, keep or resume

- `agent-lifecycle sweep` lists every live terminal and why it stays or would close. It changes nothing. `--apply` enables closing and helper-worktree cleanup.
- `agent-lifecycle closed` prints the closed index and its path under `$XDG_STATE_HOME/agent-lifecycle`, or `~/.local/state/agent-lifecycle`. The index links traces and records worktrees kept on disk with their reason.
- `agent-lifecycle keep <terminal>` keeps it open. `--off` releases it.
- `agent-lifecycle reopen <terminal>` resumes its saved conversation. Names and addresses from the closed index work. Repeating it returns the already reopened terminal.

A helper whose working folder was removed needs that folder recreated from the branch recorded in the index before reopening. A terminal with no resume command keeps its last screen through `hc read <terminal>`.

## Enable in the Command Center

The Command Center mod runs `agent-lifecycle sweep --apply` from `~/.config/herdr-app/mods/command-center/autoclose.js` on its thread poll, without overlapping runs. It does nothing while `~/.pi/agent/bin/agent-lifecycle` is missing, and notifies once when a sweep fails. Turn it off by removing its `this.refresh("lifecycle", …)` call from `pollThreads` in that mod's `main.js`.

The mod passes every terminal the Command Center shows as attached. The engine also checks Herdr's current tab and focused agent. A failed attention query refuses closing. Use `--no-window` only for a scratch core that no Herdr window shows. Direct `hc attach` viewers outside Herdr are not reported by hc's terminal API. Keep such a terminal explicitly before attaching.

Claude Code publishes pending work through `~/.claude/hooks/herdr-waiting.sh`, run by its `SessionStart` and `Stop` hooks. Pi publishes its own pending work, open goal items, session file and successful screen reads through `~/.pi/agent/extensions/ui/herdr-status/`. A turn that ended while waiting for a person's answer must retain an open goal item. Claude Code tasks waiting for a person after an ordinary turn need `agent-lifecycle keep` because Claude has no shared goal checklist.

## Verify changes

Use a separate `HC_SESSION` and scratch XDG paths. Run `scripts/agent-lifecycle sweep --no-window --policy <scratch-policy>` before applying it there. Shorten delays in the scratch policy, not in the source. Check eligible and protected terminals, the two-sweep screen confirmation, trace-before-close, Pi and Claude resume, and dirty, unpublished and occupied helper worktrees. Keep live terminals read-only until the proposed close list is approved.
