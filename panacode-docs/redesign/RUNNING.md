# Running the Panacode UI for visual QA

These commands start the real app and the real local server. They do not load demo sessions or mock providers. A fresh checkout has no project and no sessions, so Home shows the empty state.

From the repository root, with Bun 1.4.4 (`packageManager` in the root `package.json`):

```bash
bun install --frozen-lockfile
```

## Browser (Linux)

Terminal 1, repository root:

```bash
bun dev serve --port 4096
```

Terminal 2:

```bash
cd packages/app
bun dev -- --port 4444 --host 127.0.0.1
```

Open `http://127.0.0.1:4444`.

The app dev server proxies the API to `http://127.0.0.1:4096`. `opencode dev web` proxies the hosted app instead, so it will not show this checkout.

The first visit with empty theme storage uses the Panacode theme in dark mode. Light mode is Settings → color scheme → Light. To force a scheme before the app reads storage, set `localStorage["opencode-color-scheme"]` to `dark` or `light` and reload. That key is the app's real scheme store (`packages/ui/src/theme/context.tsx`). `data-theme` stays `panacode` in both schemes. `data-color-scheme` is `dark` or `light`.

What you can screenshot on a fresh server:

- Home, with the titlebar and sidebar (no project yet still renders the shell).
- The session list empty state, and the skeleton rows while the list is loading.
- New session, from the empty-state action when a directory can be opened.
- The error page only if a render error is thrown. It is not a separate route.

## Linux Electron

From the repository root, after the browser server is up:

```bash
bun --cwd packages/desktop dev
```

That builds and launches the Electron shell against this checkout. It needs a display. Packaging (`bun --cwd packages/desktop pack`) is not part of stage 1 and is not required to look at the UI.

## Checks that belong with a visual pass

```bash
bun script/panacode-ui-ownership-check.ts
bun script/panacode-brand-scan.ts
bun --cwd packages/panacode-ui test
bun --cwd packages/panacode-ui typecheck
bun --cwd packages/app typecheck
```
bun --cwd packages/app test:unit
bun --cwd packages/desktop typecheck
```

The brand scan reads build output too. Run it on a clean tree (no `packages/app/dist`, no `packages/desktop/out`),
otherwise bundled upstream strings in those gitignored folders fail it.

## Notes for the dev loop

- CSS in files pulled in through `@import` (arc-shell.css, pack tokens) is not always hot-reloaded by the bundled
  dev server; restart `dev` after editing them.
- Swapping the brand: `bun script/panacode-brand-apply.ts <pack>` (see packages/panacode-ui/src/brand/README.md).
- Regenerating icons: `bun script/panacode-icons-generate.ts`.
