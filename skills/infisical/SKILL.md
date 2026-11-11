---
name: infisical
description: >-
  Infisical vault operations from this machine: which identity acts (the pi MCP's
  machine identity versus the user's CLI session), creating projects and
  environments through the REST API so the user owns them, and writing secret
  values without exposing them. Load whenever a task touches Infisical in any
  repository: a project, an environment, an identity, a secret, the `infisical`
  CLI or the `@infisical/mcp` server.
---

# Infisical

**A value never reaches the context.** Names: `node ~/.pi/agent/security/secret-names.mjs --projectId ID --env ENV --path /`. Write one value: `node ~/.pi/agent/security/secret-set.mjs --projectId ID --env ENV --name NAME [--path /] [--replace]` (masked prompt on a TTY, stdin otherwise; an existing name is refused without `--replace`); from Pi, `ask_user_secret` with `destination: infisical` runs it for a value the human types. Move or copy a secret between projects or environments: `node ~/.pi/agent/security/secret-move.mjs --name NAME --from ID/ENV --to ID/ENV` (`--keep` copies, `--replace` overwrites). A value a command consumes goes through `infisical run` or a shell variable that command alone reads. Every other read, including a filter after a raw read, is a leak.

## Two identities, nothing shared

- **pi MCP** (`@infisical/mcp`, launched by pi): authenticates with the Universal Auth machine identity whose `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and secret live in the shell environment (`~/.config/zsh/env/infisical.zsh`). It never acts as the user. Anything it creates belongs to that identity alone: the user is not a member and every later action needs an invitation.
- **CLI** (`infisical login`): the user's own session. It reads and writes secrets, injects them with `infisical run`, and has no project or environment commands. `infisical user get token` returns its bearer token for the REST API.

## Rules

- **Keep credential errors private.** Capture credential commands' stdout and stderr in memory. For `infisical user get token`, accept exactly one line starting with `Token:` and a nonempty, whitespace-free token value. Discard all other output before constructing headers. Catch failures across credential capture, header construction and HTTP handling. Log only fixed messages or allowlisted status codes, never raw output, request headers, exception objects or causes.
- **Never create a project or an environment through the MCP.** Use the REST API with the user's CLI session, per [projects.md](projects.md), with exactly the environments the project needs: a default creation adds `dev`, `staging`, `prod` whether wanted or not.
- Use all MCP tools with `INFISICAL_MASK_SECRET_VALUES=true`, configured in `~/.pi/agent/mcp.json`. Names and metadata remain visible, while returned secret values are masked. CLI injection, writes, shell-variable capture and file exports remain available. The shared Claude/Pi gate in `~/.pi/agent/security/secret-policy.ts` blocks commands that print values, not Infisical itself.
- A `403 ProjectMembershipNotFound` on a project the user should own means the machine identity created it: invite the user as admin through the MCP (`invite-members-to-project`), then report why it happened.
- Secret values enter the vault through the dashboard, `secret-set.mjs` (masked prompt or stdin) or `ask_user_secret`, never through chat, command arguments, tool arguments, logs or temporary files. Verify a write by key name only, never any part of its value.
- Keep API tokens in shell variables for the duration of a command, never in files.

## core-vault

Reserve this project for Pi, Claude, Pots and other AI clients. Keep the root empty. Put shared model-provider credentials directly under `/providers`, shared MCP credentials under `/mcp/<server>`, credentials of a tool shared across clients under `/tools/<tool>`, and client-specific authentication under `/clients/<client>`. The user's machines and the Pots desktops reach the vault through the `Agents` machine identity, recorded as `identityId` in the binding; cloud VMs use `boats`, a `viewer` identity recorded as `clients.boats.identityId`. Each machine gets its own client secret, described with its name, so revoking a machine is one deletion; a secret that must stay private to the user goes in another project. Application and infrastructure secrets belong in their own projects.

Read `~/.config/agent-secrets/core-vault.json` before changing bindings. It owns the project, environment, API domain, shell exports, client secret paths, and shared tool paths. Pi's `bin/provider-key.py` signs in with the machine identity from the environment (`INFISICAL_UNIVERSAL_AUTH_*`) and that domain, never with the user's CLI session, so it resolves keys the same way on this machine and on a `workspace` VM. When the vault does not answer in time it returns the same-named shell export instead, which is why a rotation ends with the refresh and restart below. Infisical's bootstrap credentials stay outside the vault they unlock.

After adding rotated values at the configured paths, run `infisical-refresh`, then open a new shell and restart the clients. Never populate missing keys with placeholder values. The Codex OAuth access token reaches `/clients/pi` through the hourly `pi-token-sync` job of the machine that signed in, and every other machine (the MacBook, the Pots desktops, the workspace VMs) reads it with `~/.pi/agent/bin/pi-token-pull` under its own client secret.

## Reference

| Read when | File |
|---|---|
| Creating, renaming or deleting a project or an environment, or adding the user to a project | [projects.md](projects.md) |
