# Install Panacode (Windows desktop)

1. Download the latest `panacode-desktop-win-x64-rN` installer from https://github.com/arashmakkyy/panacode/releases.
2. Run the NSIS installer (product **Panacode**, app id `ai.panacode.desktop`). It installs beside OpenCode and never modifies OpenCode's install or data directories.
3. Open Panacode → Sign in with PanaAI.

## Updates

Panacode has no automatic updater and no upstream OpenCode feed. Install a newer build over the old one, then restart.
`panacode check` prints the Panacode releases page; `panacode upgrade`, `apply`, `latest` and `managed` stop with
"Panacode updates are manual".

## Runtime isolation

- The packaged sidecar is `panacode-cli.exe` with a `panacode-cli.version` marker. The desktop never probes `opencode-cli`.
- The service registers as `product: "panacode"` and defaults to port **28844** (`0x70ac`). A saved
  `panacode service set port` value wins over the default; packaged Windows no longer forces `--port`.
- Runtime settings are **`PANACODE_*` only**. Inherited `OPENCODE_*` variables are removed at startup.
- Existing `opencode.json`, `opencode.jsonc` and `.opencode/` are read-only: only `tool_output.max_lines` and
  `tool_output.max_bytes` are imported below Panacode's own values. No legacy plugin is loaded.
- Support archives are named `panacode-debug-*.zip` and contain Panacode logs only.
- The app handles `panacode://` and ignores `opencode://`.

If a prior build hung, quit Panacode, delete `%USERPROFILE%\.local\state\panacode\service*.json`, then install again.

SHA256: see the `.sha256` asset next to the installer on the release page.