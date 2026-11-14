---
name: github-repositories
description: >-
  Naming, owner, local folder and topics (tags) of every GitHub repository
  under NextNodeSolutions or walid-mos. Load before creating, renaming,
  transferring or setting the topics of one of their repositories.
---

# GitHub repositories

One convention for both owners, NextNodeSolutions and walid-mos. This file holds the rules. GitHub holds each repository's current topics: `gh repo list <owner> --json name,repositoryTopics`.

## Create a repository

1. Pick the owner and the name by "Naming" below.
2. Create it. A NextNodeSolutions repository follows "GitHub repository" in `~/.pi/agent/skills/nextnode-standards/setup.md`, which also applies the organization's repository rules. A walid-mos repository uses `gh repo create walid-mos/<name>`.
3. Set its topics by "Topics" below: `gh repo edit <owner>/<name> --add-topic <kind>,<status>[,<domain>…][,<stack>…]`.
4. Put its checkout in the folder "Local folders" names.

Done when `gh repo view <owner>/<name> --json repositoryTopics` shows exactly one `kind-` topic and one `status-` topic.

## Naming

1. Use lowercase kebab-case ASCII. Leave out an owner prefix (`nextnode-`), a year, a version (`-v2`) and a tech suffix (`-astro`, `-app`).
2. Name client or product work after the brand or the domain, without the TLD (`elance-fit`, `studiobymina`, `syneva`).
3. Name internal work by what it is, in one or two nouns (`infrastructure`, `toolkit`, `workspace`, `agent-sandbox`).
4. Name several repositories under one brand `<brand>-<part>` (`syneva-archive`, `canary-workspace`).
5. Name the role, never a tool it uses today (no `colima`, `sealskin`, `circleci` in a new name).
6. NextNodeSolutions holds work for NextNode, a client or a product. walid-mos holds the person's own config and utilities (`dotfiles`, `herdr-*`).

Rename or transfer an existing repository only when the gain beats the cost. Org rulesets select repositories by name, the infrastructure deploy pipeline derives Worker, stack and store names from the repository name, and npm trusted publishers name the repository. Never reuse a retired name. A new repository under it ends GitHub's redirect and breaks every old link.

## Local folders

Checkouts live under `~/Development`:

| Folder | Holds | Kinds |
| --- | --- | --- |
| `nextnode/` | Repositories about NextNode itself: platform, packages, company site | `infra`, `package`, the nextnode.fr site |
| `products/` | Products under NextNode's brand | `product` |
| `clients/<client>/` | Client work. A client with one repository may sit at `clients/<repo>` | `client` |
| `tools/` | Our own workstation and agent tooling | `tool`, `harness` |

Two paths are fixed by their tools: `~/.pi/agent` (pi-agent) and `~/.local/share/chezmoi` (dotfiles). Third-party clones (`tools/terraform-mcp-server`) stay in `tools/` and get no topics.

## Topics

GitHub topics are lowercase letters, digits and hyphens, with at most 20 per repository. Topics on public repositories are public.

| Dimension | Rule | Values |
| --- | --- | --- |
| kind | exactly 1 | `kind-product`: outside users use it under NextNode's name (Syneva, the nextnode.fr site). `kind-client`: built for a client. `kind-infra`: checks and deploys the other repositories, plus its canaries and org defaults. `kind-package`: published to a registry for other repositories. `kind-harness`: the agent setup and the machines agents run on. `kind-tool`: a utility for our own workstation or daily use, never shipped. |
| status | exactly 1 | `status-active`: feature work in the last ~60 days. `status-stable`: live, fixes only. `status-deprecated`: replaced, kept running until its users move, then archived. Archived repositories keep GitHub's own archived flag on top. |
| domain | 0 to 2 | `website` (public, no sign-in), `webapp` (sign-in, stored data), `ci-cd`, `ai-agents`, `developer-tools` |
| stack | any | `typescript`, `rust`, `swift`, `astro`, `react`, `hono`, `threejs`, `strapi`, `cloudflare-workers`, `docker` |

Prefixes (`kind-`, `status-`) only go on our own dimensions, so `topic:kind-client` filters exactly. Domain and stack use GitHub's common topics so public pages link to the shared topic lists. Add a new value to this table first, then apply it. Never invent one on a single repository.

Search by topic: `gh search repos --owner NextNodeSolutions --topic kind-client`, or `topic:status-deprecated` on github.com.
