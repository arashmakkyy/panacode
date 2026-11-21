import { resolveStateRoot } from "./state-root"

/**
 * Registration file the packaged CLI writes for `serve --service`.
 * Must stay in sync with `packages/cli/src/services/service-config.ts` `filename()`.
 *
 * Preview / agent builds bake `OPENCODE_CHANNEL` into the binary as a non-release
 * name (e.g. `cursor-panacode-install-isolate-58f9`), which uses
 * `service-<channel>.json` instead of `service.json`. Desktop ensure/discover
 * must open that same path or it times out waiting forever.
 */
export type ServiceRegistrationInput = {
  readonly join: (...parts: string[]) => string
  readonly home: string
  readonly cliVersion: string
  readonly stateHome?: string
  readonly isolatedRoot?: string
  readonly productSlug?: string
  /** The local development channel always registers in `service-local.json`. */
  readonly local?: boolean
}

/** Resolve the state root and the registration file that both the probe and ensure must agree on. */
export function serviceRegistration(input: ServiceRegistrationInput) {
  const stateRoot = resolveStateRoot({
    home: input.home,
    inherited: input.stateHome,
    isolatedRoot: input.isolatedRoot,
  })

  return {
    stateRoot,
    file: input.join(stateRoot, input.productSlug ?? "panacode", registrationName(input)),
  }
}

export function cliServiceRegistrationFile(input: ServiceRegistrationInput) {
  return serviceRegistration(input).file
}

function registrationName(input: Pick<ServiceRegistrationInput, "cliVersion" | "local">) {
  if (input.local) return "service-local.json"
  const channel = previewChannel(input.cliVersion)

  if (
    !channel ||
    channel === "latest" ||
    channel === "prod" ||
    channel === "dev" ||
    channel === "beta" ||
    channel === "next"
  ) {
    return "service.json"
  }

  return `service-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`
}

function previewChannel(version: string) {
  // Script.version for preview builds: 0.0.0-<channel>-<YYYYMMDDHHmm> locally, 0.0.0-<channel>-<run>[.<attempt>] on
  // GitHub Actions (for example 0.0.0-prod-3 from the panacode-windows workflow).
  const match = /^0\.0\.0-(.+)-(\d+(?:\.\d+)?)$/.exec(version)

  return match?.[1]
}