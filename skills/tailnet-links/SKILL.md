---
name: tailnet-links
description: Open and share files or local previews across Tailscale devices. Load before giving the human a file to open (report, export, capture), emitting file links, starting a dev server, sharing a preview URL, diagnosing Safari HTTPS upgrades, or installing the cross-machine open tools on a satellite.
---

# Tailnet links

## Browser previews

1. Bind the backend to loopback only, never a tailnet IP or `0.0.0.0`. Start it as a managed job. For a static directory, use `/usr/bin/python3 -I -m http.server <port> --bind 127.0.0.1 --directory <directory>`. Wait for a real readiness response.
2. Confirm authorization to add a tailnet-only Tailscale Serve handler. An explicit choice for this workflow covers preview creation, not Funnel, file publication, firewall changes or admin-console changes.
3. Run `~/.config/shims/tailnet-link preview <port>` on the serving machine. It requires a free Serve port, refuses non-loopback listeners, preserves existing routes and prints the discovered HTTPS URL. Use a different backend port if an existing handler owns that port. Do not use `serve reset`.
4. Verify the exact URL with `~/.config/shims/tailnet-link verify '<https-url>' --expect '<expected response text>'`. Certificates must verify. Configure Vite `allowedHosts` or Next `allowedDevOrigins` for the discovered DNS name when needed.
5. Repeat verification from the reader's device before calling the URL peer-verified. Discover devices with `tailscale status --json`. An offline peer or failed request means peer access is unverified. A successful serving-machine request is local evidence only.
6. Emit the returned HTTPS URL as a Markdown link. Do not manufacture plain-HTTP tailnet links or replace HTTP with HTTPS on an unconfigured port. Do not substitute a tailnet IP or the viewer's hostname. Calling `open` on the serving machine does not share a link with the reader.
7. Stop the owned backend and run `~/.config/shims/tailnet-link remove <port>` when finished unless the user asks to keep the preview. Removal requires an ownership receipt and an unchanged handler. If configuration changed, inspect it and preserve other owners' work.

Serve persists after the command exits. Publish only a directory whose contents are intended for tailnet access. Preview URLs are subject to tailnet access rules, not restricted to one reader. Ownership receipts live in `~/Library/Application Support/tailnet-link`. Never delete receipts to force removal.

## Deliverables

A file the human will open (report, export, capture, document) is published, never linked by path:

1. Run `~/.config/shims/tailnet-link publish '<file>' --dir <project-slug>` on the machine that holds the file. It copies the file into the served deliverables root and prints its tailnet HTTPS URL. The copy is the deliverable; the original stays where its tool wrote it. A destination that already exists with different content is refused: publish under another name.
2. Emit the printed URL as a Markdown link with a readable label. It opens on whichever device the human clicks from, a Herdr pane on either Mac or Safari on the phone. Never substitute a bare `/Users/...`, `file:///...` or `file://<host>/...` link.
3. When the human reports a failure, verify as in Browser previews steps 4 and 5. A serving-machine success is local evidence only.
4. When publish answers that deliverables are not served, give the human the one-time command it names and the file's path, and say the link is pending.

Write files meant for the human outside `~/Desktop` and `~/Documents`: a background process reaches those only after a consent dialog. Screenshot thumbnail paths under `TemporaryItems` are not deliverables and may be protected or disappear. A permission denial requires the user to export the file from its app to an accessible location. Do not reattempt access through another tool or grant yourself permissions.

## File links

- An agent-initiated open on the current machine goes through `~/.config/shims/open -- '<absolute path>'`. For that shim only, `file://<source-DNSName>/<absolute-path-without-leading-slash>` identifies the source machine; Safari, Finder and native `/usr/bin/open` do not understand it. Native application flags pass through unchanged on local routes that need no rewriting. Use `/usr/bin/open` on the viewer for flags on other routes.
- For a source file to edit, use the existing `zed://ssh/<source-host>/<encoded-absolute-path>` editor link when Zed SSH is configured. Do not promise that arbitrary devices have this handler. Discover the source machine's DNS name from `tailscale status --json`. Encode the path with URL percent-encoding, including spaces, `#`, `%` and `?`. Emit a Markdown link with a readable label, not an unquoted path split by spaces.

## Open routing and installation

Source and installation procedure: `~/Development/tools/herdr-remote/README.md`, section `Link tools`. Use `scripts/install-links.sh` as the single activation procedure on each macOS desktop. Chezmoi source copies prevent a later apply from restoring old tools, they are not evidence of satellite activation. Verify the Python preflight and source/live equality before claiming a satellite is installed. Do not install on iOS or a headless Linux server as though it were a desktop.

The router discovers exact Tailscale names. Herdr uses the local viewer, with the existing paired-seat source convention. `herdr-core` compares input activity only for the exact pair defined in the runtime. Other SSH sessions resolve the caller from its Tailscale IP. Unknown callers, unavailable remote desktops and unsupported viewer operating systems fail explicitly.

Use `~/.config/shims/open --dry-run -- '<path-or-url>'` to inspect the branch, discovered identity and JSON argument array. Dry mode performs no SSH, fetch or write and deliberately leaves remote activity and availability unverified. A localhost URL is rewritten only when a matching local HTTPS Serve mapping exists. For a remote localhost origin, request the serving host's returned HTTPS URL instead of guessing.

Remote files travel over strict SSH into private caches under `~/Library/Caches/open-remote` on the participating desktops. Cached copies remain so opening apps can read them. Remove only task-created cached files after use. A successful `/usr/bin/open` exit proves application dispatch, not that the human saw the file.
