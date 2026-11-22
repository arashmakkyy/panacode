import fs from "node:fs/promises"
import path from "node:path"
import { serviceProofPath } from "@opencode/schema/service-proof"
import { healthProof, testControl } from "../../../client/test/fixture/control"
import { OPENCODE_VERSION } from "../../src/version"

export async function debugService(file: string, handle: (request: Request) => Response) {
  const id = crypto.randomUUID()
  let token = ""
  let probes = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== serviceProofPath) return handle(request)
      if (request.headers.has("authorization")) return new Response(null, { status: 400 })
      probes++
      return healthProof(request, token, id)
    },
  })
  const identity = {
    id,
    product: "panacode" as const,
    version: OPENCODE_VERSION,
    url: server.url.href,
    pid: process.pid,
    password: "secret",
  }
  try {
    const channel = await testControl(() => identity)
    try {
      token = channel.control.token
      const info = { ...identity, control: channel.control }
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify(info), { mode: 0o600 })
      return {
        file,
        info,
        probes: () => probes,
        async [Symbol.asyncDispose]() {
          await server.stop(true)
          await channel[Symbol.asyncDispose]()
        },
      }
    } catch (error) {
      await channel[Symbol.asyncDispose]()
      throw error
    }
  } catch (error) {
    await server.stop(true)
    throw error
  }
}
