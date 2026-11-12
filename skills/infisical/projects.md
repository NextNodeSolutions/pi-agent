# Projects and environments

Extends "Projects and grants" in `SKILL.md`.

The read-only identity endpoint reports the bound identity's organization role as `admin`, but this does not prove its permission on the project-creation endpoint. Project creation remains human-run until that permission is proven read-only. Do not create a project to discover that permission. Ask the human to create the exact repository-named project in the dashboard with only the required environments, then add `Agents` under Project, Access Control, Machine Identities with the lowest sufficient role. The creator must retain human admin access.

Existing project operations may use the machine-authenticated CLI or REST API when authorized. Inspect the current CLI help or API schema first. For REST, import `machineToken` and `vaultApi` from `~/.pi/agent/security/machine-identity.ts` inside a Node script. Keep the token in memory, build the authorization header there, and emit only allowlisted metadata or HTTP status codes. Never print the token or obtain the human's bearer token.

If organization permissions later prove unattended creation is allowed, use `POST /v2/workspace` with `shouldCreateDefaultEnvs: false`, create precisely the required environments, and invite the human as admin before reporting completion. Project creation without human ownership is incomplete.

After the grant, verify key names with `secret-names.mjs`, write the committed project link as described in "Local env", then verify the real consumer through machine-authenticated injection. An inaccessible project blocks setup rather than authorizing another identity.
