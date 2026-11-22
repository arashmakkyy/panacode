# Panacode overlay

Panacode is a product fork of [OpenCode](https://github.com/anomalyco/opencode) (`dev`). The goal is a thin, reversible overlay: branding + a PanaAI-only connect catalog, without rewriting agent/tool mechanics.

**Installing Panacode never overwrites OpenCode.** Paths, env vars, and the CLI binary are isolated (see below).

## Product defaults

| Setting | Value | Where |
| --- | --- | --- |
| Product name | `Panacode` | `packages/core/src/panacode/product.ts` |
| CLI / binary | `panacode` | `@opencode/util/product-identity` + CLI build |
| Connect catalog | **PanaAI only** | `Product.connectAllowlist` |
| Provider id | `panaai` | same |
| Base URL | `https://panaai-psi.vercel.app/v1` (temporary) | same + `@opencode/ai/providers/panaai` |
| Auth URL | `https://panaai-psi.vercel.app` (site origin) | `Product.provider.authURL` |
| Credential | Sign in with PanaAI (browser), paste `pana-…` key, or `PANAAI_API_KEY` | `/connect` oauth + key + env |
| Models | dynamic from `GET /v1/models` | `packages/core/src/plugin/provider/panaai.ts` |
| Streaming | forced `stream: false` | `packages/ai/src/protocols/panaai-chat.ts` |

## Path and env isolation (from OpenCode)

Central identity: `packages/util/src/product-identity.ts` (also mirrored on `Product.identity`).

| Kind | OpenCode | Panacode |
| --- | --- | --- |
| Curl install dir | `~/.opencode/bin` | `~/.panacode/bin` |
| XDG data / config / cache / state / tmp | `…/opencode` | `…/panacode` |
| Project config dir | `.opencode/` | `.panacode/` |
| Config files | `opencode.json(c)` | `panacode.json(c)` |
| System config | `/etc/opencode`, etc. | `/etc/panacode`, etc. |
| CLI command | `opencode` | `panacode` |
| Env prefix | `OPENCODE_*` | `PANACODE_*` only (no fallback) |

`@opencode/util/product-env` reads only `PANACODE_*`. CLI and Desktop startup call `sanitizeProductEnv()`, which deletes inherited `OPENCODE_*` runtime overrides before any other module reads the environment. There is no `PANACODE_*` → `OPENCODE_*` copying, so setting both always leaves Panacode on the `PANACODE_*` value.

Examples: `PANACODE_CONFIG_DIR`, `PANACODE_CONFIG`, `PANACODE_FLAGS`, `PANACODE_DB`, `PANACODE_PASSWORD`, `PANACODE_PRINT_LOGS`, `PANACODE_LOG_LEVEL`, `PANACODE_TEST_HOME`.

The one retained `OPENCODE_*` name is `OPENCODE_API_KEY`, the credential variable of the OpenCode-hosted model provider, which Panacode treats like any other third-party provider key. Because the startup sanitizer removes it, sign-in goes through `/connect` (or the provider auth store) rather than an ambient variable. Compile-time constants such as `OPENCODE_VERSION`, `OPENCODE_CHANNEL`, and `OPENCODE_TARGET` are build inputs, not runtime product settings.

## Side-by-side isolation rules

- **Sidecars.** Packaged Desktop uses `panacode-cli` / `panacode-cli.exe` and `panacode-cli.version`; development uses `panacode-cli-dev` and `panacode-cli-wsl`. The upstream `opencode-cli` name is never probed.
- **Service ports.** Windows prefers `28844`. macOS and Linux prefer `49324`. The local development channel adds one. On a loopback address, an occupied default lets the operating system select an available port. An explicit or saved port stays fixed. `panacode service status` reports the active endpoint.
- **Session history during an upgrade.** If a live registration could belong to an older Panacode instance, the new service opens a separate history. Desktop displays a notice. Both the registration and database for this profile are under `<Panacode state>/coexist/<service name>/`. The regular history becomes active again after the older installation exits and the separate service stops. Close the new Desktop, run `panacode service stop`, and reopen it. To revisit separately saved sessions, launch from a shell with `XDG_STATE_HOME=<profile>/state`, `XDG_DATA_HOME=<profile>/data`, `PANACODE_DB=panacode.db`, and `PANACODE_SERVICE_COEXIST=1`. A port conflict on its own uses the regular history.
- **Project identity.** Git projects normally use their origin or root commit. For a project that used a custom historical ID, placing that same ID in the Git common directory’s `panacode` file (or `.hg/panacode` for Mercurial) retains the historical association.
- **Project resources.** Put repository skills in `.panacode/skills/<name>/SKILL.md` and project settings in `.panacode/panacode.jsonc`. The project’s `AGENTS.md` can refer to those files directly.
- **Optional legacy project settings.** Set `PANACODE_IMPORT_OPENCODE_TOOL_OUTPUT=1` to import `tool_output.max_lines` and `tool_output.max_bytes` from local OpenCode project configuration. Panacode settings take priority. Skill and plugin discovery use Panacode configuration independently.
- **Support archive.** `panacode-debug-*.zip` collects Panacode log roots only and omits OpenCode markers plus obvious secrets (`.env`, `auth.json`, config files, credentials, service registration files).
- **Deep links.** Only `panacode://` is dispatched. `opencode://` is ignored before routing; `oc://renderer` remains internal.
- **Updates.** Panacode has no upstream update feed and no desktop auto-updater. The CLI `check` command points at https://github.com/arashmakkyy/panacode/releases, and `apply`/`latest`/`upgrade`/`managed` fail with "Panacode updates are manual". Install a newer build, then restart.
- **CI.** `.github/workflows/panacode-isolation.yml` runs the isolation guard, environment contract, legacy-config, service, sidecar, and installer-metadata tests for pull requests to `panacode/redesign-v2` and on manual dispatch. It publishes nothing.

## Install (Linux / macOS)

**Recommended (local build, no npm publish):**

```bash
bun install
bun run script/install-local.ts
# installs to ~/.panacode/bin and hints PATH
panacode --version
```

**From an already-built binary:**

```bash
./install --binary ./packages/cli/dist/cli-linux-x64/bin/panacode
# or: ./install --binary /path/to/panacode
```

**npm pack (local tarball, not published unless you have credentials):**

```bash
cd packages/cli
bun run build -- --single --skip-web-ui
bun run pack
# artifacts under dist/npm/ (package name `panacode`) and dist/archives/
```

Remote curl-from-npm install works only after `@panacode/cli-*` packages are published; until then use `install-local` or `--binary`.

## Sign in with PanaAI (browser + loopback)

Primary connect path (key paste remains as fallback):

1. Desktop opens the system browser to  
   `{authURL}/connect/panacode?state=…&redirect_uri=http://127.0.0.1:<port>/callback`
2. After the user finishes on the site, the browser hits the ephemeral loopback listener.
3. Desktop exchanges the one-time code (no cookie):  
   `POST {authURL}/api/v1/connect/panacode/exchange` with `{ code, state }`  
   → `{ secret, baseURL?, keyId?, prefix?, name?, … }`
4. `secret` is stored as an OAuth credential `access` token and used as the Bearer API key (`pana-…`).

Paste-redirect fallback (`OauthRedirect.submit`) works when the browser cannot reach loopback (SSH, remote desktop, containers).

### Credits / top-up resume

If the connect page sends the user to buy credits or top up, finishing that flow should return them to the same authorize URL (same `state` + `redirect_uri`) so the loopback callback and exchange still complete. Do not start a second desktop authorize attempt mid top-up; reuse the pending attempt until success, cancel, or expiry.

## Files that belong to the overlay

- `packages/util/src/product-identity.ts` — slug, CLI name, install dir, config file names
- `packages/util/src/product-env.ts` — `PANACODE_*`-only contract and inherited-upstream sanitizer
- `packages/core/src/panacode/product.ts` — centralized name, baseURL, authURL, allowlist, identity
- `packages/core/src/plugin/provider/panaai.ts` — integration, browser OAuth, discovery, provider registration
- `packages/core/src/plugin/panacode-overlay.ts` — late filter so allowlist wins over models.dev/config
- `packages/ai/src/providers/panaai.ts` + `packages/ai/src/protocols/panaai-chat.ts` — OpenAI-compatible client with non-stream chat
- `install`, `script/install-local.ts` — Panacode-only install paths
- `PANACODE.md`, light README / ACP name branding

Upstream provider packages and the models.dev snapshot stay intact.

## Rename later

Change `Product.name` / `ProductIdentity.slug` (and related display strings). Avoid mass-rewriting the codebase for branding.

## Re-enable other providers

1. Set `Product.connectAllowlist` to `undefined` in `product.ts` (or expand the list).
2. Optionally remove or no-op `PanacodeOverlayPlugin` in `packages/core/src/plugin/internal.ts`.
3. Keep the PanaAI plugin registered if you still want PanaAI as a first-class provider.

## Sync from upstream

```bash
git remote add upstream https://github.com/anomalyco/opencode.git   # once
git fetch upstream
git merge upstream/dev   # or rebase
```

Resolve conflicts preferentially in the overlay files above. Prefer re-applying the small overlay rather than carrying large forks of core session/provider code.

## Follow-ups (tracked as issues when Issues are enabled)

### 1. Enable streaming for PanaAI provider once PanaAI supports streaming settlement

**Title:** Enable streaming for PanaAI provider once PanaAI supports streaming settlement

**Body:** Today Panacode forces `stream: false` for PanaAI chat completions (`packages/ai/src/protocols/panaai-chat.ts`) because PanaAI settlement does not support streaming yet. The non-stream JSON completion is rewritten into synthetic SSE chunk frames so the existing OpenAI Chat protocol can still drive the session UI.

When PanaAI supports streaming settlement:
- Drop the forced `stream: false` body override and document framing converter.
- Reuse standard OpenAI-compatible SSE framing (`OpenAIChat.framing`).
- Update `Product.provider.stream` in `packages/core/src/panacode/product.ts` and tests in `packages/ai/test/provider/panaai-chat.test.ts`.

### 2. Switch PanaAI baseURL / authURL from Vercel preview host to production custom domain

**Title:** Switch PanaAI baseURL from Vercel preview host to production custom domain

**Body:** The first Panacode overlay presets PanaAI at `https://panaai-psi.vercel.app/v1` (temporary Vercel host) and auth at `https://panaai-psi.vercel.app` in:
- `packages/core/src/panacode/product.ts` (`Product.provider.baseURL`, `Product.provider.authURL`)
- `packages/ai/src/providers/panaai.ts` (`baseURL`)

When the production custom domain is ready, update both defaults (and any docs in `PANACODE.md` / README) in one change. Keep the override path via provider `settings.baseURL` for local testing.
