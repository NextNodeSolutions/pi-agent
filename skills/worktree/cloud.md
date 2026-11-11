# Cloud mode

Extends `SKILL.md` for `--cloud`; target resolution, the tab outcomes and the report are not restated here. The branch, its checkout and Pi all live on a kept Boat VM, one per branch, created or resumed through the `workspace` CLI (`~/Development/tools/workspace`) with its `pi` profile. Nothing is created in the local checkout.

## Before starting

- `boat --no-update status --json` must show `account.signedIn: true`. When signed out, stop and ask the user to run `! boat login`; never start the login yourself.
- Uncommitted changes stay on this machine; say so when the caller's status is dirty. Local commits do travel, through a Git bundle, so nothing is pushed.

## Check out on the VM

Pick the start from the resolved target:

| Target | Flag |
|---|---|
| New branch | `--from HEAD` |
| Confirmed local branch (checked out locally or not) | `--from '<branch>'` |
| Remote-only branch | `--track '<origin/branch>'` |

```bash
~/.pi/agent/skills/worktree/scripts/cloud-checkout --repo "$PWD" --branch '<branch>' --from HEAD
```

It derives the VM name from the branch, runs `workspace start <vm> --profile pi -d` (which resumes a stopped VM and brings its Pi up to date), clones `origin` over HTTPS into `/home/user/<repo>`, ships the commits `origin` lacks as a bundle, and creates or switches to the branch. It verifies the branch and, for a new branch, that `HEAD` equals the base. stdout is one JSON line with `status` (`created` or `reused` branch), `vm`, `id`, `path`, `branch`, `head`, `base`, `vm_existed`. A branch already on the VM is switched to, never reset.

## Open the tab

```bash
~/.pi/agent/skills/worktree/scripts/terminal open --folder "$PWD" --title '<branch> (boat)' --key 'boat:<vm>' \
  -- ~/.pi/agent/skills/worktree/scripts/cloud-session '<vm>' '<path>'
```

The key keeps the cloud tab apart from a local tab in the same folder.

**A VM runs only while a `cloud-session` holds a session on it.** `cloud-checkout` stops the VM itself when it fails after starting it. When `open` fails, run `workspace stop <vm>` before reporting, and say so.

## What `cloud-session` does

It runs in the tab on this machine and leaves the VM's uptime to `workspace`:

- Runs `workspace start <vm> -- bash -lc 'cd <path> && exec pi -c'`, which resumes the VM, opens the session through workspace's own terminal and stops the VM when Pi exits or when nothing passes through the terminal for the idle duration (`idle` in `~/.config/workspace/config.toml`, `workspace start --help` gives the default). Keystrokes count, so a prompt being typed never stops it. The tab keeps Pi's last screen, and herdr keeps the tab's last status, so a `blocked` question still shows as needing attention.
- Then it asks for a reply in the tab: a reply resumes the VM and runs `pi -c -- '<reply>'`; Enter alone resumes; Ctrl-D closes and leaves the VM stopped. A resume right after a stop waits for Boat to finish the snapshot (up to a few minutes).
- A lost connection ends the session the same way: `workspace` stops the VM and the reply prompt follows. The tab closing stops the VM through `workspace stop <vm>`. A failed `workspace start` stops the VM as a precaution, keeps its message on screen, and offers Enter to retry or Ctrl-D to close.
- Every stop waits until Boat reports the VM stopped; when that fails the tab prints `stopping <vm> FAILED` with the command to run by hand, and Ctrl-D at the reply prompt stops it again before closing.
- Boat's TTL stays the backstop for anything this machine cannot do: if it sleeps, the VM runs until its TTL.

## Report

Add the VM name and id, and how it stops: after the idle duration, when Pi exits or the tab closes, or at the TTL (8 h by default in `~/.config/workspace/config.toml`). `workspace stop <vm>` stops it at once; `/worktree --cloud <same intent>` reopens the tab and resumes it.
