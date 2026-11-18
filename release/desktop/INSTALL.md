# Install Panacode (Windows desktop)

1. Download: https://github.com/arashmakkyy/panacode/releases/download/panacode-desktop-win-x64-r8/panacode-desktop-win-x64.exe
2. Run the NSIS installer (product **Panacode**, app id `ai.panacode.desktop`).
3. Open Panacode → Sign in with PanaAI.

**r8** completes the startup fixes: TextField white-on-white override, theme CSS var seeds, selectable Panacode brand, CLI `service-<channel>.json` registration match, and Windows packaged ensure (port 28894 / `0x70de`, 15s probes, 240s promise timeout).

If upgrading: quit Panacode, delete `%USERPROFILE%\.local\state\panacode\service*.json` if a prior build hung, then install r8.

SHA256: see the `.sha256` asset next to the installer on the release page.
