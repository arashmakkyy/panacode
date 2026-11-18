import { describe, expect, test } from "bun:test"
import { applyDecisions } from "../features/code-suggestion/apply"
import { suggestionFromPatch } from "./code-suggestion"

const before = ["a", "b", "c", "d", "e", ""].join("\n")
const after = ["a", "B", "c", "d", "x", "e", ""].join("\n")
const patch = `--- f\n+++ f\n@@ -1,5 +1,6 @@\n a\n-b\n+B\n c\n d\n+x\n e\n`

describe("suggestionFromPatch", () => {
  test("rebuilds the file before the edit and the Arc hunks", () => {
    const result = suggestionFromPatch(patch, after)
    expect(result.conflict).toBe(false)
    expect(result.code).toBe(before)
    expect(result.hunks).toEqual([
      { id: "h0-0", start: 1, remove: 1, insert: ["B"] },
      { id: "h0-1", start: 4, remove: 0, insert: ["x"] },
    ])
  })

  test("rejecting one hunk writes the file back without just that hunk", () => {
    const { code, hunks } = suggestionFromPatch(patch, after)
    expect(applyDecisions(code.split("\n"), hunks, { "h0-1": "rejected" })).toBe(["a", "B", "c", "d", "e", ""].join("\n"))
    expect(applyDecisions(code.split("\n"), hunks, { "h0-0": "rejected", "h0-1": "rejected" })).toBe(before)
    expect(applyDecisions(code.split("\n"), hunks, {})).toBe(after)
  })

  test("a hunk rejected earlier opens as rejected, not as a conflict", () => {
    const result = suggestionFromPatch(patch, ["a", "B", "c", "d", "e", ""].join("\n"))
    expect(result.conflict).toBe(false)
    expect(result.code).toBe(before)
    expect(result.rejected).toEqual(["h0-1"])
    const both = suggestionFromPatch(patch, before)
    expect(both.conflict).toBe(false)
    expect(both.rejected).toEqual(["h0-0", "h0-1"])
  })

  test("a file changed after the edit is a conflict", () => {
    expect(suggestionFromPatch(patch, after.replace("x", "y")).conflict).toBe(true)
  })
})
