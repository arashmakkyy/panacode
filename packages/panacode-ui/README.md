# `@panacode/ui`

Panacode-owned SolidJS design system and presentation adapters for the OpenCode-based desktop app.

- **Primitives** — Switch (Arc MCP reference), Button, Input, SegmentedControl
- **Features** — AI Chat, AI Composer, Agent Run, Agent Orchestrator, Agent Approvals, Tool Call, Code Suggestion, MCP Servers
- **Adapters** — map OpenCode domain state → presentation props (no second source of truth)
- **Styles** — Arc tokens + Phase 2 `[data-brand="panacode"]` shell overlay

See `panacode-docs/UPSTREAM-MERGE.md` for ownership and merge rules.

Do not import the React Arc demos from `.panacode-ref/` into this package.

## Side-effect entry points (imported once by packages/app/src/settings/model.tsx)

- `@panacode/ui/icons` swaps the upstream icon artwork for lucide (stroke 1.75) through the
  `setIconArtwork` hook in `packages/ui/src/icons/catalog.ts`. The artwork file is generated:
  `bun script/panacode-icons-generate.ts` (edit the name map there; a lucide-react install is the source).
- `@panacode/ui/motion` installs Arc spring timings as CSS easings on `:root`:
  `--spring-snappy|smooth|morph` (a `linear()` curve) and `--spring-*-duration` (0ms under reduced motion).
  Use `transition: transform var(--spring-snappy-duration) var(--spring-snappy)`; in TS use `arcSpring` / `springTo`.

Brand packs: see `src/brand/README.md`.
