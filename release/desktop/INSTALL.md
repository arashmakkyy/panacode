# Install Panacode (Windows desktop)

1. Download: https://github.com/arashmakkyy/panacode/releases/download/panacode-desktop-win-x64-r7/panacode-desktop-win-x64.exe
2. Run the NSIS installer (product **Panacode**, app id `ai.panacode.desktop`).
3. Open Panacode → Sign in with PanaAI.

**r7** fixes splash/error contrast, makes Panacode text selectable, and extends the Windows background-service startup timeout — on top of r6 branding and the UI redesign.

If upgrading: quit Panacode, delete `%USERPROFILE%\.local\state\panacode\service*.json` if a prior build hung, then install r7.

SHA256: see the `.sha256` asset next to the installer on the release page.
