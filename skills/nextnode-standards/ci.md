# Pull-request checks

Extends the PR checks reference in `SKILL.md`. Every NextNode project's pull-request checks run from one workflow, `Checks`, kept in `NextNodeSolutions/infrastructure` at `.github/workflows/checks.yml`. An organization ruleset requires it on the pull requests of the repositories it names, and GitHub runs it inside the project. In that repository, `README.md` says what a run does, `docs/architecture.md` how jobs select packages and build commands, and `AGENTS.md` what must stay true when the workflow changes. This file says what a project declares to pass and which scripts the NextNode convention asks for.

## What the workflow reads

A project repository holds no workflow file for its checks. A local `ci.yml` or a copy of `checks.yml` is a duplicate to remove.

The Discover job reads the root `package.json` before any job installs anything:

| Root `package.json` | Result |
| --- | --- |
| Absent | Nothing is selected and the run is green. |
| Unreadable, or a field of the wrong type | Discover fails with an annotation on `package.json`. |
| `packageManager` not of the form `pnpm@X.Y.Z` | Discover fails with an annotation naming the field. |
| `engines.node` missing, or its major below the program's floor | Discover fails with an annotation naming the field. |
| Complete | One status per declared catalogue script, then Build. |

- `packageManager` is the exact pnpm version. Every job installs with `pnpm install --frozen-lockfile`, so the committed `pnpm-lock.yaml` matches the manifests.
- `engines.node` sets the Node of the check and build jobs: its first number is the major they install. The floor is `LOWEST_NODE_MAJOR` in `src/domain/toolchain.ts`, and the NextNode `>=24` from `SKILL.md` clears it.

## Script catalogue

`KNOWN_CHECKS` and `BUILD_SCRIPT` in `src/domain/checks.ts` are the catalogue, matched by exact script name. A catalogue script that a package declares becomes its own status. A catalogue script it lacks is skipped and fails nothing. Any other name runs in no check: `test`, `typecheck`, `check` or `test:ci` produce no status.

| Script | Status | NextNode convention |
| --- | --- | --- |
| `lint` | Lint | Every package with source code, as `oxlint` |
| `type-check` | TypeScript | Every TypeScript package, as `tsc --noEmit`, or `astro check` in an Astro project |
| `test:unit` | Unit tests | Only over an existing unit suite |
| `test:integration` | Integration tests | Only over an existing integration suite |
| `test:e2e` | End-to-end tests | Only over an existing end-to-end suite |
| `build` | Build, after every selected check passed | Every package that produces output |

Astro uses `astro check` because plain `tsc` cannot resolve `.astro` imports, and `astro check` type-checks the `.ts` files too.

The convention column is what a NextNode project declares, and an audit reports a missing `lint`, `type-check` or `build` there. The workflow enforces none of it: a package without those scripts passes with fewer statuses. A test script runs a suite that already exists. A placeholder such as `echo`, an empty suite or `--passWithNoTests` is a fake check that turns the status green without testing anything. Writing a suite to fill the slot follows "Tests" in `~/.pi/agent/AGENTS.md`.

## Workspaces

A root `pnpm-workspace.yaml` switches the workflow to per-package checks:

- The root `package.json` still supplies `packageManager` and `engines.node`, but its scripts are not checks. Each workspace package declares the catalogue scripts it runs, and its statuses carry its name, as `Lint (@scope/name)`.
- On a pull request, Discover selects the packages changed since the merge base with the target branch, plus their transitive dependents, through pnpm's own filter. A change to a root file, listed in `ROOT_FILES` in `src/domain/selection.ts`, selects every package. Markdown alone selects nothing. A change to test files alone selects its package without its dependents. Any run other than `pull_request` selects every package.
- Without `turbo.json`, a check first runs `build` in the package's workspace dependencies that declare one, then the script. With `turbo.json`, the check is `turbo run <script> --filter=<package>`, so the project's `dependsOn` decides what runs first.

## No credential in a check

The workflow runs with `contents: read`, references no secret and keeps no checkout credential, because its jobs execute the project's code, dependencies and lifecycle scripts. A check script runs with no credential, secret or vault login. A step that needs one belongs to the deployment pipeline: read `~/.pi/agent/skills/nextnode-deploy/SKILL.md`.

## Deployment quality is a separate gate

`NextNodeSolutions/core/.github/workflows/deploy.yml` keeps its own quality job, driven by `nextnode.toml` `[scripts].lint` and `[scripts].test`, with optional D1 validation and the production gate. It runs on deployment, and a direct deploy may have no pull-request checks behind it. The two gates read different names: `deploy.yml` runs the script `[scripts].test` names, `test` by default, which `Checks` never runs. Read `~/.pi/agent/skills/nextnode-deploy/pipeline.md` for its mechanics.

Keep both gates. Dropping the deploy-side lint or test task because `Checks` already runs it is a separate design change: it needs its own authorization and a design that keeps the production and deployment gates.

## Enabling the checks on a repository

The ruleset "Checks required on pull requests", rule type `workflows`, names its repositories in an include list and points at `checks.yml` on a ref of `NextNodeSolutions/infrastructure`. Only the repositories it names run the checks. Report rollout from the live API, never from a copied list: `gh api orgs/NextNodeSolutions/rulesets` finds its id, and `gh api orgs/NextNodeSolutions/rulesets/<id>` returns `conditions.repository_name.include` and the workflow `ref`.

Adding a repository is adding its name to the include list, once its root `package.json` passes Discover and its declared scripts pass on the default branch. A repository added before that blocks every pull request until one fixes the manifest or the failing script. Add one repository at a time, on request. A convention never authorizes a fleet-wide rollout, and changing the ruleset's workflow ref changes what every listed repository runs.

## Verification

- `gh pr checks <n>` lists Discover, one status per selected check, and Build when a selected package declares `build`. Each one succeeds and the merge state reads `CLEAN`. A green run with Discover alone selected nothing: its job summary says why.
- A change to the workflow or its program follows "Checks" in `NextNodeSolutions/infrastructure/AGENTS.md`, which runs it on the canary repositories that file names before it merges.
