# SOURCE.md

Arc (https://uiarc.dev) free components, copied by hand from the public repository. The shadcn CLI and the `@uiarc` registry were not used. Projects copy from this folder, as `../arc.md` describes.

- Upstream: https://github.com/kuratlielia/arc-library, commit `8302b52ed9dc79ae7ca699b158a98dfdf09656f7` (2026-11-01), folder `registry/`.
- License: MIT, copyright (c) 2026 Elia Kuratli, in [LICENSE](LICENSE). Arc applies MIT to its free components only. Pro components are under a paid license and none is copied here.
- Copied on 2026-11-13, from the copy built and type-checked (React 19, strict TypeScript) in the agent-usage report viewer.

## What was copied

| Here | Upstream | Changes |
|---|---|---|
| `foundation.css` | `registry/foundation.css` | none |
| `motion-tokens.ts` | `registry/motion-tokens.ts` | none |
| `badge/`, `chip-group/`, `drawer/`, `empty-state/`, `range-histogram-slider/`, `segmented-control/`, `tabs/` | `registry/components/<name>/` | import of `motionTokens` from `../motion-tokens` instead of `@/lib/motion-tokens` |
| `button/` | `registry/components/button/` | same import change; `forwardRef` replaced by a `ref` prop (React 19) |
| `multi-select/` | `registry/components/multi-select/` | same import change; optional `searchable` input that filters the options, an optional `hint` per option, a scrolling list capped in height, an empty-result line, and Escape returns focus to the trigger |

`nextnode.css` is not from Arc. It loads after `foundation.css`, copies the brand scales from `nextnode-landing/src/styles/global.css`, and points Arc's colour, text, border, shadow, font and radius roles at them.

## Updating

Follow "Update from upstream" in `../arc.md`. The script there reads the commit above, so keep it as the only 40-character commit in backticks in this file.
