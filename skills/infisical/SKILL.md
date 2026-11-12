---
name: infisical
description: >-
  Infisical machine authentication, project links, environment injection and
  value-safe secret operations. Load whenever a task touches Infisical in any
  repository, a local env file, the CLI, or the Infisical MCP, and whenever
  Infisical refuses a project (HTTP 403, ProjectMembershipNotFound).
---

# Infisical

## Machine authentication

Agents and unattended local jobs use Universal Auth, never the human's CLI session. `security/machine-identity.ts` owns login and domain lookup from `~/.config/agent-secrets/core-vault.json`. The shell must export `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`. Do not read their source files. Missing or refused credentials require the human to repair the session environment, not a browser login.

Use `~/.pi/agent/bin/infisical` for CLI calls. Pi prepends that directory to tool PATH. Claude Code's pre-call hook requires the explicit path. The shim supplies a fresh token in the child's environment and refuses interactive commands and token/domain overrides. The human's own CLI session remains untouched. This is command routing, not isolation from an agent with unrestricted shell access.

The Infisical MCP authenticates from the same exported Universal Auth credentials. Keep `INFISICAL_MASK_SECRET_VALUES=true`. The MCP has its own login implementation. External workspace tooling and shell refresh functions are outside this repository and must also use machine credentials.

## Value-safe operations

A value never reaches the context. List names with `node ~/.pi/agent/security/secret-names.mjs --projectId ID --env ENV --path /`. Write with `node ~/.pi/agent/security/secret-set.mjs --projectId ID --env ENV --name NAME [--path /] [--replace]`, using the masked terminal prompt or stdin. For a value the human holds, use `ask_user_secret` with `destination: infisical`.

Move or copy with `node ~/.pi/agent/security/secret-move.mjs --name NAME --from ID/ENV --to ID/ENV [--path /]`. `--keep` copies and `--replace` permits overwrite. Verify by name only. Values consumed by another command stay in its environment, stdin or a captured shell variable, never argv, logs, temporary files or tool output. Capture errors privately and release only fixed messages or HTTP status codes.

## Local env

Reuse the committed `.infisical.json` or `.infisical.yaml` after verifying its project ID against the repository's project. A mismatch blocks execution. For a missing link, obtain the authorized project's ID and write `.infisical.json` with `workspaceId` and `defaultEnvironment`, then commit it. The shim resolves the project from the nearest link or `INFISICAL_PROJECT_ID`. Explicit `--projectId` takes precedence. Always specify `--env`.

- Run `~/.pi/agent/bin/infisical run --env=dev [--path /<app>] -- <command>`. Workers also need the local-development steps in `~/.pi/agent/skills/nextnode-deploy/github-org.md`.
- Import a leftover env file without reading it with `~/.pi/agent/bin/infisical secrets set --env <slug> [--path /<app>] --file <file>`. Confirm every reported name with the names script, then delete the local file and update its consumers to use injection. Tracked templates stay.
- Deleting a shared secret requires `secrets delete NAME --type shared` because the CLI defaults to personal secrets.

## Projects and grants

Create every project with the provisioning command in [projects.md](projects.md), never in the dashboard: Infisical makes the creator a project member, so only a project the machine identity creates is readable without a human step. Read projects.md before creating projects or environments or changing memberships. An inaccessible project is not an empty vault. Do not switch identities or create a replacement to evade a refusal.

### Missing project access

HTTP 403 `ProjectMembershipNotFound` means the machine identity is not a member of that project, and it cannot add itself.

1. Run `node ~/.pi/agent/security/project-access.mjs`. Exit 0: every secret-manager project is readable. Exit 1: it lists every project the identity cannot read under `missing` and prints the one-time human step. Exit 2: the check failed; report its message.
2. Tell the human once, in one message: the missing project names and that step. Never ask whether access has been restored.
3. Keep working on everything that does not need those projects' secrets, and report the rest as waiting on that step.
4. Before using such a project again, rerun the check. Its project under `readable` is the only evidence of access.

A committed project ID listed under neither `readable` nor `missing` names no project of the organization: that is a broken link, not missing access.

## core-vault

Reserve this project for AI clients. Keep root empty. Shared provider credentials belong under `/providers`, shared MCP credentials under `/mcp/<server>`, tool credentials under `/tools/<tool>`, and client authentication under `/clients/<client>`. Application secrets belong in their own projects.

The binding owns the project, environment, domain, identity IDs, exports and tool paths. `bin/provider-key.py` uses the shim and retains its existing shell-export fallback when the vault is unavailable. That fallback does not access Infisical. Bootstrap credentials stay outside the vault they unlock.

After an authorized rotation, run `infisical-refresh`, open a new shell and restart clients. Never fill missing keys with placeholders. `bin/pi-token-pull` reads the published Codex access token using the shared machine login. Workspace VMs need this checkout, Node 24, the CLI, their binding and their own authorized machine credentials. The external workspace profile provisioning code is not changed by this repository.
