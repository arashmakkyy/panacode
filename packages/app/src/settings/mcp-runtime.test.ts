import { expect, test } from "bun:test"
import { runtimeMcpDetails } from "./mcp-runtime"

test("same named runtime tools are scoped to host, directory and workspace, including late responses", async () => {
  const first = { url: "https://host.test" }
  const second = { url: "https://host.test" }
  const a = runtimeMcpDetails(first, { directory: "/repo", workspaceID: "a" }, "search")
  const b = runtimeMcpDetails(first, { directory: "/repo", workspaceID: "b" }, "search")
  const other = runtimeMcpDetails(second, { directory: "/repo", workspaceID: "a" }, "search")
  const sub = runtimeMcpDetails(first, { directory: "/repo/sub", workspaceID: "a" }, "search")
  const pending = Promise.withResolvers<void>()
  const addA = a.add({ type: "remote", url: "https://u:p@a.test/path?token=secret#private" }, pending.promise)
  await b.add({ type: "local", command: ["node", "b.js", "--key", "private"] }, Promise.resolve())
  pending.resolve()
  await addA
  expect(a.get()).toEqual({ type: "remote", url: "https://a.test/path" })
  expect(b.get()).toEqual({ type: "local", command: ["node", "b.js"] })
  expect(other.get()).toBeUndefined()
  expect(sub.get()).toBeUndefined()
  await expect(a.remove(Promise.reject(new Error("offline")))).rejects.toThrow("offline")
  expect(a.get()).toBeDefined()
  await expect(
    sub.add({ type: "remote", url: "https://x.test" }, Promise.reject(new Error("offline"))),
  ).rejects.toThrow("offline")
  expect(sub.get()).toBeUndefined()
  await a.remove(Promise.resolve())
  expect(a.get()).toBeUndefined()
  expect(runtimeMcpDetails(first, { directory: "/repo", workspaceID: "b" }, "search").get()).toEqual(b.get())
})
