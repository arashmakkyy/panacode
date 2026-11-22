import path from "node:path"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { defineConfig, type Plugin, type UserConfig } from "vite"
import solid from "vite-plugin-solid"
import { nodeExecArgv, nodeTarget, type NodeTarget, photonWasmAsset } from "./src/node/target"
import { verifySimulationGraph } from "./script/verify-artifact"

const dir = import.meta.dirname

function rawTextPlugin(modelsSnapshot?: string): Plugin {
  return {
    name: "opencode:raw-text",
    // "pre" is load-bearing for .txt: Vite's built-in asset plugin claims
    // known asset types (.txt among them) ahead of normal-priority plugins,
    // replacing the import with an asset URL string instead of the content.
    // .md only ever worked without it because .md is not a known asset type.
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".md") && !id.endsWith(".txt")) return
      const text =
        modelsSnapshot && /models-dev[/\\]snapshot\.txt$/.test(id) ? modelsSnapshot : await readFile(id, "utf8")
      return `export default ${JSON.stringify(text)}`
    },
  }
}

/** The web UI archive's SEA asset key. The prelude leaves it in place, and the server reads it from SEA memory. */
export const appArchiveAsset = "app-archive.bin"

function appAssetsPlugin(): Plugin {
  return {
    name: "opencode:app-assets",
    resolveId(id) {
      if (id === "virtual:opencode-app-assets") return "\0virtual:opencode-app-assets"
    },
    load(id) {
      if (id !== "\0virtual:opencode-app-assets") return
      return `import { readFileSync } from "node:fs"
import path from "node:path"
import { getRawAsset, isSea } from "node:sea"
export default () =>
  isSea()
    ? new Uint8Array(getRawAsset(${JSON.stringify(appArchiveAsset)}))
    : readFileSync(path.join(process.env.PANACODE_NODE_ASSETS_DIR, ${JSON.stringify(appArchiveAsset)}))`
    },
  }
}

function runtimeRequirePlugin(): Plugin {
  return {
    name: "opencode:runtime-require",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("turndown/lib/turndown.es.js")) return
      const transformed = code.replace("    var domino = require('@mixmark-io/domino');", "")
      if (transformed === code) this.error("Failed to rewrite Turndown's Domino require")
      return `import domino from "@mixmark-io/domino"\n${transformed}`
    },
  }
}

function simulationGraphPlugin(): Plugin {
  return {
    name: "opencode:simulation-graph",
    generateBundle() {
      verifySimulationGraph(this.getModuleIds())
    },
  }
}

function fffNodePlugin(): Plugin {
  return {
    name: "opencode:fff-node",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/")
      if (normalized.endsWith("/ffi-rs/index.js")) {
        const start = code.indexOf("if (!nativeBinding) {")
        if (start === -1) this.error("Failed to rewrite ffi-rs native binding loader")
        return `const unavailable = () => { throw new Error("ffi-rs native binding unavailable") }
const nativeBinding = globalThis.__PANACODE_FFF_FFI ?? {
  DataType: new Proxy({}, { get: (target, key) => target[key] ?? key }),
  PointerType: {},
  FFITypeTag: {},
  open: unavailable,
  close: unavailable,
  load: unavailable,
  isNullPointer: unavailable,
  createPointer: unavailable,
  restorePointer: unavailable,
  unwrapPointer: unavailable,
  wrapPointer: unavailable,
  freePointer: unavailable,
}
const loadError = undefined
${code.slice(start)}`
      }
      if (!normalized.endsWith("/fff-node/dist/src/binary.js")) return
      const transformed = code.replace(
        "export function findBinary() {",
        "export function findBinary() { if (process.env.FFF_BINARY_PATH) return process.env.FFF_BINARY_PATH;",
      )
      if (transformed === code) this.error("Failed to rewrite FFF binary loader")
      return transformed
    },
  }
}

const resolve = {
  alias: [
    { find: /^solid-js\/store$/, replacement: "solid-js/store/dist/store.js" },
    { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
    {
      find: /^ws$/,
      replacement: path.join(path.dirname(createRequire(import.meta.url).resolve("ws/package.json")), "wrapper.mjs"),
    },
  ],
  conditions: ["node"],
}

const output = (entryFileNames: string, banner?: string) => ({
  format: "esm" as const,
  entryFileNames,
  inlineDynamicImports: true,
  banner,
})

export function nodePrelude(input: NodeBuildInput) {
  const nodePtySpawnHelper =
    input.target.platform === "darwin"
      ? `${input.target.nodePtyPackage}/prebuilds/darwin-${input.target.arch}/spawn-helper`
      : undefined
  const opencodePtyAsset = input.target.opencodePtyAsset
  if (!input.ptySha256 || !/^[a-f0-9]{64}$/.test(input.ptySha256)) throw new Error("A pinned SEA PTY digest is required")
  const promiseModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const Agent = sdk.Agent
export const Command = sdk.Command
export const Connection = sdk.Connection
export const Credential = sdk.Credential
export const Integration = sdk.Integration
export const Model = sdk.Model
export const Plugin = sdk.Plugin
export const Provider = sdk.Provider
export const Reference = sdk.Reference
export const Skill = sdk.Skill`
  const effectModule = promiseModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const promisePluginModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.promise")]
if (!sdk) throw new Error("OpenCode Promise plugin SDK is unavailable")
export const define = sdk.Plugin.define`
  const effectPluginModule = promisePluginModule
    .replace("opencode.plugin.v2.promise", "opencode.plugin.v2.effect")
    .replace("Promise plugin", "Effect plugin")
  const promiseToolModule = `export {}`
  const effectToolModule = `const sdk = globalThis[Symbol.for("opencode.plugin.v2.effect")]
if (!sdk) throw new Error("OpenCode Effect plugin SDK is unavailable")
export const Error = sdk.Tool.Error
`
  return `#!/usr/bin/env -S node ${nodeExecArgv.join(" ")}
import __cjs_mod__ from "node:module"
${readFileSync(new URL("./script/node-sea-cache.mjs", import.meta.url), "utf8")}
import { tmpdir as __ocTmpdir } from "node:os"
import __ocPath from "node:path"
import { getAssetKeys as __ocAssetKeys, getRawAsset as __ocRawAsset, isSea as __ocIsSea } from "node:sea"
import { fileURLToPath as __ocFileURLToPath } from "node:url"
const __filename = import.meta.filename
const __dirname = import.meta.dirname
const require = __cjs_mod__.createRequire(import.meta.url)
const __ocPluginModules = ${JSON.stringify({
    "@opencode/plugin": "opencode:plugin-v2",
    "@opencode/plugin/promise/plugin": "opencode:plugin-promise-plugin",
    "@opencode/plugin/promise/tool": "opencode:plugin-promise-tool",
    "@opencode/plugin/effect": "opencode:plugin-v2-effect",
    "@opencode/plugin/effect/plugin": "opencode:plugin-v2-effect-plugin",
    "@opencode/plugin/effect/tool": "opencode:plugin-v2-effect-tool",
  })}
const __ocPluginSources = ${JSON.stringify({
    "opencode:plugin-v2": promiseModule,
    "opencode:plugin-promise-plugin": promisePluginModule,
    "opencode:plugin-promise-tool": promiseToolModule,
    "opencode:plugin-v2-effect": effectModule,
    "opencode:plugin-v2-effect-plugin": effectPluginModule,
    "opencode:plugin-v2-effect-tool": effectToolModule,
  })}
__cjs_mod__.registerHooks({
  resolve(__ocSpecifier, __ocContext, __ocNextResolve) {
    const __ocUrl = __ocPluginModules[__ocSpecifier]
    return __ocUrl ? { url: __ocUrl, shortCircuit: true } : __ocNextResolve(__ocSpecifier, __ocContext)
  },
  load(__ocUrl, __ocContext, __ocNextLoad) {
    const __ocSource = __ocPluginSources[__ocUrl]
    return __ocSource
      ? { format: "module", source: __ocSource, shortCircuit: true }
      : __ocNextLoad(__ocUrl, __ocContext)
  },
})
const __ocPersistentPty = ${JSON.stringify(opencodePtyAsset)}
const __ocAssetRoot = __ocIsSea()
  ? installPanacodeSeaAssets(__ocTmpdir(), ${JSON.stringify(`${input.assetHash}-${input.target.platform}-${input.target.arch}`)},
      { keys: __ocAssetKeys, get: __ocRawAsset }, ${JSON.stringify(appArchiveAsset)}, [__ocPersistentPty, ${JSON.stringify(nodePtySpawnHelper)}])
  : __ocFileURLToPath(new URL("./assets/", import.meta.url))
process.env.PANACODE_NODE_ASSETS_DIR = __ocAssetRoot
process.env.OTUI_ASSET_ROOT = __ocAssetRoot
process.env.PANACODE_NODE_PTY_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.nodePtyEntryAsset)})
process.env.PANACODE_PARCEL_WATCHER_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.parcelWatcherAsset)})
process.env.PANACODE_PHOTON_WASM_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(photonWasmAsset)})
process.env.FFF_BINARY_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.fffAsset)})
process.env.PANACODE_FFF_FFI_PATH = __ocPath.join(__ocAssetRoot, ${JSON.stringify(input.target.fffFfiAsset)})
Object.defineProperty(globalThis, "__PANACODE_PACKAGED_PTY", {
  value: Object.freeze({ file: __ocPath.join(__ocAssetRoot, __ocPersistentPty), sha256: ${JSON.stringify(input.ptySha256)} })
})
process.env.PANACODE_PTY_BIN = globalThis.__PANACODE_PACKAGED_PTY.file
process.env.PANACODE_PTY_BIN_SHA256 = globalThis.__PANACODE_PACKAGED_PTY.sha256
try {
  globalThis.__PANACODE_FFF_FFI = require(process.env.PANACODE_FFF_FFI_PATH)
} catch {}
globalThis.__PANACODE_PHOTON_WASM_PATH = process.env.PANACODE_PHOTON_WASM_PATH
if (process.platform === "linux") process.env.OPENTUI_LIBC = "glibc"`
}

export type NodeBuildInput = {
  readonly version: string
  readonly channel: string
  readonly highlights?: string
  readonly modelsSnapshot?: string
  readonly assetHash: string
  readonly ptySha256?: string
  readonly target: NodeTarget
}

export function mainConfig(input: NodeBuildInput): UserConfig {
  return defineConfig({
    root: dir,
    plugins: [
      appAssetsPlugin(),
      rawTextPlugin(input.modelsSnapshot),
      runtimeRequirePlugin(),
      fffNodePlugin(),
      simulationGraphPlugin(),
      solid({
        solid: {
          generate: "universal",
          moduleName: "@opentui/solid",
        },
      }),
    ],
    resolve,
    esbuild: { jsx: "automatic" },
    define: {
      OPENCODE_VERSION: JSON.stringify(input.version),
      OPENCODE_CLI_NAME: JSON.stringify("opencode2-node"),
      OPENCODE_CHANNEL: JSON.stringify(input.channel),
      OPENCODE_ARTIFACT: JSON.stringify("cli-node"),
      ...(input.highlights ? { OPENCODE_RELEASE_HIGHLIGHTS: JSON.stringify(input.highlights) } : {}),
      OPENCODE_LIBC: input.target.platform === "linux" ? JSON.stringify("glibc") : "undefined",
      FFF_LIBC: input.target.platform === "linux" ? JSON.stringify("gnu") : "undefined",
      "process.env.WS_NO_BUFFER_UTIL": JSON.stringify("1"),
    },
    ssr: { noExternal: true },
    build: {
      ssr: "src/node/index.ts",
      target: "node26",
      outDir: "dist-node",
      emptyOutDir: false,
      minify: true,
      rollupOptions: {
        output: output("opencode.mjs", nodePrelude(input)),
      },
    },
  })
}

export default defineConfig(async () => {
  const target = nodeTarget(process.platform, process.arch)
  const { resolveOpencodePty } = await import("./script/opencode-pty")
  const asset = await resolveOpencodePty(target)
  return mainConfig({
    version: process.env.OPENCODE_VERSION ?? "local",
    channel: process.env.OPENCODE_CHANNEL ?? "local",
    assetHash: "local",
    ptySha256: asset?.sha256,
    target,
  })
})
