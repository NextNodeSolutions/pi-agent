# Shared web logins

Infisical holds login records. Browser sessions and personal Brave remain separate.

## Authentication

The broker uses the machine identity through the repository's `bin/infisical` shim. Authentication, environment requirements and project grants are documented in `skills/infisical/SKILL.md` at the repository root. Enrollment uses that same identity. No user-session preflight, keychain access or browser login is required.

`~/.config/agent-secrets/core-vault.json` owns the project and environment. `config.json` owns only the browser tool folder path within that vault. `security/machine-identity.json` owns the credential variable names and exit protocol. Missing credentials, rejected authentication and project access refusals return its identity-unavailable exit code. Outages and other failures return 1. Neither means the website account is absent.

## Components

- `broker.py` validates exact HTTPS or loopback HTTP origins and binds opaque keys to origin and identifier. `list` returns metadata only. `read` emits a password to its process pipe and must only be called by the browser adapter, never an agent-visible shell.
- `infisical_cli.py` calls the shim with a restricted child environment, passes writes through stdin, and keeps output in memory. Timeout and cancellation kill the CLI process group. Authentication and operation share one deadline. Raw child errors never reach tool output.
- `extensions/shared-vault.ts` resolves the broker beside its loaded package and forwards only the environment needed by the machine login and runtime. It validates broker responses and maps the exit protocol to fixed messages.
- `enroll.py` collects passwords in a masked terminal prompt and verifies writes through an internal readback.

## Enrollment and verification

Run `python3 ~/.pi/agent/packages/pi-frontend-check/shared-web-logins/enroll.py` in a terminal exporting the machine credentials. Enter the actual password form's origin and account details there, never in chat.

Use `frontend_vault_list`, choose an exact-origin handle, type its identifier and call `frontend_vault_fill`. Submit only with authorization, then verify the protected page. Password fills recheck the origin and refuse ambiguous fields. Tool output is redacted and captures remain blocked after a fill until the connection is released.

`python3 broker.py list` verifies metadata access without returning passwords. A 404 can mean a missing configured location or refused access. Verify the configuration and project metadata before asking for a grant. A failed lookup is not a reason to re-enroll passwords. Install changes by merging and run `/reload`. A worktree command checks that worktree, not the installed package.

## Limits

Exact-origin matching rejects other SSO domains. Sites can require MFA, CAPTCHA, passkeys or renewed credentials. This runs as Pi's local user and does not isolate an unrestricted local agent from that user's files or process environment.
