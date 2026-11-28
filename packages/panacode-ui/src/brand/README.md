# Panacode brand packs

The brand is **temporary and swappable**. Firouzeh is the current pack. Taq and Lazhvard are drafted in
`/workspace/panacode-brand/1-taq` and `2-lazhvard` and can become packs the same way.

## What a brand pack may own

A pack owns **colour, fonts and logo only**. Arc (packages/panacode-ui/src/theme/tokens.css) owns shape, type rules and motion:

| Owned by the pack | Owned by Arc (never override in a pack) |
| --- | --- |
| palette (`--background`, `--foreground`, greys, accent, status colours) | radii 18 / 26 / 34 (`--radius-control/panel/surface`) |
| font families (`--font-sans`, `--font-display`, `--font-mono`) | weights 400 / 500 only, no uppercase labels |
| marks, wordmark, lockups, app icon, tagline | type scale (`--text-*`), spacing, durations, springs |
| display tracking for the wordmark and hero | icon set (lucide, stroke 1.75) |

## Pack layout

```
packs/<id>/
  brand.ts       pack manifest: id, name, tagline(Fa), publisher, theme { dark, light } palettes
  geometry.ts    MARK_PATH / WORDMARK_PATH (outlined, so no font is needed to draw the logo)
  index.tsx      BrandMark, BrandWordmark, BrandLockup, brand, brandIcon
  tokens.css     aliases for active workbench roles, logo colours and fonts
  fonts.css      @font-face for the pack fonts, fonts/ holds the OFL files
  assets/        icon-1024.png (desktop icon + favicon source), mark*.svg, wordmark.svg, lockups
  BRAND.md       rationale and usage notes
```

## Swap the active pack (one folder + one command)

1. Copy `packs/firouzeh` to `packs/<id>` and replace `brand.ts` palette, `geometry.ts` paths,
   `tokens.css` colours/fonts, `fonts/`, and `assets/` (icon-1024.png at least).
   The light and dark workbench colours live in `brand.ts`. Its `palette`, `overrides` and `v2Overrides` feed the app, editor and terminal.
   Alias those theme roles in `tokens.css` so users can switch themes.
2. Run `bun script/panacode-brand-apply.ts <id>`. It rewrites `active.ts` and `active.css` (the only files that
   name a pack), regenerates `packages/ui/src/theme/themes/panacode.json`, the desktop icons and favicons, and the
   brand seed in `packages/app/public/oc-theme-preload.js` (first-paint colours).
   For palette changes in the current pack, use `bun script/panacode-brand-apply.ts firouzeh --colors-only` to keep the existing artwork.
3. Check: `bun script/panacode-brand-scan.ts`, `bun run panacode:ui-ownership`, `bun run typecheck` and
   `bun test` in packages/panacode-ui and packages/app (theme-preload.test.ts follows the seed automatically).

No component imports a pack directly; everything goes through `@panacode/ui/brand` (`active.ts`).
