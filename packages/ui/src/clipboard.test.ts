import { expect, test } from "bun:test"
import { writeClipboard } from "./clipboard"

test("the native bridge receives the exact text once before any browser API is needed", async () => {
  const text = "خط اول\n\n```ts\nconst n = 2\n```\n"
  const sent: string[] = []
  expect(
    await writeClipboard(text, async (value) => {
      sent.push(value)
    }),
  ).toBe(true)
  expect(sent).toEqual([text])
})
