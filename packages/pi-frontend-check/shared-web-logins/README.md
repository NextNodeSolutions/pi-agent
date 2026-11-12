# Shared web logins — Pi

Infisical holds the login records; browsers stay per session. Personal Brave remains separate.

## Components

- `config.json`: dedicated Infisical project, `prod` environment, root folder. At setup it had one human project member and no machine identities; secret-link sharing is disabled and project deletion is protected. Audit membership before adding other users/identities. Organization administrators may still govern access.
- `broker.py`: validates HTTPS (or loopback HTTP) origins, hashes origin + identifier into opaque secret keys, reads/writes Infisical through the logged-in user's CLI session, verifies every write. Login payloads go to the CLI over stdin, never an argument. `list` returns metadata only; **`read` emits a password to its process pipe and must only be called by the browser adapter, never in an agent-visible shell**.
- `infisical_cli.py`: checks `infisical login status --json` for a server-verified user session before each operation. Status and operation share one deadline. The macOS sandbox denies listening sockets and `/usr/bin/open`, so session expiry after the check cannot open a browser or receive a login callback. Timeout and cancellation kill the entire CLI process group. Child output stays in memory and failures use fixed messages.
- `enroll.py`: terminal enrollment through masked prompts, then `save_login` with a verified readback. It is the only place a password is typed.
- Local Pi package `~/.pi/agent/packages/pi-frontend-check/`: `frontend_vault_list` and `frontend_vault_fill` read the same project. Password fill rechecks `location.origin` inside the same page execution and refuses ambiguous fields. Frontend tool text is redacted and screenshots remain blocked after a fill until the client connection is released.
- Pi package skill `shared-web-logins`: login workflow, failure handling, MFA and verification.

## Enrollment

1. In a terminal: `python3 ~/.pi/agent/packages/pi-frontend-check/shared-web-logins/enroll.py`. Enter the origin of the actual password form (`https://host`), the identifier, the password and, if any, the OTP secret in the masked prompts; never type them into chat or an agent shell.
2. In Pi, call `frontend_vault_list`, open the exact-origin login page, type only the listed identifier, then call `frontend_vault_fill` with its `iw:` handle. Submit only with authorization and verify the authenticated page.
3. When Pi meets a site with no entry, it asks the user to run `enroll.py`; Pi must not solicit a password in chat.

## Operational checks

- `python3 broker.py list` reports only metadata. Never run `broker.py read` in a terminal tool: its stdout is sensitive.
- Requires macOS `/usr/bin/sandbox-exec` and an Infisical CLI supporting `login status --json`. The guard is required for every CLI call, including enrollment. If the guard or status command is unavailable, the operation fails without running an unguarded vault command.
- The Infisical CLI must be logged in for the user running Pi. An expired, rejected or missing session returns the authentication-required exit code from `protocol.json`, which the adapter maps to a request to run `infisical login` in a local terminal. Complete that explicit login in a browser profile connected to Infisical, then retry `frontend_vault_list`. Website passwords remain stored and must not be enrolled again.
- Credentials sit in the login keychain. SSH or launchd contexts can fail with "User interaction is not allowed" even after login. Keychain failures, outages and unverifiable status remain vault-unavailable errors, **not** absent accounts. Do not fall back to a password prompt.
- The adapter resolves the broker beside its loaded package and forwards `INFISICAL_PROFILE` and `XDG_CONFIG_HOME`. The runner excludes inherited machine tokens and Universal Auth credentials, uses system helper paths, and runs from its own directory so a project's local Infisical config cannot select its authentication.
- Install the updated package in `~/.pi/agent/packages/pi-frontend-check` and run `/reload` to apply adapter changes. A worktree check verifies that worktree's broker, not the installed live package.

## Limits

Exact-origin matching intentionally rejects a login saved for another SSO domain; navigate to the actual password form's origin before enrolling. Sites may still require MFA, CAPTCHA, passkeys, consent, or renewed credentials. A shared password is **not** a shared session, nor a guarantee of unattended permanent access. This integration runs as the same macOS user as Pi; an agent with unrestricted local shell access is not an adversarial sandbox against that user or the organization's Infisical administrators.
