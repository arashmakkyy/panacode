import path from "path"
import fs from "fs"
import os from "os"
import { Context, Effect, Layer } from "effect"
// Prefer PANACODE_* before any OPENCODE_* reads in this module.
import { productEnv } from "./product-env.js"
import { ProductIdentity } from "./product-identity.js"
// XDG on runtimes with a home directory; one tmp-rooted directory on workerd.
// The variants resolve through the `workerd` bundle condition, like the
// native-module stubs, so no runtime sniffing happens here.
import { roots } from "#global-roots"
import { physicalPath, upstreamRoots, within } from "./product-path.js"
import { Flock } from "./flock.js"
import { makeGlobalNode } from "./effect/app-node.js"

const app = ProductIdentity.slug
const { data, cache, config, state, tmp } = roots(app)

const paths = {
  get home() {
    return productEnv("TEST_HOME") ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  // The acquired service canonicalizes default tmp; use it instead of Path.tmp for path comparisons.
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Path.config,
    state: Path.state,
    tmp: input.tmp ?? Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const acquire = (input: Partial<Interface>) =>
  Effect.gen(function* () {
    const service = Service.of(make(input))
    const directories = [service.data, service.config, service.state, service.log, service.bin, service.repos, service.tmp]
    yield* Effect.promise(async () => {
      // Validate the entire set before creating the first directory. A redirected product root
      // must never cause startup to create nested log, repo or bin directories in OpenCode.
      const protectedRoots = upstreamRoots()
      for (const directory of directories) {
        const resolved = physicalPath(directory)
        if (protectedRoots.some((root) => within(root, resolved)) || resolved.toLowerCase().split(path.sep).includes(".opencode"))
          throw new Error("Refusing to initialize Panacode inside OpenCode storage")
      }
      await Promise.all(directories.map((directory) => fs.promises.mkdir(directory, { recursive: true })))
    })
    const canonicalTmp = yield* Effect.promise(() => fs.promises.realpath(service.tmp))
    return Service.of({ ...service, tmp: input.tmp ?? canonicalTmp })
  })

const layer = Layer.effect(
  Service,
  Effect.suspend(() => acquire({ config: productEnv("CONFIG_DIR") ?? Path.config })),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) => Layer.effect(Service, acquire(input))

export * as Global from "./global.js"
