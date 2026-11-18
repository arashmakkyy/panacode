/**
 * Registration file the packaged CLI writes for `serve --service`.
 * Must stay in sync with `packages/cli/src/services/service-config.ts` `filename()`.
 *
 * Preview / agent builds bake `OPENCODE_CHANNEL` into the binary as a non-release
 * name (e.g. `cursor-panacode-install-isolate-58f9`), which uses
 * `service-<channel>.json` instead of `service.json`. Desktop ensure/discover
 * must open that same path or it times out waiting forever.
 */
export function cliServiceRegistrationFile(input: {
  readonly join: (...parts: string[]) => string
  readonly home: string
  readonly cliVersion: string
  readonly stateHome?: string
  readonly productSlug?: string
}) {
  const state = input.stateHome ?? input.join(input.home, ".local", "state")
  const dir = input.join(state, input.productSlug ?? "panacode")
  const channel = previewChannel(input.cliVersion)
  if (!channel || channel === "latest" || channel === "dev" || channel === "beta" || channel === "next") {
    return input.join(dir, "service.json")
  }
  return input.join(dir, `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`)
}

function previewChannel(version: string) {
  // Script.version for preview builds: 0.0.0-<channel>-<YYYYMMDDHHmm[ss]>
  const match = /^0\.0\.0-(.+)-(\d{12,14})$/.exec(version)
  return match?.[1]
}
