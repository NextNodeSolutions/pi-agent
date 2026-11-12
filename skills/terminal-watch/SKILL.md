---
name: terminal-watch
description: Watch a herdr terminal's live output (dev server, build, watcher, any long-running command) and audit every warning, error, crash or unexpected exit it raises, through a watcher this agent owns. Load when asked to monitor or watch a terminal or pane, when started as a Workbench monitoring pane, or when a `[terminal-watch]` alert arrives.
---

# Terminal watch

The watcher is a herdr child terminal of the agent that audits. `scripts/watch.mjs` follows the watched terminal across command restarts and types each alert into its owner's prompt, so the owner wakes without polling and the watcher ends with the owner's session. Each watched terminal has one watcher, owned by the agent that audits it, never by an agent the person prompts for other work.

Watch only through this skill's script. A hand-written loop or a Pi background bash job stops at its first alert or at a session reload.

## Start

```bash
scripts/terminal-watch start [<terminal>]
```

Without a terminal it picks the one shell in your herdr tab that runs no agent. It prints one JSON line whose `status` decides the next move:

- `started` or `reused`: you own the watcher. Tell the person which terminal you watch, then end the turn; the next alert starts your next turn.
- `owned-by-other`: another agent already watches it. Report its `owner` and stop; add `--take-over` only when the person asks you to take it over.
- Exit 64: no single free shell in your tab. Pass the terminal, or ask which one when several fit.

Never type into, resize, restart or interrupt the watched terminal: it belongs to the person. Read it with `herdr-core read <terminal> --lines <n>`.

## Alert kinds

- `warning/error`: a warning or error line while a command runs. Prompt lines, shell typos with no command running, and Ctrl+C fallout raise nothing.
- `command failed`: the command exited after printing errors.
- `long-running command exited`: it exited after a long run without errors or Ctrl+C, the way a dev server vanishes silently.
- `stopped`: the watched terminal ended or was removed, and the watcher exited with it.

A repeated headline is throttled; every alert still lands in `alerts.log`.

## On an alert

An alert arrives in your prompt as `[terminal-watch] <kind> in <terminal> (<command>): "<headline>". Block: alert <n> in <alerts.log>`.

1. Read alert `<n>` in that `alerts.log`: the output leading to the alert. Widen with `herdr-core read <terminal> --lines 300` when the block starts mid-trace.
2. Classify the cause: a person's action (Ctrl+C, typo, restart), the environment (missing secret, port in use, stale dependency), or a code fault.
3. For a code fault, follow the first stack frame inside the project, outside `node_modules`, to the source and read it.
4. Report the cause, its evidence as `file:line` or the quoted output line, and the smallest fix. The audit is done when one cause is named and backed by a line from the block or the source; a false alarm gets one sentence saying so.

Edit project files only when the person asks. The watcher keeps running; there is nothing to re-arm. Report a false alarm that recurs as a watcher fault: its fix belongs in `scripts/classify.mjs`, made only when the person asks, followed by a stop and a start.

## Stop and inspect

- `scripts/terminal-watch stop [<terminal>]` ends your watchers, all of them without a terminal. Herdr then notes the watcher's exit in your prompt; that note needs no action.
- A herdr note that your watcher exited, with no `stopped` alert before it and no stop of yours, means it failed: run `herdr-core read <watcher>`, then start again.
- `scripts/terminal-watch status` lists every watcher with its owner, phase and alert count.

Each watcher writes `output.log` (every new line, timestamped), `alerts.log` and `state.json` in the `dir` that `start` prints.
