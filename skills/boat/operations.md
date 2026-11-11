# Boat operations — lifecycle mechanics and proven environment facts

Extends the "Command map" and "Auth" sections of `SKILL.md`; the core rules are not restated here.
Facts marked *observed* were verified live on sandbox `bx_5jgvdcgb` (default size, baremetal,
2026-09-27); re-verify before relying on them.

## Stop / resume mechanics (observed)

- `boat stop <id>`: state `stopping` → `stopped`, snapshot `in_progress` → `completed`, ~4 min.
  Billed nothing while stopped. `boat info --json` nests under `sandbox` (not top level).
- `boat resume <id>`: ready in < 1 min, lands in state `idle`/`ready`, gets a **new internal IP**,
  and `archiveAfter` re-arms — the TTL clock restarts on every resume.
- What returns after resume: systemd (unit states intact — `docker.service` came back active),
  files on the disk, installed packages. What does NOT return: hand-run processes (a `nohup sleep`
  was gone). Anything that must survive a stop/resume cycle is a systemd unit — the sandbox has
  passwordless sudo, so write `/etc/systemd/system/<name>.service` and `systemctl enable --now` it.
- SSH (observed 2026-10-07): plain `ssh -p <port> user@<host>` (endpoint from `sshEndpoint`) is refused
  until `boat ssh <id>` has run once on that sandbox — it installs `~/.ssh/ascii_box_ed25519.pub`. The
  host key changes on every resume; `boat ssh` refreshes it in
  `~/.ssh/ascii_sandbox_known_hosts/<sha256(id)[:24]>` under alias `ascii-sandbox-<same>`, which plain
  ssh can verify strictly (`HostKeyAlias` + `UserKnownHostsFile`).
- Fork inherits the source's type unless `--type` says otherwise; snapshots can be named
  (`boat snapshot <id> <name>`) and sandboxed from (`boat new --from <name>`).

## Inside the sandbox (observed on the current image)

- Ubuntu 24.04 LTS, x86_64, kernel-level TUN available (`/dev/net/tun` exists — KVM may or may
  not exist depending on the host; `ls /dev/kvm` to check).
- Login user is `user` (uid 1000, in the `docker` group, passwordless sudo). `/root` is not
  readable; work in `/home/user`. Disk: `/dev/vda1` (12 GB usable on `small`).
- Preinstalled: Node 24 + npm + corepack + pnpm, git, gh, jq, rg, Docker + Compose (daemon runs
  on boot), Chrome, ffmpeg, and agent harnesses (`pi`, `claude`, `codex`, … — each signs in with
  its own `login` command; Boat's preinstalled Pi may lack local extensions/skills).
- First `boat ssh` run mints `~/.ssh/ascii_box_ed25519` on the local Mac and registers it.
- Registry pulls work; egress is open. `python3 -m http.server` etc. available for quick probes.

## GitHub private clones (current setup)

- Boat's GitHub integration is OFF (`boat env set base --github false`) — the operator has no
  admin on the target org, so an org-level Boat GitHub App cannot be installed.
- Instead: the `workspace` CLI's agent profiles export `GITHUB_TOKEN` (read from Infisical on the
  Mac) on the VM and run `gh auth setup-git`, so Git clones over HTTPS with that token. No SSH key
  reaches sandboxes.
- Fallback if the org enforces SAML SSO: HTTPS clone + classic PAT (one "Enable SSO" click,
  user-level) or Git Credential Manager with the browser session. No admin needed either way.
- Repos cannot be selected via CLI (`env add-repo` needs a Boat-connected repo) — dashboard-only,
  and moot while the integration is off.

## Tailscale on a sandbox (observed 2026-11-11 on `small`)

- Joining a sandbox to the tailnet belongs to `~/.pi/agent/skills/tailnet-links/SKILL.md`, section
  "A new machine or VM". Never enrol a sandbox by hand. Only what Boat adds is below.
- Tailscale is not preinstalled, so the first join installs it and took 100 s. A later join took
  30 to 50 s. `tailscaled` runs as a systemd service.
- The device takes the sandbox hostname, `box-node-<id>`.
- A stop and resume kept the device and its node: file links and previews answered again at the
  same URLs with no new join. The sandbox came back with its processes still running and its boot
  time unchanged, unlike the 2026-09-27 observation above.
- Once the tailnet has dropped the device, the next join returns it under the same name, so file
  links keep their URLs. Its previews are no longer listed: that skill's section "When a link does
  not open" has the fix. Observed by deleting the device through the Tailscale API and by `tailscale logout` on the
  sandbox, not by waiting for the tailnet to drop a stopped one.
- `localhost:47990` belongs to the image's `sunshine` service. Start test servers on another port.

## Cost reality checks

- `boat usage <id>` gives the per-sandbox bill with the size multiplier applied — use it to close
  out a work session instead of estimating.
- Stopped sandboxes are free and keep their disk; stop a sandbox when a work block ends rather
  than letting the TTL run it down.
