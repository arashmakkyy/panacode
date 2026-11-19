import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import net from "node:net"

export * as PortOwner from "./port-owner"

// Best effort: names the process listening on a TCP port so a failed bind can say who holds it.
export const describe = Effect.fnUntraced(function* (port: number, hostname?: string) {
  const appProcess = yield* AppProcess.Service
  const run = (command: string, args: ReadonlyArray<string>, maxOutputBytes = 4096) =>
    appProcess
      .run(ChildProcess.make(command, args, { stdin: "ignore", killSignal: "SIGKILL" }), {
        timeout: "1 second",
        maxOutputBytes,
      })
      .pipe(
        Effect.map((result) => (result.exitCode === 0 ? result.stdout.toString("utf8").trim() : "")),
        Effect.orElseSucceed(() => ""),
      )
  // Panacode: Windows has no lsof, so read netstat and tasklist instead. Naming the holder (for example a running
  // OpenCode) makes a port clash self-explanatory instead of "another process".
  if (process.platform === "win32") {
    const pid = windowsListeners(yield* run("netstat", ["-ano", "-p", "TCP"], 1 << 20), port).find((listener) =>
      matches(listener.address, hostname),
    )?.pid
    if (pid === undefined) return undefined
    const name = windowsImageName(yield* run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]))
    return name ? `PID ${pid} (${name})` : `PID ${pid}`
  }
  const pid = listeners(yield* run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"])).find((listener) =>
    matches(listener.address, hostname),
  )?.pid
  if (pid === undefined) return undefined
  const command = (yield* run("ps", ["-o", "command=", "-p", pid])).replace(/\s+/g, " ")
  if (!command) return `PID ${pid}`
  return `PID ${pid} (${command.length > 200 ? command.slice(0, 199) + "…" : command})`
})

function listeners(output: string) {
  const found: { pid: string; address: string }[] = []
  let pid: string | undefined
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = /^\d+$/.test(line.slice(1)) ? line.slice(1) : undefined
    if (line.startsWith("n") && pid !== undefined)
      found.push({ pid, address: line.slice(1, line.lastIndexOf(":")).replace(/^\[(.*)\]$/, "$1") })
  }
  return found
}

// Panacode: `netstat -ano -p TCP` rows read `TCP  127.0.0.1:28844  0.0.0.0:0  LISTENING  1234`. The state column is
// localized, so a listener is recognised by its unbound remote address instead.
export function windowsListeners(output: string, port: number) {
  const found: { pid: string; address: string }[] = []
  for (const line of output.split(/\r?\n/)) {
    const [proto, local, remote, ...rest] = line.trim().split(/\s+/)
    const pid = rest.at(-1)
    if (proto?.toUpperCase() !== "TCP" || !local || !remote || !pid || !/^\d+$/.test(pid) || pid === "0") continue
    if (remote !== "0.0.0.0:0" && remote !== "[::]:0") continue
    const separator = local.lastIndexOf(":")
    if (Number(local.slice(separator + 1)) !== port) continue
    found.push({ pid, address: local.slice(0, separator).replace(/^\[(.*)\]$/, "$1") })
  }
  return found
}

// `tasklist /FO CSV /NH` prints `"panacode-cli.exe","1234","Console","1","12,345 K"`.
export function windowsImageName(output: string) {
  return /^"([^"]+)"/.exec(output.trim())?.[1]
}

// lsof shows wildcard listeners as `*` and netstat as `0.0.0.0` or `::`; those also hold the port for any specific
// address.
function matches(address: string, hostname: string | undefined) {
  const host = hostname?.replace(/^\[(.*)\]$/, "$1")
  if (host === undefined || net.isIP(host) === 0 || host === "0.0.0.0" || host === "::") return true
  return address === "*" || address === "0.0.0.0" || address === "::" || address === host
}
