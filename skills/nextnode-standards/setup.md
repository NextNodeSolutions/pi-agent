# Shared tooling setup

Extends the project setup instructions in `SKILL.md`. Read every applicable checklist item before configuring shared tooling.

**Source**: @nextnode/core @ 649362a (standards v1.25.0; verified 2026-09-24 against packages/standards)

Centralized development standards for all NextNode projects. This is a **config-only** package - no runtime code, no build step. It exports configuration files that projects extend.

## Instructions

### Phase 1: Read the project

1. Read `package.json` - check if `@nextnode-solutions/standards` is installed and which configs are in use
2. Read existing config files (`oxlint.config.ts`, `oxfmt.config.ts`, `tsconfig.json`, `vitest.config.ts`, etc.)
3. Identify gaps - missing or misconfigured standards

### Phase 2: Provide guidance

Based on the argument, explain the specific config. If no argument, do a full audit of the project's standards compliance.

Use the relevant sub-file for details:
- [oxlint.md](oxlint.md) - linting rules and overrides
- [typescript.md](typescript.md) - TypeScript configs (library, Next.js, Astro)
- [tsdown.md](tsdown.md) - bundler config base for publishable packages
- [vitest.md](vitest.md) - test configs and all export paths (backend, frontend, astro, vite-plugin)
- [configs.md](configs.md) - commitlint, lint-staged, oxfmt, Tailwind theme, editorconfig, .npmrc, semantic-release
- [ci.md](ci.md) - pull-request checks: the manifest fields and check scripts the organization's `Checks` workflow reads

---

## Installation

```bash
# Required peer dependencies
pnpm add -D @nextnode-solutions/standards oxlint oxfmt

# Optional peer dependencies (install only what you use)
pnpm add -D vitest                                              # If you have tests
pnpm add -D oxlint-tsgolint                                     # If you want type-aware oxlint rules (--type-aware)
pnpm add -D @commitlint/cli @commitlint/config-conventional     # If you want commit linting
pnpm add -D tailwindcss                                         # If you use Tailwind
```

---

## Complete project setup checklist

For a typical NextNode project, you need these files:

```
oxlint.config.ts          # extends standards/oxlint (requires oxlint >=1.62.0)
oxfmt.config.ts           # extends standards/oxfmt (requires oxfmt >=0.43.0)
tsconfig.json             # extends standards/typescript/{library|nextjs|astro}
tsdown.config.ts          # imports standards/tsdown (publishable packages)
vitest.config.ts          # imports standards/vitest/{backend|frontend}
commitlint.config.js      # imports standards/commitlint
lint-staged.config.js     # imports standards/lint-staged
.releaserc.json           # extends standards/semantic-release (for publishable packages)
.editorconfig             # copied from standards
.npmrc                    # copied from standards
.infisical.json           # apps with secrets: links the checkout to its Infisical project
```

And these root package.json fields:

```json
{
  "type": "module",
  "packageManager": "pnpm@<core monorepo pnpm version>",
  "engines": { "node": ">=24" },
  "scripts": {
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check ."
  }
}
```

`packageManager` takes the exact version from `SKILL.md`, never a range or a major alone. [ci.md](ci.md) lists the check scripts, where a workspace declares them, and what the `Checks` workflow refuses in these fields.

## GitHub repository

If the project has no repository yet, name it, set its topics and place its checkout by "Create a repository" in `~/.pi/agent/skills/github-repositories/SKILL.md`. Create it with `gh repo create NextNodeSolutions/<name>`, then run `~/.pi/agent/skills/nextnode-standards/scripts/apply-repo-rules.sh <name>`. The organization rulesets apply their default-branch policy automatically; the script sets what GitHub does not propagate per repository (merge buttons, delete-on-merge, squash commit message, Dependabot, public-repo secret scanning). It refuses to run while the org rulesets are missing.

## Secrets and local environment

Run "Project secret workflow" in `~/.pi/agent/skills/nextnode-deploy/github-org.md` during setup and whenever a feature changes environment consumers. It owns discovery, project reuse or creation, membership, per-environment reconciliation, secure writes and completion evidence. Do the work during authorized setup, rather than merely recommending Infisical. An audit stays read-only.

For projects with no secret consumer, record that result and skip vault creation. Assets-only Workers and publishable packages do not receive application runtime secrets. Package publishing credentials follow `~/.pi/agent/skills/nextnode-deploy/kickstart-package.md`.

For machine-authenticated local execution and the committed project link, follow "Local development" in `~/.pi/agent/skills/nextnode-deploy/github-org.md`. For Worker secret declarations, read "Generated Worker types" in `~/.pi/agent/skills/nextnode-deploy/cloudflare-workers.md`. For public build settings or build-only tokens, read "Build-time values" in `~/.pi/agent/skills/nextnode-deploy/deploy-env.md` before choosing storage. Unsupported build inputs remain blockers, not completed secret setup.

## Pull-request checks

Checks run from the organization's `Checks` workflow, never from a workflow file in the project. Read [ci.md](ci.md) for what the workflow reads, the scripts a NextNode project declares and how a repository is enabled.

## Agent skills

Impeccable is the only skill a project installs through its own CLI. Each developer runs `npx impeccable install` from the repository root, and the repository ignores `**/skills/impeccable/` rather than committing the skill. Every other skill a project needs is vendored, as "Third-party code" in `~/.pi/agent/AGENTS.md` requires.

## Rules

| FORBIDDEN | MANDATORY |
|-----------|-----------|
| Weakening core oxlint rules (`no-explicit-any`, `eqeqeq`, `strict`, etc.) | Add project-specific overrides only on top of the base config |
| Hand-formatting against oxfmt (spaces, semicolons, double quotes, manual import order) | Let oxfmt enforce: tabs, no semis, single quotes (JSX double), auto import sort |
| Inline type imports: `import { type Foo }` | Separate type imports: `import type { Foo }` |
| Type-checking an Astro project with plain `tsc` | Declare `type-check` as `astro check`, as [ci.md](ci.md) states |
| Relying on extended tsconfig to inherit `exclude` | Add `"exclude": ["vitest.config.ts"]` in every project's own `tsconfig.json` |
| Secret values in `.env.local`, `.dev.vars`, `nextnode.toml`, a workflow or any committed file | Store secrets in the repository's Infisical project and run locally through `infisical run` |
| Copying a tooling pattern from an existing repo without checking upstream | ALWAYS fetch the current best practice from the tool's official docs (husky, pnpm, turbo, …) before scaffolding — patterns in older repos (and even in this skill) can lag upstream. Canonical example: the husky CI guard (`.husky/install.mjs`, see configs.md for the docs link) — not a `[ -n "$CI" ] \|\| husky` shell one-liner |
| Scaffolding or pinning a new Astro app on astro 6 | New Astro apps ALWAYS use Astro 7 (`pnpm create astro@latest`); astro 6 is legacy-only for apps not yet migrated (peer range `^6.0.0 \|\| ^7.0.0` since core#55) |
| Pinning a new project to TypeScript 5.x/6.x | New projects ALWAYS use TypeScript 7 (`typescript@^7`, native compiler, `tsc` drop-in); 5.x/6.x are legacy-only for repos not yet migrated. EXCEPTION: Astro apps stay on `^6` — `astro check` hard-fails on ts7 (missing programmatic API, see typescript.md for the upstream link) |
