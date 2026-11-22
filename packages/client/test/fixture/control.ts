import { randomBytes, randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Info } from "../../src/service"
import { answerControl, type TerminalAction } from "../../src/service-control"
import {
  deriveServiceProofKey,
  serviceProofHeader,
  signServiceProof,
  type ServiceProofState,
} from "@opencode/schema/service-proof"

export function healthProof(request: Request, token: string, instance: string, state: ServiceProofState = "ready") {
  const url = new URL(request.url)
  const challenge = url.searchParams.get("challenge")
  if (!challenge || url.searchParams.get("instance") !== instance) return new Response(null, { status: 403 })
  return new Response(null, {
    status: 204,
    headers: {
      [serviceProofHeader]: signServiceProof(deriveServiceProofKey(token), challenge, instance, state),
    },
  })
}

export async function testControl(
  identity: () => Info,
  shutdown = () => {},
  terminals?: (action: TerminalAction) => Promise<unknown>,
) {
  const directory = await mkdtemp(join(tmpdir(), "pnc-ctl-"))
  const path =
    process.platform === "win32" ? `\\\\.\\pipe\\panacode-test-${randomUUID()}` : join(directory, "test.sock")
  const token = randomBytes(32).toString("base64url")
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    answerControl(socket, identity(), token, shutdown, terminals)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(path, resolve)
  })
  return {
    control: { path, token },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}
