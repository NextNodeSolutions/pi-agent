# Arc components

Extends "Components" in [SKILL.md](SKILL.md); the brand rules in [colors.md](colors.md) and [typography.md](typography.md) are not restated here.

`arc/` holds free components from Arc (https://uiarc.dev), copied from its public repository, adapted to React 19 and strict TypeScript, and mapped to the brand by `arc/nextnode.css`. [arc/SOURCE.md](arc/SOURCE.md) records the upstream commit, the MIT license and every change made to the upstream files. Arc Pro components need a paid license: never copy one.

## Which component

| Need | Component | Notes |
|---|---|---|
| Pick several values from a long list | `multi-select` | `searchable` adds a filter field; an option's `hint` shows a count or detail beside its label |
| Toggle a few filters that all stay on screen | `chip-group` | |
| Choose a numeric or time range over a distribution | `range-histogram-slider` | The histogram shows where the values sit; both thumbs move by keyboard |
| Switch between a few views of the same content | `segmented-control` | |
| Switch between panels of different records | `tabs` | Radix Tabs; put the record count in the label |
| Show detail or records without leaving the page | `drawer` | Radix Dialog; see the focus note below |
| Run an action | `button` | Variants `primary`, `secondary`, `ghost`, `danger`; [colors.md](colors.md) limits primary to one per context |
| Label a status | `badge` | Tones `neutral`, `success`, `info`, `warning`, `danger` |
| Explain an empty result | `empty-state` | Say why it is empty and how to get results back, such as resetting filters |
| A chart whose bars or points open records on click | none: use ECharts | Arc's charts take data and labels only and emit no click; style ECharts with the same CSS variables |

**Drawer focus.** Radix returns focus to a `DrawerTrigger` on close. A drawer opened from code, such as a chart click or a table row, has no trigger, so focus falls to the page body. Store `document.activeElement` in `onOpenAutoFocus`, then in `onCloseAutoFocus` call `event.preventDefault()` and focus the stored element again when it is still in the page.

## Copy a component into a project

1. Copy `arc/foundation.css`, `arc/nextnode.css`, `arc/motion-tokens.ts`, `arc/LICENSE`, `arc/SOURCE.md` and the component folders the project uses into one folder, for example `src/components/arc/`. The components import `../motion-tokens`, so keep the folders side by side.
2. Import `foundation.css`, then `nextnode.css`, once at the root of the app, before the app's own styles.
3. Install the packages the copied folders import: `grep -ho 'from "[^.][^"]*"' src/components/arc/*/*.tsx | sort -u`.
4. Load the brand fonts as [typography.md](typography.md) says; `nextnode.css` only names them.
5. The styles are CSS Modules (`*.module.css`), which Vite, Astro and Next.js load without setup.
6. Keep the copied `SOURCE.md` table to the folders copied, and add a row for each change the project makes to them.

## Vendor a new component

1. Run the update script below. If it reports changes, update the copy first, so every file in `arc/` comes from one commit.
2. Pick the component in the checkout the script prints, under `registry/components/<name>/`. Arc publishes only free components in that repository.
3. Copy that folder into `arc/<name>/`.
4. Adapt it: import `motionTokens` from `../motion-tokens` instead of `@/lib/motion-tokens`, replace `forwardRef` with a `ref` prop declared in the props type, and fix strict TypeScript errors in place. Leave the rest of the upstream code and comments as they are, so the next upstream diff stays readable.
5. Add a row for it to the table in `arc/SOURCE.md`.
6. Render it in a project with `nextnode.css`, and check text contrast (AA) and keyboard focus in the browser before relying on it.

## Update from upstream

1. Run `node ~/.pi/agent/skills/nextnode-design/scripts/arc-upstream.ts [ref]`. It fetches the commit recorded in `arc/SOURCE.md` and `ref` (default `main`) into a new temp folder, prints the upstream diff of every copied file between the two, and prints the checkout's path.
2. Apply each hunk to `arc/` by hand, keeping the changes listed in `arc/SOURCE.md`.
3. Record the new commit and date in `arc/SOURCE.md`; the script reads the commit from there.

## Brand rules that override Arc

- Brand values live in `arc/nextnode.css`; never edit `arc/foundation.css`. When the brand changes, re-copy the scales from `nextnode-landing/src/styles/global.css` as [colors.md](colors.md) says, then check contrast again.
- Arc's `--accent` is `accent-600`, the darkest teal that still reads as the brand. Text on a teal fill is `base-950`, since white fails AA there. Never set Arc's `data-accent` palettes or use its `--arc-gradient-*` tokens.
- `--text-muted` mixes `base-500` with `base-600` so it stays AA on the muted surfaces Arc puts inactive tabs and segments on; keep the mix.
- Radii follow the Tailwind steps `rounded-2xl`, `rounded-3xl` and `rounded-4xl`, set in `nextnode.css`.
- Raised surfaces use `shadow-dimensional` through `--shadow-raised`. Floating layers (menus, the drawer) keep Arc's `--shadow-floating`, the one exception to the shadow rule in [SKILL.md](SKILL.md).
- Light only. `nextnode.css` maps light values, and Arc turns dark only on `data-theme="dark"`: never set it until `nextnode.css` has a dark block built from the dark-mode notes in [colors.md](colors.md).
