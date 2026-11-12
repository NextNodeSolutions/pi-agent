# pi-agent

The [Pi](https://github.com/earendil-works/pi) agent directory used at NextNode: extensions, skills, agents, prompts, themes, model routing and the vendored Pi packages. Pi reads it from `~/.pi/agent`, so the checkout lives there on every machine and cloud VM that runs Pi.

## Install

Requires Node.js 24+ and pnpm.

```bash
git clone https://github.com/NextNodeSolutions/pi-agent.git ~/.pi/agent
node ~/.pi/agent/bin/setup.ts
```

On a machine that already has a `~/.pi/agent` directory, adopt it in place so sessions and sign-ins stay:

```bash
cd ~/.pi/agent
git init -b main
git remote add origin https://github.com/NextNodeSolutions/pi-agent.git
git fetch origin
git reset origin/main      # index follows the repo; files on disk are untouched
git status                 # review local differences, then `git checkout -- <path>` to take the repo's version
node bin/setup.ts
```

## Update

```bash
git -C ~/.pi/agent pull --ff-only
node ~/.pi/agent/bin/setup.ts
```

`bin/setup.ts` merges `settings.pinned.json` into `settings.json` (Pi rewrites that file, so it stays untracked), seeds a missing `settings.json` from `settings.defaults.json`, and installs the locked dependencies of the root and of each package under `packages/`. It names every pinned key it reset.

## What is not in the repo

`.gitignore` is an allowlist: a new top-level entry stays untracked until it is listed there. Sign-ins (`auth.json`, `mcp-auth.json`, `mcp-adapter.json`), sessions, caches, machine state and `client/` never leave the machine.

`client/<name>/` holds one client's private overlay — skills, `skills.json`, `magpie-routing.json` — merged at load time and kept outside this repo. See `ARCHITECTURE.md`, section "Repository and client overlays".

## Machine-specific dependencies

- Model calls go through a Magpie gateway on the NextNode tailnet (`models.json`, provider `magpie`); `models.json` reads each provider key from the session's shell export (`$NAME`), which `infisical-refresh` writes from the Infisical binding in `~/.config/agent-secrets`.
- `bin/pi-token-pull` keeps the shared Codex token current; see `bin/README.md`.

## Licenses

Vendored skills and packages keep their upstream license beside a `SOURCE.md` naming the upstream and revision.
