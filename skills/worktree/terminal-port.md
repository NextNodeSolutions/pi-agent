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

- Open a new tab in the caller's window, titled `<tab-title>`, running `<argv...>` in `<absolute-dir>`.
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

`open` compares Git common directories to find the target project's space, preferring the caller's space when it belongs to that repository. Identify each space from its first terminal's foreground cwd, or shell cwd when no foreground cwd is reported. Ignore the space's saved creation folder. Derive the project name from Git's first registered worktree, so linked worktree folder names never become project names. Non-Git folders keep the caller's space.

Herdr's CLI omits the explicit-name flag. Pin an existing space with `space.rename` only when its displayed name equals the live checkout basename or the project name. Preserve other names. A custom name identical to the checkout basename is indistinguishable from an automatic name and will become the project name. When no space belongs to the repository, use a fresh space id and name the adopted space by the same rule.

`hc run --bg --no-parent --keep` uses the chosen `herdr.space` and a fresh `herdr.tab` id. Wrap the program in `zsh -lc 'exec …'` so the tab inherits `.zshenv`, since herdr-core runs from launchd without it. Herdr adopts the terminal without moving focus. `tab.rename` sets the requested branch title. Readiness is `hc wait` followed by the terminal's reported `status.app`.

The `worktree.key` label identifies reusable terminals. Scan live terminals through `hc ls` and `hc get` in the chosen space and, for terminals whose shell cwd matches the target folder, the caller's space. Reused terminals keep their existing space, title and processes. Pin their space only when its first terminal belongs to the target repository.
