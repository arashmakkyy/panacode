// Panacode: the desktop updater and What's New come from upstream OpenCode. Their feed
// (opencode.ai/update/api/.../desktop/opencode) and changelog (opencode.ai/changelog.json) describe OpenCode
// releases, so a Panacode build offered "Update to <OpenCode version>" on the error page, in Settings, in the titlebar
// and from the app menu. Panacode ships through GitHub Releases (the panacode-windows workflow) and has no update feed
// yet, so both stay off. Turn this on only once Panacode publishes its own feed and changelog.
// Recorded in panacode-docs/UPSTREAM-MERGE.md and decisions.md D-017.
export const PANACODE_UPSTREAM_UPDATES = false as boolean
