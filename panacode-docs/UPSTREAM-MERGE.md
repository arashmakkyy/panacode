# Panacode ← OpenCode upstream merge guide

This document is the authoritative guide for merging newer OpenCode versions into the Panacode fork without destroying the Panacode design system.

Read this **before** editing UI surfaces or running an upstream merge.

---

## A. Repository identity

| Item | Value |
|---|---|
| Upstream repository | `https://github.com/anomalyco/opencode` |
| Panacode fork | `https://github.com/arashmakkyy/panacode` |
| Upstream integration branch | `dev` (verified via `upstream/dev`) |
| Panacode working branch for this redesign | `panacode/redesign-v2` |
| Isolation branch | `panacode-isolation`, based on `82d54281e79f33fb08e3d7db7adb166436857c43` from `panacode/redesign-v2` |
| Isolation fixes branch (local, not pushed) | `isolation-fixes`, based on `9618e4d5ac3ae5b5997807d8385fd63a9e468621` (tip of `panacode-isolation`); audit fixes 00–15 |
| Fork default branch | `dev` (this fork's `dev` matches upstream at the baseline below; it is not a Panacode release branch) |
| Recommended stable Panacode branch | none yet. Do not treat `dev` as the branded product branch. |
| Baseline (merge-base of `panacode/redesign-v2` with `origin/dev`) | `cbe71595e1f370ff91b3081872b96bbe56519c41` |
| Stage 1 parent (docs + reference projects) | `94d16f928de1bcdd2f12be8961416aae41ecfe2e` |
| Previous redesign tip contained in this branch | `4f3a17ba1a` (r8). Stage 1 does not claim that tip finished the redesign. |
| Baseline date (UTC) | 2026-11-18 |
| Recorded upstream tip | `cbe71595e1f370ff91b3081872b96bbe56519c41` on `origin/dev` (the fork `dev` equals that upstream commit; `upstream/dev` was not fetched in this environment) |
| Toolchain | Bun `1.4.4` (root `packageManager`), SolidJS via workspace catalog, Electron desktop in `packages/desktop` |
| Design package | `@panacode/ui` → `packages/panacode-ui` |

Remotes (expected):

```text
origin    → https://github.com/arashmakkyy/panacode.git
upstream  → https://github.com/anomalyco/opencode.git
```

Do **not** replace `upstream` with the Panacode fork. If `upstream` is missing:

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
```

Update the baseline SHA in this section after every successful upstream integration.

---

## B. Panacode customization architecture

### Goal

**Functional OpenCode underneath. Visually independent Panacode on top.**

Presentation lives in Panacode-owned modules. Domain state, session engine, tools, MCP controllers, diff engine, terminal PTY, and providers stay upstream.

### Design system location

```text
packages/panacode-ui/          # @panacode/ui — Panacode-owned
  src/
    theme/                     # theme id helpers (PANACODE_THEME_ID)
    tokens/                    # reserved; CSS tokens live in theme/tokens.css
    primitives/                # Switch, Button, Input, SegmentedControl
    features/                  # 8 Arc-ported feature shells (SolidJS)
    adapters/                  # pure mappers: OpenCode state → presentation props
    styles/                    # tokens + feature CSS + Phase 2 shell overlay
    motion/
    components/ icons/         # reserved for shared composites
```

Reference Arc React demos (gitignored, not shipped):

```text
.panacode-ref/                 # extracted panacode-arc-ex.zip contents
```

### Theme + tokens

1. **Desktop theme JSON (upstream theme pipeline):** `packages/ui/src/theme/themes/panacode.json`  
   Registered in `packages/ui/src/theme/context.tsx` display names as `panacode: "Panacode"`. This still drives the upstream `--v2-*` variables.
2. **Arc CSS tokens (Panacode-owned):** `packages/panacode-ui/src/theme/tokens.css`. Light values live on `[data-brand="panacode"]`. Dark values live on `[data-brand="panacode"][data-color-scheme="dark"]`. The app sets `data-color-scheme` in `applyThemeCss`. `data-theme` is the theme id (`panacode`), not the scheme. Tokens do not paint the document root and do not set a global focus ring.
3. **App default:** `packages/app/src/app.tsx` sets `defaultTheme={PANACODE_THEME_ID}`, `defaultColorScheme="dark"` (only when no scheme is stored), `data-brand="panacode"`, and `<Title>Panacode</Title>`. Light still works when the user selects it.
4. **Stage 1 shell:** `packages/panacode-ui/src/shell/frame.tsx` plus `shell.css`. Mounted at the real window, titlebar, sidebar, and home nodes. Empty, loading, and error states for the session list use `EmptyState`, `Skeleton`, and `ErrorState`. This is not a CSS overlay on selectors that do not exist. Chat, composer, tools, and review are not restyled here.

### Adapter pattern

```text
OpenCode services / session / MCP controllers
                │
                ▼
     packages/panacode-ui/src/adapters/*
                │
                ▼
     packages/panacode-ui/src/features/*
                │
                ▼
     packages/app adapters (thin wiring)
```

App-owned wiring examples:

- `packages/app/src/settings/panacode-mcp-panel.tsx` → MCP settings presentation
- `packages/app/src/session/panacode-permission-adapter.tsx` → Agent Approvals presentation over real permission decide()

### Canonical Switch

Visual source of truth: Arc MCP Servers animated switch, ported to SolidJS + Kobalte:

- Primitive: `packages/panacode-ui/src/primitives/switch.tsx` (`data-component="panacode-switch"`)
- Upstream Kobalte switch (`@opencode/ui/switch`, `data-component="switch"`) is **restyled** by `shell.css` under `[data-brand="panacode"]` so existing call sites pick up the Arc pill without rewriting every import.

Do not introduce a second conflicting switch look.

### Preserved upstream packages

Keep and prefer upstream for:

- `@opencode/core`, `@opencode/server`, `@opencode/client`, `@opencode/session-ui` domain logic
- Diff/review engines (`@pierre/*`), terminal emulator, provider plugins
- Desktop Electron shell logic (branding/productName already Panacode in `packages/desktop`)

Internal package names `@opencode/*` remain for upstream compatibility.

---

## C. Changed-file ownership matrix

| File or directory | Owner | Reason | Upstream conflict risk | Merge guidance |
|---|---|---|---|---|
| `packages/panacode-ui/**` | Panacode-owned | Design system + adapters + feature shells | Low | Keep ours; only sync if intentionally re-porting Arc refs |
| `panacode-docs/**` | Panacode-owned | Maintenance docs | Low | Keep ours; update after merges |
| `script/panacode-ui-ownership-check.ts` | Panacode-owned | Static guard | Low | Keep ours |
| `.panacode-ref/` | External reference | Extracted Arc demos (gitignored) | None | Never commit; never copy React demos into production |
| `packages/ui/src/theme/themes/panacode.json` | Panacode-owned (lives in upstream theme dir) | Theme file required by OpenCode theme loader glob | Medium | Keep file; if upstream changes theme schema, adapt JSON |
| `packages/ui/src/theme/context.tsx` | Shared integration boundary | Added `panacode` display name only | Medium | Re-apply one-line name map if upstream rewrites THEME_NAMES |
| `packages/app/package.json` | Shared integration boundary | Adds `@panacode/ui` dependency | Medium | Preserve dependency when resolving package.json conflicts |
| `packages/app/src/index.css` | Shared integration boundary | Imports `@panacode/ui/styles` | Medium | Keep `@import "@panacode/ui/styles"` |
| `packages/app/src/app.tsx` | Shared integration boundary | Default theme, default dark scheme, brand mark, title | High | Re-apply Panacode ThemeProvider/Title/brand hooks after upstream app shell changes |
| `packages/ui/src/theme/context.tsx` | Shared integration boundary | Optional `defaultColorScheme` when storage is empty | Medium | Keep the prop optional; upstream callers stay on system |
| `packages/app/src/shell/shell.tsx` | Shared integration boundary | Root and sidebar render `WindowFrame` / `SidebarFrame` | High | Re-apply the two component mounts; do not restyle the motion machine |
| `packages/app/src/shell/titlebar/titlebar.tsx` | Shared integration boundary | Header is `TitlebarFrame`; mobile help no longer opens upstream Discord; on Linux the app menu sits in the sidebar header (the titlebar is hidden with vertical tabs) | High | Re-apply the frame mount and the Linux `WindowsAppMenu` in the sidebar header |
| `packages/app/src/home/route.tsx` | Shared integration boundary | Home panel is `HomeFrame` | Medium | Re-apply the frame mount |
| `packages/app/src/home/sessions/view.tsx` | Shared integration boundary | Empty, unavailable, and skeleton rows use Panacode states | High | Keep session controllers; re-apply the three presentation mounts |
| `packages/app/src/shell/errors/error.tsx` | Shared integration boundary | Error page uses Panacode shell colors; upstream Discord link removed | Medium | Re-apply the shell attribute; do not restore the opencode.ai link |
| `script/panacode-brand-scan.ts` | Panacode-owned | User-visible brand guard | Low | Keep ours; extend the allowlist only for internal ids, license lines, and real upstream service names |
| `.github/workflows/panacode-ui.yml` | Panacode-owned | CI for ownership + brand scan | Low | Keep ours |
| `.github/workflows/check.yml` | Shared integration boundary | Same two scripts run in the main check job | Medium | Re-add the step if upstream rewrites the workflow |
| `packages/app/src/settings/providers/extensions.tsx` | Shared integration boundary | MCP tab uses `PanacodeMcpPanel` | High | Prefer Panacode panel; port any new upstream MCP row features into the adapter |
| `packages/app/src/settings/workspaces/project-extensions.tsx` | Shared integration boundary | Project MCP tab uses `PanacodeMcpPanel` | High | Keep Panacode panel; preserve plugins/skills/lsps tabs from upstream |
| `packages/app/src/settings/panacode-mcp-panel.tsx` | Panacode-owned | MCP presentation adapter | Low | Keep ours |
| `packages/app/src/session/panacode-permission-adapter.tsx` | Panacode-owned | Approvals presentation adapter | Low | Keep ours |
| `packages/app/src/session/composer/session-composer-region.tsx` | Shared integration boundary | Permission dock → Panacode adapter | High | Preserve adapter wiring; merge new docks/features carefully |
| `packages/session-ui/src/timeline-next/overrides.ts`, `row.tsx`, `tools/assistant-content.tsx`, `tools/context-group.tsx` | Shared integration boundary | `setTimelineOverrides` (ContextGroup, FileGroup, ThoughtRow, TextFooter) rendered through `<Dynamic>`; `setToolTurn`/`toolTurn` maps a tool part to the user message of its turn | High | Re-apply the `<Dynamic component={timelineOverride(...) ?? X}>` call sites and the `setToolTurn` call after `patchPartKeys.set` |
| `packages/app/src/session/panacode-timeline.tsx`, `panacode-code-suggestion.tsx`, `panacode-chat.tsx` | Panacode-owned | Arc Tool Call, Code Suggestion and AI Chat parts registered as timeline overrides | Low | Keep ours |
| `packages/session-ui/src/message/message-content.tsx`, `message/footer-override.ts` | Shared integration boundary | The reply footer renders the `TextFooter` override when one is set (Arc reply actions, sources, Retry) | Medium | Re-apply the `<Dynamic component={textFooterOverride()}>` block in `AssistantTextContent` |
| `packages/app/src/composer/model.ts` | Shared integration boundary | Hidden `prompt.submit` command; the reply Retry action rewinds the turn and runs it | Low | Re-add the command entry |
| `packages/core/src/plugin/provider/panaai.ts` | Panacode-owned | PanaAI models get low/medium/high `reasoningEffort` variants (the composer effort control; thinking shows with an effort) | Low | Keep ours |
| `packages/app/src/composer/editor/editor.tsx` | Shared integration boundary | Arc composer parts from `@panacode/ui/features/ai-composer`: `SendButton` (send→stop ring) in `ComposerEditorSubmitButton`, `EffortMenu` replaces the variant select (`ComposerEditorEffort`), `AttachmentChip` for files/attachments/uploads, Arc `/` and `@` rows (`pc-aic-option`, row height 44, max height 280) | Medium | Re-apply the four swaps on the upstream markup; keep `data-action` names |
| `packages/app/src/session/composer/region.tsx` | Shared integration boundary | Mounts `PanacodeAgentRun` (Arc Agent Run card for the latest turn) at the top of the `above` lane | Low | Re-add the mount |
| `packages/app/src/session/requests/model.ts`, `permission-machine.ts` | Shared integration boundary | `decide(decision, message?)`: a rejection can carry a note (Agent Run "Send back"); the reply sends `message` | Low | Re-add the optional `message` field |
| `packages/app/src/session/panacode-agent-run.tsx` | Panacode-owned | Builds the run from the turn's messages, permission request and tool state | None | Keep ours |
| `packages/app/src/session/panacode-orchestrator.tsx` | Panacode-owned | Arc Agent Orchestrator for a turn with `subagent`/`task` calls: each call is a lane, its child session (`data.session.message.list/status`) the worker; Stop interrupts the lead and running children | None | Keep ours |
| `packages/app/src/settings/panacode-mcp-panel.tsx` | Panacode-owned | Arc MCP Servers on real state: server list/status, config entry (transport, credential-free endpoint), resource catalog, shared MCP controller (connect, disconnect, sign-in), `experimental.mcp.add/remove` (runtime only, not written to config) | None | Keep ours |
| `packages/app/src/shell/commands/dialog.tsx` | Shared integration boundary | Arc command palette: `glideHighlight` on the results, a `Ctrl K` key chip as the SearchList `trailing`, a lucide glyph on command/setting rows; skin in `panacode-ui/src/shell/arc-palette.css` | Low | Re-add the `onMount` glide, the `trailing` prop and `PaletteGlyph` |
| `packages/panacode-ui/src/theme/tokens.css` (`--series-2..4`) | Panacode-owned | Lane colors for the orchestrator (violet, amber, teal tones) | None | Keep ours |
| `packages/app/src/composer/composer.tsx` | Shared integration boundary | Model chip provider wrapped in `data-slot="composer-model-provider"` so a narrow composer hides it | Low | Re-wrap |
| `packages/app/src/runtime/i18n/en.ts` (`command.provider.connect.description`) | Panacode copy | "Sign in to PanaAI or another model provider" | Low | Keep ours |
| `packages/session-ui/**` | Upstream-owned | Session domain/UI | High | Prefer CSS overlay / adapters over rewriting; only touch when new hooks needed |
| `packages/desktop/**` | Shared (branding already Panacode) | App identity / packaging | High | Keep Panacode appId/productName; take upstream Electron fixes |
| `packages/ui/src/icons/catalog.ts` | Shared integration boundary | `setIconArtwork(body, viewBox)` override registry; `getIcon` checks it first (lucide via `@panacode/ui/icons`) | Medium | Re-apply the 13-line hook if upstream rewrites the catalog; new upstream icon names need a MAP entry in `script/panacode-icons-generate.ts` (unmapped names fall back to upstream art) |
| `packages/app/src/settings/model.tsx` | Shared integration boundary | Side-effect imports `@panacode/ui/icons` and `@panacode/ui/motion`; default `tabLayout` is `inbox` (workspace sidebar) | Medium | Re-apply the two imports and the default |
| `packages/desktop/src/renderer/startup/splash.*` | Shared integration boundary | Splash uses the active brand pack | Medium | Keep the `SplashBrand` mount |
| `packages/cli/src/services/service-config.ts` | Shared integration boundary | `PANACODE_SERVICE_PORT = 0xC0AC` replaces upstream's `0xC0DE` in `channelPort` (Windows maps it to `0x70AC` = 28844) so Panacode and OpenCode can run together (decisions D-016) | Medium | Keep the Panacode constant; take upstream changes to the Windows mapping in `defaultPort` and re-check `packages/cli/test/service.test.ts` |
| `packages/desktop/src/main/service/background-service.ts` | Shared integration boundary | Installs the `panacode-cli` sidecar, writes `product: "panacode"` registration, and launches the managed server with `PANACODE_*` env. Packaged Windows no longer forces `--port 0x70ac`: a saved `panacode service set port` or the Panacode CLI default wins | Medium | Keep `0x70ac` only as `ServiceConfig.defaultPort("latest", "win32")`; never reintroduce a forced `--port` in the desktop |
| `packages/cli/src/services/port-owner.ts` | Shared integration boundary | Windows branch (`netstat` + `tasklist`) names the process holding the port; upstream returns `undefined` on Windows | Low | Keep the Windows branch unless upstream adds its own |
| `packages/gui-plugins/src/updater/panacode.ts`, `updater/main.ts`, `updater/renderer.tsx` | Panacode flag + two guarded hunks | `PANACODE_UPSTREAM_UPDATES = false`: no desktop updater (feed `opencode.ai/update/api/.../opencode`), no Check for Updates menu/settings/titlebar/error-page buttons, no What's New (`opencode.ai/changelog.json`) (decisions D-017) | Low | Keep the early return in `main.ts` and the two guards in `renderer.tsx`; set the flag to `true` only when Panacode has its own feed. The upstream `publish` feeds are removed from `packages/desktop/electron-builder.config.ts`; do not restore them during an upstream merge |
| `packages/util/src/product-env.ts`, `packages/cli/src/env-bootstrap.ts` | Panacode-owned | `PANACODE_*`-only runtime contract; `sanitizeProductEnv()` deletes inherited `OPENCODE_*` runtime keys before any other module reads the environment | Low | Keep the sanitizer side-effect import first in the CLI and desktop start path; never add an `OPENCODE_*` fallback or copy `PANACODE_*` onto it |
| `packages/core/src/config.ts`, `packages/core/src/config/discovery.ts`, `packages/schema/src/config.ts` | Shared integration boundary | Read-only legacy `opencode.json`/`opencode.jsonc`/`.opencode/` discovery; only `tool_output.max_lines` and `tool_output.max_bytes` import under a `legacy: true` document below Panacode values | Medium | Keep the allowlist and `Sources.legacy`; never activate legacy plugins, never write a legacy file, and never let legacy values override Panacode config |
| `packages/desktop/src/main/native/support-archive.ts`, `packages/desktop/src/main/native/logging.ts`, `packages/desktop/src/main/lifecycle/deep-link.ts` | Shared integration boundary | Support ZIP is `panacode-debug-*.zip` and contains only `manifest.json` plus structured `diagnostics.jsonl` (fixed allowlist, bounded error codes, no raw logs/dumps/NetLog/absolute user paths). Deep-link logging stores only `event/source/count/route`; handlers still receive the original URL (decisions D-019/D-020) | Medium | Keep the allowlist, root/file identity checks, atomic write, and summary-only deep-link logger when merging log or lifecycle changes |
| `packages/desktop/resources/windows/installer.nsh` | Shared integration boundary | Ownership comes from the build-time `.panacode-install` manifest (app ID, version, executable, size + relative path). Cleanup removes only size-matching manifest files, prunes empty directories, never follows reparse points, and never recursively deletes a shared tree. A pre-manifest shared install is recognized only from this app's registry entry plus `Panacode.exe` for location/migration decisions; its files/processes are never removed. The old uninstaller is never executed | High | Keep manifest validation, registry pre-clear, exact cleanup and `--stage` verification. Never restore the old “remove shared directory when no top-level `.exe` remains” rule or run a previous uninstaller |
| `script/panacode-isolation-check.ts`, `script/panacode-test-contract.ts`, `.github/workflows/panacode-isolation.yml` | Panacode-owned | CI guard for ambient `OPENCODE_*` reads plus three reintroduction shapes (`dev/install`, bare `opencode-pty` via PATH, upstream `@opencode/cli-*` download). The contract wrapper fails on missing path, zero pass, excess skip, unhandled error, missing summary, timeout or non-zero exit. The workflow runs guards/quality on Ubuntu and platform acceptance (NTFS junction, lifecycle, live foreign PID, shell, ZIP, PTY, state root, client, GUI, NSIS) on `windows-latest`, with no publish | Low | Keep ours; no Windows acceptance step may regress to a skip. Extend the allowlist only for deliberate provider credentials or defensive scrubbing |
| `packages/cli/src/services/service-control.ts`, `shell-config.ts`, `service-registration.ts`, `service-config.ts`, `updater.ts`, `packages/cli/src/commands/handlers/uninstall.ts`, `commands/handlers/service/*` | Shared integration boundary | Private owner-only control channel before any HTTP lifecycle action; registration validation; manifest/package ownership before uninstall; exact managed PATH fragment removal with byte preservation; manual-only Panacode updater | Medium | Keep control-before-HTTP and ownership proof. Never reintroduce PID-based termination of discovered services, name-only ownership, or an upstream update/install feed |
| `packages/cli/src/database-path.ts`, `packages/cli/src/server-process.ts`, `packages/cli/src/commands/handlers/debug/paths.ts` | Shared integration boundary | One canonical database boundary: target, `-wal`/`-shm`/`-journal` and every known OpenCode root are resolved; foreign containment, broken links and existing files with `nlink > 1` are refused before SQLite opens (D-020) | Medium | Keep the canonical root list and segment-boundary containment; never move the check after opening or add a fallback that ignores a refusal |
| `packages/client/src/service.ts`, `service-probe.ts`, `service-control.ts`, `service-file.ts`, `service-contender.ts`, `promise/service.ts`, `effect/service.ts` | Shared integration boundary | Product/instance/registration identity, verified control ping before stop/PTY, quarantine-based owned-record removal, atomic contender publish, and bounded boot diagnostics | High | Preserve ownership -> compatibility -> version -> state, and `Service.verified` before any lifecycle command. Never adopt or signal an unowned record |
| `packages/core/src/persistent-pty/binary.ts`, `binary.bun.ts`, `binary.node.ts`, `daemon.ts`, `packages/cli/script/opencode-pty.ts`, `packages/cli/script/build-node.ts`, `packages/cli/vite.node.config.ts` | Shared integration boundary | PTY executable must be an absolute ordinary file verified by digest; packaged Bun uses only the embedded release asset in a private digest-verified cache; Node requires an absolute path plus `PANACODE_PTY_BIN_SHA256` when set; the SEA prelude repairs a corrupt cached asset (D-020) | Medium | Never accept a bare `opencode-pty`/PATH name, a linked file, or a runtime override in a packaged build |
| `packages/desktop/src/main/service/state-root.ts`, `sidecar-probe.ts`, `sidecar-probe-electron.ts`, `background-service.ts`, `background-service-machine.ts`, `desktop-cli.ts`, `cli-service-file.ts`, `packages/desktop/src/main/lifecycle/environment.ts`, `packages/util/src/global-roots.ts` | Shared integration boundary | One resolved state root (isolated dev > absolute inherited `XDG_STATE_HOME` > absolute shell value > `~/.local/state`), effective root written back for child CLIs, keyed probe, bounded child output and boot record | Medium | Keep the precedence table, the write-back, and the probe key; never adopt a probe from another root/identity |
| `packages/desktop/script/utils.ts`, `build.ts`, `dev.ts`, `verify-cli-provenance.ts`, `packages/desktop/electron-builder.config.ts` | Shared integration boundary | Desktop stages only a local CLI whose dist manifest, target, os/cpu, machine architecture and bytes match a written provenance record; no upstream `@opencode/cli-*` download or PATH fallback; `publish: null`. The `afterPack` install-manifest writer uses Node `fs` APIs because electron-builder executes it in its Node process, not under Bun | Medium | Keep the dist-directory map and provenance checks; never restore a download fallback or a `Bun.*` call in the `afterPack` path |
| `packages/gui-plugins/src/managed-cli.ts`, `packages/gui-plugins/src/ssh/*`, `packages/gui-plugins/src/wsl/*` | Shared integration boundary | Remote CLI installs use pinned registry metadata plus sha512/sha256 and a private cache; no `dev/install` script, mutable tag or unpinned URL; sidecar discovery validates product/version/target/digest | Medium | Keep integrity/target validation and atomic install; never re-add a remote installer script |
| `packages/protocol/src/groups/server.ts`, `packages/server/src/handlers/server.ts`, `packages/server/src/options.ts`, `packages/server/src/process.ts` | Shared integration boundary | `/api/info` and both health phases carry `product: "panacode"` and the boot `instance`; restart gets a new identity | Medium | Keep the optional `instance` field and the identity match in both clients |
| `install` | Shared integration boundary | Git Bash/POSIX installer writes exactly one managed PATH block, quotes paths with spaces, and builds config candidates as arrays; existing OpenCode PATH entries are untouched | Medium | Keep the managed markers and array-based candidate list |
| `packages/cli/test/**`, `packages/client/test/**`, `packages/core/test/**`, `packages/desktop/**/*.test.ts`, `packages/gui-plugins/**/*.test.ts` | Panacode-owned tests | Behavioral regressions for the ownership, root, PTY, archive, shell, identity and Windows-acceptance contracts above | Low | Keep them beside their source; they are the merge safety net and must fail when the production behavior regresses |
| `script/panacode-icons-generate.ts`, `script/panacode-brand-apply.ts` | Panacode-owned | Generated lucide artwork; brand pack swap | Low | Keep ours |
| `bun.lock` | Generated | Lockfile | Medium | Regenerate after resolving package.json |
| `release/desktop/*.exe` | Generated output | Installers | None | Do not commit binaries |

Classification reminder: modifying an upstream file does **not** make it Panacode-owned. Prefer moving presentation into `@panacode/ui` when a touch becomes large.

---

## D. Component replacement map

Status, stated honestly. Rows marked Ported are full Arc ports wired to real session state; the rest are still from the previous attempt.

| Feature | Upstream surface | Panacode feature | Adapter | App wiring | Status |
|---|---|---|---|---|---|
| App shell | `shell/shell.tsx`, `shell/titlebar/titlebar.tsx` | `shell/frame.tsx` (`WindowFrame`, `TitlebarFrame`, `SidebarFrame`) | none; the frames are the integration | Mounted | Stage 1. Behavior (peek, resize, tabs, commands) stays upstream |
| Home / sessions | `home/route.tsx`, `home/sessions/view.tsx` | `HomeFrame`, `EmptyState`, `ErrorState`, `Skeleton` | none | Mounted | Stage 1. Session data is still the upstream controller |
| Error page | `shell/errors/error.tsx` | shell attribute + tokens | none | Mounted | Stage 1. Discord/opencode.ai report link removed |
| AI Chat | timeline / message parts | `features/ai-chat` | `adapters/ai-chat.ts` | `panacode-chat.tsx` (timeline overrides) | Ported |
| AI Composer | composer | `features/ai-composer` | `adapters/ai-composer.ts` | `composer/editor/editor.tsx` | Ported |
| Agent Run | timeline tools | `features/agent-run` | `adapters/agent-run.ts` | `panacode-agent-run.tsx` (composer `above` lane) | Ported |
| Agent Orchestrator | subagents | `features/agent-orchestrator` | `adapters/agent-orchestrator.ts` | `panacode-orchestrator.tsx` (via Agent Run mount) | Ported. No concurrency control: the backend has none |
| Agent Approvals | permission dock | `features/agent-approvals` | `adapters/agent-approvals.ts` | `panacode-permission-adapter.tsx` | Previous attempt. Still low fidelity. Not revisited in stage 1 |
| Tool Call | `session-ui` tools | `features/tool-call` | `adapters/tool-call.ts` | `panacode-timeline.tsx` | Ported |
| Code Suggestion | review | `features/code-suggestion` | `adapters/code-suggestion.ts` | `panacode-code-suggestion.tsx` | Ported |
| MCP Servers | settings extensions | `features/mcp-servers` | `adapters/mcp-servers.ts` | `panacode-mcp-panel.tsx` | Ported. No per-tool switches or token budget: the API reports neither |
| Command palette | `shell/commands/dialog.tsx` | `shell/arc-palette.css`, `motion/glide.ts` (`glideHighlight`) | none | `dialog.tsx` (glide, key chip, glyphs) | Ported (free) |
| Dropdown / context menu | `@opencode/ui/menu`, `@opencode/ui/context-menu` | `shell/arc-menu.css`, `motion/glide.ts` (`menuGlide`) | none | `WindowFrame` attaches the glide to every menu that opens | Ported (free). Upstream menus have no danger variant, so Delete is not tinted |
| Toast stack | `@opencode/ui/toast` (solid-sonner) | `shell/arc-toast.css` | none | CSS over `.toast-v2`; sonner keeps stacking, swipe and timers | Ported (free) |
| Tooltip | `@opencode/ui/tooltip` (tooltip-v2) | `shell/arc-tooltip.css` | none | CSS over every tooltip | Ported (free) |
| Dialog | `@opencode/ui/dialog` (dialog-v2, `fit`) | `shell/arc-dialog.css` | none | CSS over confirm/form dialogs; palette and model menu excluded | Ported (free) |
| Search field | `home/sessions/view.tsx` (home session search) | `shell/arc-search.css` | none | CSS over the search label and results panel | Ported (free) |
| Tabs | `@opencode/ui/tabs` (tabs-v2 `pill` and `settings`) | `shell/arc-tabs.css`, `motion/glide.ts` | none | `menuGlide` also attaches to pill and settings tab lists | Ported (free) |
| Theme switch | `settings/appearance/appearance.tsx` (color scheme `Select`) | `primitives/theme-switch.tsx` (on `SegmentedControl`) | none | `appearance.tsx` renders `ThemeSwitch` inside `[data-action=settings-color-scheme]` | Ported (free). Re-apply the swap if upstream changes the row |
| Card / select / input | settings lists, `@opencode/ui/select`, `@opencode/ui/text-input` | `shell/arc-settings.css` | none | CSS over settings cards, select triggers and menus, settings inputs | Ported (free) |
| Resizable panels | `@opencode/ui/resize-handle` | `shell/arc-resize.css` | none | CSS over every resize handle; sizes and limits stay upstream | Ported (free) |
| Hover card | `@opencode/ui/hover-card` (tab popover) | `shell/arc-hover-card.css` | none | CSS over hover-card-content | Ported (free) |
| Shortcut recorder | `settings/keybinds/keybinds.tsx` | `primitives/shortcut-keys.tsx` (`ShortcutKeys`, `shortcutParts`) | none | the binding button renders `ShortcutKeys`; recording breathes via CSS | Ported (free) |
| Switch | `@opencode/ui/switch` | `primitives/switch.tsx` | — | primitive has the Arc spring; CSS bridge matches geometry for existing call sites | Stage 1 |

External deps of `@panacode/ui`: `@kobalte/core`, `@opencode/ui` (workspace), `solid-js` peer. **No React.**

Tests:

- `packages/panacode-ui/src/adapters/mcp-servers.test.ts`
- `bun script/panacode-ui-ownership-check.ts`

---

## E. Step-by-step upstream update procedure

Use a dedicated integration branch. Prefer merge (`--no-ff`) onto shared branches so history stays traceable. Do not force-push protected branches.

```bash
# 0) Clean tree
git status
# stash or commit local work first

# 1) Remotes
git remote -v
# ensure origin=panacode fork, upstream=anomalyco/opencode
git fetch origin
git fetch upstream

# 2) Inspect what is coming
git log --oneline --left-right HEAD...upstream/dev | head -100
git diff --stat HEAD...upstream/dev | head -200

# 3) Highlight high-risk Panacode touch points
git diff --name-only HEAD...upstream/dev | \
  rg 'packages/app/src/app\.tsx|packages/app/src/index\.css|packages/app/src/settings/providers/extensions\.tsx|packages/app/src/session/composer/session-composer-region\.tsx|packages/ui/src/theme/context\.tsx|packages/session-ui|packages/desktop|package\.json|bun\.lock'

# 4) Integration branch (date in America/Los_Angeles or UTC — record which)
git switch -c integration/upstream-$(date -u +%Y%m%d) origin/master
# or from your current Panacode stable tip

# 5) Merge
git merge --no-ff upstream/dev

# 6) Resolve conflicts using section F (never blanket ours/theirs)

# 7) Install + checks
bun install
bun script/panacode-ui-ownership-check.ts
bun --cwd packages/panacode-ui test
bun --cwd packages/panacode-ui typecheck
# then broader suite as needed:
# bun --cwd packages/app test
# bun typecheck

# 8) Manual UI checklist (sections H–I)

# 9) Update this document: baseline SHA, date, known risks

# 10) Merge integration branch into Panacode stable via PR
```

Before merging, review the upstream PR/commit list for new UI surfaces (section G).

---

## F. Conflict resolution playbook

**Never** use a blanket “always keep ours” or “always take theirs.”

Target outcome: **new upstream functionality + preserved Panacode visual identity.**

| Area | Prefer Panacode presentation when… | Prefer upstream when… | Adapter action |
|---|---|---|---|
| Application shell (`app.tsx`) | Theme default, Title, `data-brand` | New providers/error boundaries/routing | Re-insert brand hooks after accepting upstream structure |
| Shared UI (`@opencode/ui`) | Token/theme name map for `panacode` | New primitives/APIs | Extend shell.css; avoid forking whole components |
| Session UI / timeline | Message chrome styling | New part types, virtualizer, streaming fixes | Map new parts through adapters; CSS for chrome |
| Composer | Arc radii/actions styling | Submit lifecycle, mentions, slash commands | Keep controllers; restyle or wrap chrome |
| Agent timeline / tools | Tool card chrome | Tool schemas, execution status machine | Update `toToolCallStatus` / CSS |
| Permissions | AgentApprovals labels/layout | New permission kinds / decide() API | Update `panacode-permission-adapter` |
| MCP settings | `PanacodeMcpPanel` list chrome | New auth flows, server fields | Extend `toMcpServerViews` + panel actions |
| Code review | Suggestion header/mode control | Diff engine / review protocol | Keep Pierre; wrap presentation |
| Desktop packaging | `ai.panacode.*` appId, productName | Electron security/updater fixes | Merge code; keep identity constants |
| `package.json` / lockfiles | `@panacode/ui` workspace dep | Upstream version bumps | Combine both; regenerate lockfile |
| Generated files | — | Regenerate | Do not hand-merge binaries |

If an upstream change rewrites a file Panacode only lightly touched, accept upstream then re-apply the small integration hunks listed in section C.

---

## G. New upstream feature policy

When OpenCode adds a screen, control, or setting:

1. Ship the **functionality** immediately (do not block on perfect visuals).
2. Style it through existing Panacode primitives / `shell.css` / theme tokens.
3. If no primitive fits, add one under `packages/panacode-ui/src/primitives` (not a one-off in the feature).
4. Add or extend an adapter if props need mapping.
5. Add tests for adapters / ownership check updates.
6. Update this component map (section D).

Do **not** paste raw upstream JSX chrome into Panacode-owned feature folders without adaptation.  
Do **not** embed the React Arc demos or add `react` / `react-dom` to `packages/app`.

---

## H. Regression testing checklist

Commands (from repo root `/` of the panacode checkout):

```bash
bun script/panacode-ui-ownership-check.ts
bun --cwd packages/panacode-ui test
bun --cwd packages/panacode-ui typecheck
bun --cwd packages/app typecheck   # when environment allows
bun --cwd packages/desktop test   # packaging identity tests
```

Manual / product:

- [ ] Desktop startup (splash shows Panacode)
- [ ] Session create / restore
- [ ] Streaming assistant responses
- [ ] Composer send / stop / draft persistence
- [ ] Model selection
- [ ] Agent execution + cancellation
- [ ] Tool calls expand/collapse + errors
- [ ] Permission once / always / reject
- [ ] MCP toggle, connect/auth, DialogMcp
- [ ] Code review / diffs
- [ ] File explorer operations
- [ ] Terminal PTY input/ANSI
- [ ] Browser tab chrome (if used)
- [ ] SSH / WSL where supported
- [ ] Settings persistence (including theme = Panacode)
- [ ] Light and dark schemes under Panacode theme
- [ ] Keyboard shortcuts
- [ ] Desktop packaging identity (`ai.panacode.desktop*`)
- [ ] No update offer anywhere (error page, Settings → Updates, titlebar, app menu) while `PANACODE_UPSTREAM_UPDATES` is false; never an OpenCode release
- [ ] Panacode starts while OpenCode desktop is open (service port 28844 on Windows, 49324 elsewhere)

Platform notes: Windows NSIS installers live under `release/desktop/` (generated; not source of truth). Linux metainfo generation uses Panacode appIds in `packages/desktop/script/copy-metainfo.ts`.

---

## I. Visual regression checklist

Under `[data-brand="panacode"]` and theme `panacode`:

- [ ] Switch pill (42×24) matches Arc MCP reference; reduced-motion respected
- [ ] Buttons / inputs / dialogs / popovers / menus / tabs use Arc radii
- [ ] Sidebar + settings headers use muted surfaces
- [ ] Composer card elevation + radius
- [ ] Tool cards + permission dock actions
- [ ] MCP Servers panel search + rows
- [ ] Loading indicators / toasts still readable
- [ ] Light and dark modes
- [ ] No leftover OpenCode wordmark in app-controlled chrome (Title = Panacode)

Prefer existing Storybook / screenshot infrastructure when present; do not invent a second visual test stack.

---

## J. Rollback and recovery

| Situation | Safe action |
|---|---|
| Merge in progress, conflicts unmanageable | `git merge --abort` |
| Validation failed on integration branch | Fix forward on the branch, or reset soft to pre-merge commit **only if unpublished** |
| Integration already merged to stable | `git revert -m 1 <merge_commit>` (preserves history) |
| Need known-good desktop binary | Reinstall previous `release/desktop` artifact / prior GitHub Release; do not `git reset --hard` shared branches |
| Uncommitted work during incident | `git stash push -u -m "wip before recovery"` |
| Broken theme only | Set theme back via UI or clear theme storage key; confirm `panacode.json` still loads |

Prefer non-destructive recovery. Destructive resets are last resort and never the default on shared branches.

---

## K. Future AI agent instructions

1. Read **this file** before changing UI or merging upstream.
2. Identify ownership (section C) before editing. Prefer `packages/panacode-ui` for presentation.
3. Keep application logic in OpenCode services; use adapters for props only.
4. Minimize edits to upstream-owned files; document every unavoidable touch here.
5. Do not duplicate Switch/Button/Input — extend primitives.
6. Preserve Panacode visual identity (`data-brand="panacode"`, theme id `panacode`).
7. Run ownership check + adapter tests + relevant package tests.
8. Update sections A, C, D, L whenever integration boundaries change.
9. Never commit `.panacode-ref/` or React demo apps into production packages.
10. Never weaken permission semantics to simplify UI.

---

## L. Known risks and limitations

- **High-risk files:** `packages/app/src/app.tsx`, session composer region, settings extensions, theme context, desktop builder config. Upstream refactors here will conflict.
- **Shell CSS selectors** (`[data-component=…]`) can drift if upstream renames data attributes — treat as soft coupling; fix selectors deliberately.
- **Stage 1 only.** The shell (window, titlebar, sidebar, home, session empty/loading/error) is mounted. Chat, composer, tool call, code suggestion, agent run, and orchestrator are not. Approvals and MCP remain the earlier low-fidelity mounts.
- **Brand scan.** `bun script/panacode-brand-scan.ts` fails on user-visible `opencode` in prose, docs/Discord/GitHub links, and `www.opencode.ai`. It allows internal ids, license lines (`Forked from OpenCode`, the trademark sentence), and the upstream product names OpenCode Go / Console / Zen / Free because those are the services a person actually signs into.
- **Upstream tip.** Baseline is `cbe71595e1` on `origin/dev`. Fetch `upstream` before the next integration; it was not available in the stage 1 environment.
- **Release channel:** Panacode must not consume OpenCode production update feeds. The desktop updater is off behind `PANACODE_UPSTREAM_UPDATES` (D-017). The CLI updater is manual-only: it never fetches a feed or runs an upstream installer; `check` points at `https://github.com/arashmakkyy/panacode/releases`, and `apply`/`latest`/`upgrade`/`managed` fail with "Panacode updates are manual". Do not restore an upstream feed during a merge.
- **Runtime isolation:** product code reads `PANACODE_*` only. `sanitizeProductEnv()` runs at CLI and Desktop startup and deletes inherited `OPENCODE_*` runtime keys. `script/panacode-isolation-check.ts` fails on a new ambient read. The retained exceptions are compile-time constants (`OPENCODE_VERSION`, `OPENCODE_CHANNEL`, `OPENCODE_TARGET`), the OpenCode-hosted provider credential name (`OPENCODE_API_KEY`, stripped from the inherited environment), and defensive password scrubbing in `packages/cli/src/server-process.ts`.
- **Sidecars and service:** packaged Desktop expects `panacode-cli` / `panacode-cli.exe` and `panacode-cli.version`; development uses `panacode-cli-dev`. Service registration carries `product: "panacode"`, and the client rejects a mismatched product. The saved `panacode service set port` wins over the default.
- **Legacy project config:** `opencode.json(c)` and `.opencode/` are read-only, allowlisted to `tool_output.max_lines` and `tool_output.max_bytes`. A merge that adds a new legacy import must extend the allowlist deliberately and add a test.
- **Service port:** Panacode's managed service port is its own (D-016). If an upstream merge changes `channelPort` or the desktop `servicePort`, keep Panacode's value distinct from upstream's.
- **No conflict-free guarantee:** Large upstream architectural changes can still require multi-day conflict resolution. This architecture reduces surface area and makes conflicts understandable; it does not eliminate them.
- **Unverified in this agent environment:** full desktop GUI smoke, Windows NSIS install, SSH/WSL, and broad `bun typecheck` across the monorepo may be incomplete depending on VM resources — re-run section H before shipping.

---

## M. Isolation checklist for an upstream merge

Run these after resolving conflicts, before merging the integration branch:

```bash
bun script/panacode-isolation-check.ts
bun script/panacode-brand-scan.ts
bun script/panacode-ui-ownership-check.ts
bun --cwd packages/util test test/product-env.test.ts
bun --cwd packages/core test test/config/discovery.test.ts test/config/config.test.ts test/config/watch.test.ts
bun --cwd packages/cli test test/updater-isolation.test.ts test/env.test.ts
bun --cwd packages/client test test/service-decision.test.ts
bun --cwd packages/desktop test script/electron-builder.config.test.ts src/main/service/desktop-cli-state.test.ts src/main/service/cli-stages.test.ts
```

Review points that upstream merges commonly reopen:

1. **No ambient `OPENCODE_*` read.** New runtime code uses `productEnv("SUFFIX")` or `process.env.PANACODE_*`. Build-time defines and third-party provider credentials are the only exceptions.
2. **No upstream feed.** Check `packages/cli/src/services/updater.ts`, `packages/gui-plugins/src/updater`, and `packages/desktop/electron-builder.config.ts` for a restored `publish` URL, changelog fetch, or installer command.
3. **Branded sidecars.** `packages/desktop/src/main/service/desktop-cli.ts`, `sidecar-probe.ts`, `script/utils.ts`, and `gui-plugins/src/wsl` must keep `panacode-cli*` names and `panacode-cli.version`.
4. **Service identity.** `service-registration.ts` writes `product: "panacode"`; `packages/client/src/service.ts` accepts it as optional for older servers, and `service-probe.ts` validates product and loopback before credentials.
5. **Legacy config stays read-only.** Discovery may find `opencode.json(c)`/`.opencode/`, but `Config.loadLegacyFile` copies only the allowlisted `tool_output` fields into `legacy: true` documents and writes nothing.
6. **Installer safety.** `installer.nsh` removes a legacy shared directory only after a `*.exe` scan comes back empty.
7. **CI wiring.** `.github/workflows/panacode-isolation.yml` still targets `panacode/redesign-v2` and `workflow_dispatch`, with `permissions: contents: read` and no release/publish step.

---

## Ownership guard

```bash
bun script/panacode-ui-ownership-check.ts
```

Fails if `@panacode/ui` is missing from the app, React demo deps leak into `packages/app`, brand/theme hooks are removed, or this guide / design package files disappear.
