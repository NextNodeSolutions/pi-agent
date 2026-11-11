# Terminal port

Extends "Open the tab" in `SKILL.md`; the workflow rules are not restated here.

`scripts/terminal` reads the adapter name from `terminal.conf` (one word) and runs `scripts/adapters/<name>` with the same arguments. Nothing else in the skill knows which terminal is in use.

## Switch terminal

1. Write `scripts/adapters/<name>` (executable) that honours the contract below.
2. Replace the word in `terminal.conf` with `<name>`.
3. Smoke-run both commands on a scratch folder with a local Pi, then close what they opened.

## Contract

Exit codes for every command: `0` success, `2` the caller is not inside this terminal, `3` the terminal cannot report agent status, `64` bad arguments, `1` anything else. Errors go to stderr as one line.

### `open`

```
<adapter> open --folder <absolute-dir> --title <tab-title> [--key <reuse-key>] -- <argv...>
```

- Open a new tab in the caller's window or space, titled `<tab-title>`, running `<argv...>` in `<absolute-dir>`.
- Never move focus: the user switches to the tab themselves.
- The program must outlive the caller's own terminal session.
- `<reuse-key>` defaults to `<absolute-dir>`. Record it on the terminal. When a live terminal in the caller's window carries that key, or (default key only) has `<absolute-dir>` as its working directory, start nothing and report it as reused.
- Wait a bounded time for the program to report readiness when the terminal can tell; never `sleep`.

stdout is one JSON line:

| Field | Value |
|---|---|
| `status` | `created` or `reused` |
| `terminal` | the terminal app's id for the program's terminal |
| `tab` | the terminal app's tab id, or `null` |
| `ready` | `true` / `false` after the readiness wait; `null` on reuse or when the terminal cannot tell |
| `app` | optional: the program the terminal detected |

## herdr adapter

- `open`: `hc run --bg --no-parent --keep` with the caller's `herdr.space` label and a fresh `herdr.tab` id, the program wrapped in `zsh -lc 'exec …'` so the tab inherits `.zshenv` (herdr-core itself runs from launchd without it): Herdr adopts the terminal as a background tab, then `herdr-app do tab.rename` sets its title. Readiness is `hc wait` followed by the terminal's reported `status.app`. The key is the `worktree.key` label; reuse scans `hc ls` live terminals through `hc get`, filtered to the caller's space.
