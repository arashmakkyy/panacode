import { deriveServiceProofKey } from "@opencode/schema/service-proof"
import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.status,
  Effect.fn("cli.service.status")(function* (input) {
    const options = yield* ServiceConfig.options()
    if (input.connectionJson) {
      const info = yield* Service.verifiedRegistration({ ...options, version: undefined })
      if (info?.control) process.stdout.write(JSON.stringify({
        id: info.id, product: info.product, url: info.url, password: info.password,
        version: info.version, pid: info.pid, proofKey: deriveServiceProofKey(info.control.token),
      }) + EOL)
      return
    }
    const found = yield* Service.discover({ ...options, version: undefined })
    process.stdout.write((found?.url ?? "stopped") + EOL)
  }),
)
