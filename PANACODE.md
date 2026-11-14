# Panacode overlay

Panacode is a product fork of [OpenCode](https://github.com/anomalyco/opencode) (`dev`). The goal is a thin, reversible overlay: branding + a PanaAI-only connect catalog, without rewriting agent/tool mechanics.

## Product defaults

| Setting | Value | Where |
| --- | --- | --- |
| Product name | `Panacode` | `packages/core/src/panacode/product.ts` |
| Connect catalog | **PanaAI only** | `Product.connectAllowlist` |
| Provider id | `panaai` | same |
| Base URL | `https://panaai-psi.vercel.app/v1` (temporary) | same + `@opencode/ai/providers/panaai` |
| Credential | paste `pana-…` key or `PANAAI_API_KEY` | `/connect` key method + env |
| Models | dynamic from `GET /v1/models` | `packages/core/src/plugin/provider/panaai.ts` |
| Streaming | forced `stream: false` | `packages/ai/src/protocols/panaai-chat.ts` |

## Files that belong to the overlay

- `packages/core/src/panacode/product.ts` — centralized name, baseURL, allowlist
- `packages/core/src/plugin/provider/panaai.ts` — integration, discovery, provider registration
- `packages/core/src/plugin/panacode-overlay.ts` — late filter so allowlist wins over models.dev/config
- `packages/ai/src/providers/panaai.ts` + `packages/ai/src/protocols/panaai-chat.ts` — OpenAI-compatible client with non-stream chat
- `PANACODE.md`, light README / ACP name branding

Upstream provider packages and the models.dev snapshot stay intact.

## Rename later

Change `Product.name` (and related display strings that import it). Avoid mass-rewriting the codebase for branding.

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

### 2. Switch PanaAI baseURL from Vercel preview host to production custom domain

**Title:** Switch PanaAI baseURL from Vercel preview host to production custom domain

**Body:** The first Panacode overlay presets PanaAI at `https://panaai-psi.vercel.app/v1` (temporary Vercel host) in:
- `packages/core/src/panacode/product.ts` (`Product.provider.baseURL`)
- `packages/ai/src/providers/panaai.ts` (`baseURL`)

When the production custom domain is ready, update both defaults (and any docs in `PANACODE.md` / README) in one change. Keep the override path via provider `settings.baseURL` for local testing.
