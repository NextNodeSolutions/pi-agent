---
name: tailnet-links
description: Turn a file, a directory or a local server into an HTTPS link that opens on every device of the human's tailnet, with the `tailnet-link` command. Load before starting or sharing a dev server, before linking something Pi's final message does not convert by itself (a directory, a file named mid-turn, any link made outside Pi), when a link or preview does not open, and when setting links up on a new machine or cloud VM.
---

# Tailnet links

`tailnet-link <target>...` prints one HTTPS URL per target. Run it on the machine that holds the target. The URL names that machine and opens from the MacBook, the phone and every other device signed in to the human's tailnet, whichever machine the agent runs on.

| Target | What the URL opens |
|---|---|
| A file | A published copy. Markdown renders as a page with tables, code and Mermaid, and `?raw` returns the source. |
| A directory | A published copy of the tree. It shows its `index.html`, or a listing when it has none. |
| A port or a `localhost` URL | The running server over HTTPS, with the path and query kept. |

`tailnet-link --help` lists the other commands. `tailnet-link status` shows what this machine serves.

## What Pi converts by itself

Pi sends the final message of a turn through `tailnet-link` before the human sees it. Write the real path or the `localhost` URL there and the human gets a link.

- A document that exists becomes a link. An absolute or `~/` path converts anywhere in the text. A path relative to the session directory converts inside a code span or as a Markdown link target. `DOCUMENT_SUFFIXES` in `scripts/links.py` names the file types.
- A `localhost` or `127.0.0.1` URL whose server is listening becomes its preview URL.
- A fenced code block stays as written.

Everything else is yours to link. Run `tailnet-link <target>` and write the URL it prints as a Markdown link for a directory, a file of another type, a message that is not the last of the turn, a subagent's report, and every link made from Claude Code or a script.

When the human reports a `Links were left as written` warning, it carries the reason the conversion failed. Fix that reason, then link by hand.

## Dev servers

1. Start the server on localhost, the default of Vite, Astro and Next. Keep it off `0.0.0.0` and off the tailnet address, since the preview reaches it on localhost.
2. Run `tailnet-link <port>`. It waits for the server to listen, so it can follow the start command directly.
3. Give the printed URL. It stays the same across restarts of the server on that port.
4. When the work ends, stop the server, then run `tailnet-link prune`.

A dev server that checks the `Host` header refuses the tailnet name. `scripts/dev-server.env` holds the variables that make Vite and Astro accept it. `scripts/shell.zsh` exports them to every zsh of the machine, and Pi exports them to the commands it starts on its own machine. A server started before that export keeps refusing until it restarts. When `tailnet-link` reports that a server refuses the host, do what its message says and run it again.

**Projects stay as they are.** A link works through the machine alone: the variables of `scripts/dev-server.env`, the shell hook and Tailscale Serve. Leave the project's config, scripts and env files unchanged. A framework that reads its allowed hosts from the environment gets its variable added to `scripts/dev-server.env`, once for all repositories: one `NAME=value` per line, with no space and no comment, the value taken as written. Pi refuses any other line when it starts, and the shells skip it. When only a change inside the project makes its server answer, ask the human first and name the difficulty that change avoids.

## What the machine links by itself

- **A Herdr terminal prints the link.** `scripts/terminal.zsh` watches each command typed in a Herdr terminal once it has run for a second. When that command prints an `http://localhost` URL for a port it, or a program it started, listens on, the terminal prints one line for that port under it: `➜  Tailnet: <url>`, or `➜  tailnet-link: <reason>` when the link could not be made. A URL that the terminal already showed does not count: one typed in the command, or one an earlier command printed. A human who types `pnpm dev` needs no other command.
- **A port is tried once.** After a `➜  tailnet-link:` line, fix the reason it gives and run `tailnet-link <port>`.
- **A URL that cannot be told from older text gets no line.** The terminal is read once as the command starts, and a URL counts when the terminal later shows it more often than in that reading. A server that prints its URL within milliseconds of its start is already in that reading. A command that clears the terminal's history, or prints more lines than the terminal keeps, before it prints a URL the terminal showed before, adds no copy to count. Link the port with `tailnet-link <port>`.
- **A program that reads the keyboard key by key gets no line**, an agent or an editor for example: a line written there would land in what it draws. Link its port with `tailnet-link <port>`.
- **The watch is bounded.** It looks for new servers until the prompt returns, or until `WATCH_SECONDS` of `scripts/announce.py` after a program takes the terminal, and for `LIMIT_SECONDS` at most. The links of the reading under way when that time runs out are still made. Link a server that starts later with `tailnet-link <port>`.
- **The root page lists the servers.** The URL `tailnet-link setup` prints shows the linked servers that are running, each with its working directory when the machine can read it, above the published files. A published `index.html` never replaces that page. It is the bookmark for a phone, which has no terminal to read.

## Published files

- A link is a copy taken when the link is made. After changing the file, link it again. In Pi, naming the path in the final message does that.
- A deliverable with no requested location goes under `~/Public/deliverables/<project>/`. That folder is served in place, without a copy.
- Only a device signed in to Tailscale as the machine's owner reads published files. Anyone else gets a 403 page.
- A directory is published without its hidden files and its `node_modules`.
- A permission error on the source means macOS protects its folder, as it does for Desktop, Documents and screenshot thumbnails. Ask the human to export the file elsewhere. Never retry through another tool.

## When a link does not open

Run `tailnet-link status` on the machine the URL names.

| Status says | Do |
|---|---|
| A preview is `dead` | Restart the server on that port. The same URL answers again. |
| The preview is not listed | The machine signed out of Tailscale or joined again, which drops its previews. Run `tailnet-link <port>` again. The same URL answers. |
| The file server is `down` | Run `tailnet-link setup`. |
| Everything is `live` | The reader's device is off the tailnet or signed in as someone else. Ask the human to check Tailscale on it. |

A link answers only while its machine is on. The first request to a machine that just joined waits about ten seconds for its certificate.

## A new machine or VM

`tailnet-link setup` makes a machine serve links. It installs the file server as a service, mounts it on Tailscale Serve at `/deliverables` and links the command into `~/.local/bin`. Run it once per machine. Running it again is safe and repairs a file server that is `down`.

- A Mac must be signed in to Tailscale first.
- A Linux VM outside the tailnet joins with the key in `TS_AUTHKEY`. Setup reads it from its environment, hands it to Tailscale and keeps no copy. `workspace start <name> --profile pi --pi-tailnet` does the whole join from the Mac.
- `tailnet-link join-key`, on a Mac with an `infisical login` session, prints the key for one VM. It works once, within ten minutes, and tags the VM `tag:agent`, which the tailnet policy grants nothing: the human's devices reach the VM and the VM reaches no other machine. Its output is a credential, so always pipe it into the command that runs setup on the VM.
- In a Pi tool session the command is on `PATH` before setup ran, through `~/.pi/agent/bin`.
- A machine where a human types commands sources `scripts/shell.zsh` from its `~/.zshenv`. Setup writes no shell file, so add that line with the machine's dotfiles.

## Other ways to open

- `open <path-or-url>` on a Mac shows the target on the desktop the human is using. It reaches no phone and no VM, so the reply still carries the link. Source and installation are in `~/Development/tools/herdr-remote/README.md`, section `Link tools`.
- For a source file to edit, give a `zed://ssh/<machine-dns-name>/<percent-encoded-absolute-path>` link when the human uses Zed over SSH.
