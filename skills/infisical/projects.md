# Automated project provisioning

Extends "Projects and grants" in `SKILL.md`.

During authorized project setup, run the repository-owned provisioning command as the machine identity. Do not send the human to the dashboard to create a project.

```sh
node ~/.pi/agent/security/project-provision.mjs --name REPOSITORY --owner HUMAN_EMAIL --env dev --env prod
```

Resolve the exact repository name from its remote and the human's verified organization-member email from existing project or organization membership metadata. Do not infer an Infisical account from a Git author email. Choose environments from the application's requirements. The command requires explicit environments and never creates the default trio.

The command reuses a uniquely matching visible secret-manager project or creates one with `shouldCreateDefaultEnvs: false`. Creation gives the machine identity project access. It invites the human with permanent admin access, verifies that membership, creates missing environments and reads back the exact environment set. Success prints only project metadata. A failed later step retains the new project's ID and can be resumed by rerunning the same command. No existing project, environment or membership is deleted.

Use `--check` for a read-only verification of project, human admin and environments. An existing non-admin human membership, unexpected environments, duplicate names or an API refusal fails explicitly rather than silently changing permissions or deleting configuration. Handle an authorized role change through the documented membership API, preserving other roles.

A project known to exist but hidden from the identity is an access failure, not authorization to create a replacement. Preserve its committed ID and report the exact refused operation. Creating a new project does not unlock another existing project.

After provisioning, write the committed link as "Local env" describes, populate authorized secrets through the value-safe scripts, and verify the real consumer with machine-authenticated injection. No interactive CLI session or browser login participates in provisioning.
