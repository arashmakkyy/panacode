# Install Panacode (Windows desktop)

Panacode is the PanaAI-branded OpenCode fork. Builds store config/history under `~/.panacode` (Windows: `%APPDATA%\ai.panacode.desktop*`) and never write OpenCode’s `~/.opencode` / `ai.opencode.desktop*`.

## Windows desktop (recommended)

1. Download the NSIS installer:
   https://github.com/arashmakkyy/panacode/releases/download/panacode-desktop-win-x64-r5/panacode-desktop-win-x64.exe
   (release page: https://github.com/arashmakkyy/panacode/releases/tag/panacode-desktop-win-x64-r5)
2. Run it — product name **Panacode**, app id `ai.panacode.desktop` (separate from OpenCode).
3. Open Panacode → **Sign in with PanaAI**.

Unsigned builds may trigger SmartScreen — More info → Run anyway.

### Release notes

- **r5** — Panacode UI redesign (`@panacode/ui`) + prior r4 panaai CLI embed (`@opencode/ai/providers/panaai` in Bun builtins).
- **r4** (published on panaai dashboard repo historically) — embeds panaai provider so PanaAI models initialize for chat.

Build from this repo (Linux host needs `wine` + `wine32` for NSIS):

```bash
OPENCODE_TARGET=windows-x64 bun run --cwd packages/cli build --baseline --single
OPENCODE_TARGET=windows-x64 OPENCODE_CHANNEL=prod bun run --cwd packages/desktop build
OPENCODE_TARGET=windows-x64 OPENCODE_CHANNEL=prod bun run --cwd packages/desktop pack
# → dist/desktop/panacode-desktop-win-x64.exe
```
