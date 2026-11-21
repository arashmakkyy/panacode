import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { ProductIdentity } from "@opencode/util/product-identity"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdir } from "./fixture/tmpdir"

// Panacode and OpenCode keep separate data roots, databases, credential files and session
// tables. These runtimes open one database per product root, exactly like the two installed
// products do, and are read only through the product's own service entry points.
const productRuntime = (data: string, database: string) =>
  ManagedRuntime.make(
    AppNodeBuilder.build(LayerNode.group([Credential.node, SessionStore.node, Bus.node, Database.node]), [
      Global.node.replace(Global.layerWith({ data })),
      Database.node.replace(Database.configured({ path: path.join(data, database) })),
    ]),
  )

const openai = Integration.ID.make("openai")
const anthropic = Integration.ID.make("anthropic")

const credentials = (runtime: ReturnType<typeof productRuntime>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* Credential.Service
      return {
        openai: (yield* service.list(openai)).map((entry) => entry.value),
        anthropic: (yield* service.list(anthropic)).map((entry) => entry.value),
      }
    }),
  )

describe("per-product storage isolation", () => {
  test("imports only the legacy credentials from its own data root", async () => {
    await using tmp = await tmpdir("panacode-storage-isolation-")
    const panacodeData = path.join(tmp.path, ProductIdentity.slug)
    const opencodeData = path.join(tmp.path, ProductIdentity.upstreamSlug)
    await Bun.write(
      path.join(panacodeData, "auth.json"),
      JSON.stringify({ anthropic: { type: "api", key: "PANACODE_ANTHROPIC_KEY" } }),
    )
    await Bun.write(
      path.join(opencodeData, "auth.json"),
      JSON.stringify({ openai: { type: "api", key: "OPENCODE_OPENAI_KEY" } }),
    )

    const panacode = productRuntime(panacodeData, `${ProductIdentity.slug}.db`)
    const opencode = productRuntime(opencodeData, `${ProductIdentity.upstreamSlug}.db`)
    try {
      expect(await credentials(panacode)).toEqual({
        openai: [],
        anthropic: [{ type: "key", key: "PANACODE_ANTHROPIC_KEY" }],
      })
      expect(await credentials(opencode)).toEqual({
        openai: [{ type: "key", key: "OPENCODE_OPENAI_KEY" }],
        anthropic: [],
      })
    } finally {
      await Promise.all([panacode.dispose(), opencode.dispose()])
    }
  })

  test("returns only the sessions stored in its own database", async () => {
    await using tmp = await tmpdir("panacode-session-isolation-")
    const panacodeData = path.join(tmp.path, ProductIdentity.slug)
    const opencodeData = path.join(tmp.path, ProductIdentity.upstreamSlug)
    const panacodeSession = Session.ID.make("ses_panacode_fixed")
    const opencodeSession = Session.ID.make("ses_opencode_fixed")
    const panacode = productRuntime(panacodeData, `${ProductIdentity.slug}.db`)
    const opencode = productRuntime(opencodeData, `${ProductIdentity.upstreamSlug}.db`)
    try {
      await seedSession(panacode, {
        sessionID: panacodeSession,
        projectID: Project.ID.make("prj_panacode"),
        title: "Panacode session",
        directory: path.join(tmp.path, "panacode-project"),
      })
      await seedSession(opencode, {
        sessionID: opencodeSession,
        projectID: Project.ID.make("prj_opencode"),
        title: "OpenCode session",
        directory: path.join(tmp.path, "opencode-project"),
      })

      expect(await sessions(panacode, panacodeSession, opencodeSession)).toEqual({
        own: "Panacode session",
        foreign: undefined,
        listed: ["Panacode session"],
      })
      expect(await sessions(opencode, opencodeSession, panacodeSession)).toEqual({
        own: "OpenCode session",
        foreign: undefined,
        listed: ["OpenCode session"],
      })
    } finally {
      await Promise.all([panacode.dispose(), opencode.dispose()])
    }
  })
})

function seedSession(
  runtime: ReturnType<typeof productRuntime>,
  input: {
    readonly sessionID: Session.ID
    readonly projectID: Project.ID
    readonly title: string
    readonly directory: string
  },
) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const directory = AbsolutePath.make(input.directory)
      yield* db
        .insert(ProjectTable)
        .values({ id: input.projectID, worktree: directory, sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: input.sessionID,
          project_id: input.projectID,
          slug: input.title,
          directory,
          version: "0.0.0",
          title: input.title,
        })
        .run()
        .pipe(Effect.orDie)
    }),
  )
}

function sessions(
  runtime: ReturnType<typeof productRuntime>,
  sessionID: Session.ID,
  foreignSessionID: Session.ID,
) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* SessionStore.Service
      const own = yield* service.get(sessionID)
      const foreign = yield* service.get(foreignSessionID)
      const listed = yield* service.list()
      return { own: own?.title, foreign, listed: listed.map((session) => session.title) }
    }),
  )
}