import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, textPart, toolPart, userMessage } from "../utils/timeline"

test("keeps failed search calls and their error cards inside the collapsed stack", async ({ page }) => {
  const parts = [
    toolPart(
      "prt_error_glob",
      "glob",
      "error",
      { path: "C:/Users", pattern: "*.ts" },
      {
        error: "Invalid tool input",
      },
    ),
    toolPart(
      "prt_error_grep",
      "grep",
      "error",
      { path: "C:/Users", pattern: "value" },
      {
        error: "Search timed out after 30 seconds",
      },
    ),
  ]

  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const summary = group.getByRole("button", { name: "Used 2 Glob, Grep", exact: true })
  await expect(summary).toHaveAttribute("aria-expanded", "false")
  await summary.click()
  await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(2)
  const glob = group.locator('[data-timeline-part-id="prt_error_glob"]')
  await expect(glob.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await glob.getByRole("button").click()
  await expect(glob).toContainText("Invalid tool input")
  await expect(glob.locator('[data-component="tool-error-card-icon"]')).toBeVisible()
  await expect(glob.locator('[data-component="tool-error-card-icon"] use')).toHaveAttribute(
    "href",
    "#opencode-v2-icon-outline-hexagonal-warning",
  )
  await expect
    .poll(() =>
      glob
        .locator('[data-kind="tool-error-card"]')
        .evaluate((element) => getComputedStyle(element, "::before").display),
    )
    .toBe("none")
  await group.locator('[data-timeline-part-id="prt_error_grep"]').getByRole("button").click()
  await expect(group.locator('[data-timeline-part-id="prt_error_grep"]')).toContainText(
    "Search timed out after 30 seconds",
  )
})

for (const recovered of [false, true]) {
  test(`Panacode run card reports a ${recovered ? "recovered" : "failed"} tool turn`, async ({ page }) => {
    const path = "landing-page/index.html"
    const announcement = "Let me rewrite the file now."
    const reply = "The page was saved."
    const error = { type: "provider.api", message: "Request body is too large", status: 413 }
    const parts = [
      textPart("prt_announce", announcement),
      toolPart("prt_git", "shell", "completed", { command: "git status" }, { metadata: { exit: 1 } }),
      toolPart("prt_write", "write", "error", { path }, { error: "Missing required argument" }),
    ]
    const attempts = [assistantMessage(parts)]
    if (recovered) {
      attempts.push(assistantMessage([
        toolPart("prt_saved", "write", "completed", { path, content: "<html></html>" }),
        textPart("prt_answer", reply),
      ], { id: "msg_1002_retry", created: 1700000003000 }))
    }
    await setupTimeline(page, { sessionMessages: [
      userMessage(), ...attempts,
      {
        type: "idle", id: "msg_1003_idle", time: { created: 1700000005000 },
        outcome: recovered ? "succeeded" : "failed", error: recovered ? undefined : error,
      },
    ] })

    const card = page.locator('[data-component="panacode-agent-run"]')
    await expect(card).toHaveAttribute("data-status", recovered ? "done" : "failed")
    await expect(card.locator(".pc-ar-status")).toHaveText(recovered ? "Done" : "Failed")
    await expect(card).toContainText(recovered ? reply : error.message)
    await expect(card).not.toContainText(announcement)
    await card.getByRole("button", { name: /steps ·/ }).click()
    const shell = card.getByRole("listitem").filter({ hasText: "git status" })
    await expect(shell).toHaveAttribute("data-status", "failed")
    const write = card.getByRole("listitem").filter({ hasText: "index.html" })
    await expect(write.filter({ has: page.getByText("Write", { exact: true }) })).toHaveAttribute("data-status", "failed")
    if (recovered) {
      await expect(write.filter({ has: page.getByText("Wrote", { exact: true }) })).toHaveAttribute("data-status", "done")
    }
  })
}
