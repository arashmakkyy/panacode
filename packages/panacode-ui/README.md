# `@panacode/ui`

Panacode-owned SolidJS design system and presentation adapters for the OpenCode-based desktop app.

- **Primitives** — Switch (Arc MCP reference), Button, Input, SegmentedControl
- **Features** — AI Chat, AI Composer, Agent Run, Agent Orchestrator, Agent Approvals, Tool Call, Code Suggestion, MCP Servers
- **Adapters** — map OpenCode domain state → presentation props (no second source of truth)
- **Styles** — Arc tokens + Phase 2 `[data-brand="panacode"]` shell overlay

See `panacode-docs/UPSTREAM-MERGE.md` for ownership and merge rules.

Do not import the React Arc demos from `.panacode-ref/` into this package.
