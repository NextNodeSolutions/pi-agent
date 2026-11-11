# Pull-request checks

Extends the PR checks reference in `SKILL.md`. The checks of every NextNode project run from one workflow, `Checks`, kept in `NextNodeSolutions/infrastructure` at `.github/workflows/checks.yml`. An organization ruleset requires it on the pull requests of the repositories it names, and GitHub runs it inside the project. The repository `README.md` and `AGENTS.md` there own the workflow's mechanics and its change rules; this file owns what a project must do to pass.

## What a project provides

- **No workflow file.** A project repository holds no `.github/workflows/` entry for its checks; a local `ci.yml` is a duplicate to remove. Deployment is not part of these checks: no development or production deploy job runs on a pull request.
- **Scripts in `package.json`**, discovered by the workflow by name. Missing required scripts fail the check.

| Job | Script | Required |
| --- | --- | --- |
| Lint | `lint` | yes |
| Unit tests | `test:unit` | yes |
| Integration tests | `test:integration` | when declared |
| End-to-end tests | `test:e2e` | when declared; a placeholder (`echo`) until the end-to-end setup exists |
| TypeScript | `type-check` | yes |
| Build | `build`, after the five checks passed | yes |

- **`packageManager`** pinned to the exact pnpm version; the install is frozen (`pnpm install --frozen-lockfile`). The Node version is the workflow's.
- **Permissions**: the workflow runs with `contents: read` and no secret. A check that needs a secret is a design error; move the need to the deployment pipeline (`~/.pi/agent/skills/nextnode-deploy/SKILL.md`).

For an Astro project, `type-check` is `astro check`: plain `tsc` cannot resolve `.astro` imports, and `astro check` type-checks the `.ts` files too.

## Enabling the checks on a repository

The organization ruleset "Checks required on pull requests" names the repositories in its include list (`gh api orgs/NextNodeSolutions/rulesets`, rule type `workflows`). Adding a repository is adding its name there, after its scripts exist: a repository added without `lint`, `test:unit`, `type-check` and `build` cannot merge any pull request. One repository at a time, on request; a convention never authorizes a fleet-wide rollout.

## Verification

- Each job is its own check on the pull request (`gh pr checks <n>`), named after the job. All six succeed and the merge state reads `CLEAN`.
- A change to the workflow itself follows `NextNodeSolutions/infrastructure/AGENTS.md`: tested on the `canary` repository before it merges.
