import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"

test("renders the default system prompt instructions", () => {
  const prompt = SessionSystemPrompt.make(["edit", "read", "shell"])
  expect(prompt).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
  expect(prompt).toContain("Use the edit tool for targeted changes to existing text files")
})

test("the build prompt asks for explicit paths and verification of runnable work", () => {
  const prompt = SessionSystemPrompt.make(["read", "write", "edit"])
  expect(prompt).toContain("Give each file tool its own path")
  expect(prompt).toContain("exercise the requested behavior")
  expect(SessionSystemPrompt.make(["read"])).not.toContain("completely replace")
})
