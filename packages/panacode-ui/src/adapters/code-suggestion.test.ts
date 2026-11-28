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
    expect(applyDecisions(code.split("\n"), hunks, { "h0-1": "rejected" })).toBe(
      ["a", "B", "c", "d", "e", ""].join("\n"),
    )
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

describe("file review round trips", () => {
  const cases = [
    { name: "delete at EOF", patch: "@@ -1,2 +1 @@\n one\n-removed\n", before: "one\nremoved\n", after: "one\n" },
    { name: "multi-line deletion", patch: "@@ -1,3 +1 @@\n one\n-a\n-b\n", before: "one\na\nb\n", after: "one\n" },
    { name: "middle deletion", patch: "@@ -1,3 +1,2 @@\n a\n-x\n c\n", before: "a\nx\nc\n", after: "a\nc\n" },
    { name: "leading insertion", patch: "@@ -1 +1,2 @@\n+x\n old\n", before: "old\n", after: "x\nold\n" },
    { name: "empty file", patch: "@@ -1 +0,0 @@\n-x\n", before: "x\n", after: "" },
    {
      name: "add newline only",
      patch: "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+old\n",
      before: "old",
      after: "old\n",
    },
    {
      name: "remove newline only",
      patch: "@@ -1 +1 @@\n-old\n+old\n\\ No newline at end of file\n",
      before: "old\n",
      after: "old",
    },
    {
      name: "normalized git diff on a CRLF worktree",
      patch: "@@ -1,2 +1,2 @@\n-old\n+new\n last\n",
      before: "\uFEFFold\r\nlast\r\n",
      after: "\uFEFFnew\r\nlast\r\n",
    },
    {
      name: "BOM CRLF UTF-8",
      patch: "@@ -1,2 +1,2 @@\n-اول\r\n+دوم\r\n last\r\n",
      before: "\uFEFFاول\r\nlast\r\n",
      after: "\uFEFFدوم\r\nlast\r\n",
    },
  ]
  test.each(cases)("$name preserves bytes and detects a previous rejection", ({ patch, before, after }) => {
    for (const disk of [after, before]) {
      const result = suggestionFromPatch(patch, disk)
      expect(result.conflict).toBe(false)
      expect(result.rejected).toEqual(disk === before ? ["h0-0"] : [])
      expect(new TextEncoder().encode(result.render({ "h0-0": "rejected" }))).toEqual(new TextEncoder().encode(before))
      expect(result.render({})).toBe(after)
    }
  })
  test.each([0, 90_000, 179_999])("one edit in a large file at line %i", (start) => {
    const source = "a\n".repeat(start),
      suffix = "a\n".repeat(180_000 - start - 1)
    const result = suggestionFromPatch(`@@ -${start + 1} +${start + 1} @@\n-old\n+new\n`, source + "new\n" + suffix)
    expect(result.conflict).toBe(false)
    expect(result.render({ "h0-0": "rejected" })).toBe(source + "old\n" + suffix)
  })
})
