import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { holdRoute } from "../utils/app"
import {
  assistantMessage,
  directory,
  partUpdated,
  sessionID,
  setupTimeline,
  textPart,
  toolPart,
  userID,
  userMessage,
  userText,
} from "../utils/timeline"

test("keeps shell and question failures in their Used group", async ({ page }) => {
  const shellID = "prt_transition_error_shell"
  const questionID = "prt_transition_error_question"

  const timeline = await setupTimeline(page, {
    settings: { timelineDetail: timelinePresets[2].value },
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(shellID, "shell", "streaming", { command: "exit 1" }),
          toolPart(questionID, "question", "streaming", questionInput()),
        ],
        { completed: false },
      ),
    ],
  })

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const used = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  await used.click()
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(toolPart(shellID, "shell", "running", { command: "exit 1" })))
  await expect(page.locator(`[data-timeline-part-id="${shellID}"]`)).toContainText("exit 1")
  await timeline.send(partUpdated(toolPart(questionID, "question", "running", questionInput())))
  await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
  await timeline.send(
    partUpdated(
      toolPart(
        shellID,
        "shell",
        "completed",
        { command: "exit 1" },
        { output: "Command exited 1", metadata: { exit: 1 } },
      ),
    ),
  )
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "error", questionInput(), { error: "The user dismissed this question" }),
    ),
  )

  await expect(group).toHaveAttribute("data-timeline-part-ids", `${shellID},${questionID}`)
  await expect(used).toHaveAttribute("aria-expanded", "true")
  const shell = group.locator(`[data-timeline-part-id="${shellID}"]`)
  await expect(shell.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
  await shell.locator('[data-slot="collapsible-trigger"]').click()
  await expect(shell).toContainText("Command exited 1")
  const question = group.locator(`[data-timeline-part-id="${questionID}"]`)
  await expect(question).toContainText(/dismissed/i)
})

test("keeps rendering when a plugin tool reports progress metadata that is not an object", async ({ page }) => {
  const toolID = "prt_plugin_progress"
  const input = { prompt: "a cat" }

  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([toolPart(toolID, "plugin_imagegen", "running", input)], { completed: false }),
    ],
  })

  await page.getByRole("button", { name: /Using 1 tool/ }).click()
  await timeline.waitForPart(toolID)

  const progress = partUpdated(
    toolPart(toolID, "plugin_imagegen", "running", input, { metadata: { status: "x" } }),
  ).find((event) => event.type === "session.tool.progress")!

  // Plugin tools are untyped at runtime, and the server forwards progress metadata as sent, so the
  // frame is written raw to skip the harness's event validation.
  await timeline.transport.writeRaw(
    `data: ${JSON.stringify({ ...progress, data: { ...progress.data, metadata: "polling" } })}\n\n`,
  )
  await timeline.send(partUpdated(textPart("prt_plugin_progress_text", "Still polling the image task.")))

  await expect(page.getByText("Still polling the image task.")).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${toolID}"]`)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

test("keeps a tool in the transcript and its details open across progress updates", async ({ page }) => {
  const id = "prt_read_progress"
  const input = { filePath: "package.json" }

  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart(id, "read", "running", input)], { completed: false })],
  })

  const group = page.getByRole("button", { name: /Using 1 tool/ })
  await expect(page.getByText("Build the timeline stability matrix.", { exact: true })).toHaveCount(1)
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await group.click()
  const row = page.locator(`[data-timeline-part-id="${id}"]`)
  const trigger = row.getByRole("button", { name: /package.json/ })
  await trigger.click()
  await expect(trigger).toBeFocused()
  await timeline.send(partUpdated(toolPart(id, "read", "completed", input, { output: "package contents" })))
  await expect(row.getByText("package contents", { exact: true })).toBeVisible()
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('[data-component="session-composer-dock"]')).not.toContainText("Build the timeline stability matrix.")
})

test.describe("mobile session with a legacy language preference", () => {
  test.use({ hasTouch: true, locale: "fa-IR" })

  test("shows English navigation and live statuses on a Persian device", async ({ page }) => {
    const timeline = await setupTimeline(page, {
      locale: "fa",
      viewport: { width: 320, height: 720 },
      messages: [
        userMessage(),
        assistantMessage([toolPart("prt_read", "read", "running", { filePath: "README.md" })], { completed: false }),
      ],
    })

    await expect(page.getByRole("tab", { name: "More..." })).toBeVisible()
    await expect(page.getByRole("tab", { name: "Changes", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeAttached()
    const status = page.locator('[data-component="session-working"]')
    await expect(status).toHaveAccessibleName("Working")

    await timeline.send(partUpdated(toolPart("prt_shell", "shell", "running", { command: "pwd" })))
    await expect(status).toHaveAccessibleName("Waiting for shell")

    await timeline.send({
      id: "evt_ui_question",
      created: 1700000003000,
      location: { directory },
      type: "form.created",
      data: {
        form: {
          id: "frm_ui_question",
          sessionID,
          title: "Filename",
          metadata: { kind: "question" },
          fields: [{ key: "file", type: "string", title: "Filename" }],
        },
      },
    })
    await expect(status).toHaveAccessibleName("Waiting for your answer")

    await timeline.send({
      id: "evt_ui_permission",
      created: 1700000004000,
      location: { directory },
      type: "permission.asked",
      data: { id: "per_ui_read", sessionID, action: "read", resources: ["README.md"], metadata: {} },
    })
    await expect(status).toHaveAccessibleName("Waiting for approval")
  })
})

test("copies the original answer with code and Markdown intact", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  const answer = "**Run this**\n\n```js\nconst value = `total: ${2 ** 3}`\n```"
  await setupTimeline(page, { messages: [
    userMessage(), assistantMessage([textPart("prt_copy", answer)]),
  ] })
  await expect(page.getByText("Build the timeline stability matrix.", { exact: true })).toHaveCount(1)
  await expect(page.getByText("Run this", { exact: true })).toHaveCount(1)
  await page.locator('[data-component="panacode-chat-actions"]').getByRole("button", { name: "Copy", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(answer)
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

test("retry sends the selected message once and preserves ongoing draft edits", async ({ page }) => {
  const prompts: unknown[] = []
  const stages: unknown[] = []

  const original = userMessage([
    userText("Review @build and the attached file"),
    { type: "agent", id: "prt_original_agent", name: "build", source: { value: "@build", start: 7, end: 13 } },
    { type: "file", id: "prt_original_file", filename: "sample.txt", mime: "text/plain", url: "data:text/plain;base64,eA==" },
  ])

  await setupTimeline(page, {
    messages: [original, assistantMessage([textPart("prt_original_reply", "Done with the review")])],
    onRevertStage: (input) => stages.push(input),
    onPrompt: (input) => prompts.push(input),
  })
  const editor = page.locator('[data-component="composer-editor"]')
  await editor.fill("My private draft")
  const stage = await holdRoute(page, "**/revert/stage", { method: "POST" })
  const retry = page.locator(".pc-ac-footer").getByRole("button", { name: "Retry", exact: true })
  await retry.click()
  await stage.arrived
  await retry.dispatchEvent("click")
  await editor.fill("Edited while the server was waiting")
  stage.release()
  await expect.poll(() => prompts.length).toBe(1)
  expect(stages).toEqual([{ sessionID, messageID: userID }])
  expect(prompts[0]).toMatchObject({
    sessionID,
    body: {
      text: original.text,
      agents: original.agents,
      files: [{ name: "sample.txt", uri: "data:text/plain;base64,eA==" }],
    },
  })
  await expect(editor).toHaveText("Edited while the server was waiting")
})

for (const failure of ["interrupt", "wait", "revert/stage"]) {
  test(`retry keeps the draft and sends no prompt if ${failure} fails`, async ({ page }) => {
    const prompts: unknown[] = []
    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart("prt_retry_fail", "The original reply")])],
      onPrompt: (input) => prompts.push(input),
    })
    await page.route((url) => url.pathname.endsWith("/" + failure), (route) => route.fulfill({ status: 503 }))
    const editor = page.locator('[data-component="composer-editor"]')
    await editor.fill("Unsent draft")
    const retry = page.locator(".pc-ac-footer").getByRole("button", { name: "Retry", exact: true })
    await retry.click()
    await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
    await expect(editor).toHaveText("Unsent draft")
    await expect(retry).toBeEnabled()
    expect(prompts).toEqual([])
  })
}

test("a transient review write can be retried and preserves the accepted change and exact bytes", async ({ page }) => {
  const file = "sample.txt"
  const patch = "--- a/sample.txt\n+++ b/sample.txt\n@@ -1,4 +1,4 @@\n-old A\n+new A\n same\n-old B\n+new B\n last\n"
  let disk = "\uFEFFnew A\r\nsame\r\nnew B\r\nlast\r\n"
  const writes: string[] = []
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart("prt_mixed", "edit", "completed", { filePath: file },
      { output: "Changed both lines", metadata: { files: [{ file, patch, status: null }] } })])],
    fileContent: () => disk,
  })
  await page.route("**/api/experimental/fs/write**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("expectedSha256")).toMatch(/^[a-f0-9]{64}$/)
    const contents = route.request().postDataBuffer()!.toString("utf8")
    writes.push(contents)

    if (writes.length === 1) return route.fulfill({ status: 503 })
    disk = contents

    return route.fulfill({ json: { location: { directory: "C:/OpenCode/TimelineStability" }, data: { path: file } } })
  })
  await page.getByRole("button", { name: "Used 1 tool", exact: true }).click()
  const toggle = page.locator('[data-timeline-part-id="prt_mixed"]').getByRole("button", { name: /sample.txt/ }).first()
  await toggle.click()
  const card = page.locator('[data-component="panacode-code-suggestion"]')
  await card.locator("[data-accept]").first().click()
  const reject = card.getByRole("button", { name: "Reject all", exact: true })
  await expect(reject).toBeEnabled()
  await reject.click()
  await expect(card.getByRole("alert")).toContainText("Could not write")
  await expect(reject).toBeEnabled()
  await reject.click()
  await expect(card.locator(".cs-status-label")).toContainText(/1 kept.*1 rejected/i)
  const expected = "\uFEFFnew A\r\nsame\r\nold B\r\nlast\r\n"
  expect(writes).toEqual([expected, expected])
  expect(disk).toBe(expected)
  await toggle.click()
  await toggle.click()
  await expect(card.locator(".cs-status-label")).toContainText(/1 kept.*1 rejected/i)
})

test("denied clipboard access offers full selectable reply and tool output", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } })
    const nativeCommand = document.execCommand.bind(document)
    document.execCommand = (command, ...args) => command === "copy" ? false : nativeCommand(command, ...args)
  })
  const answer = "**Answer**\n\nwith Markdown\n"
  const output = Array.from({ length: 100 }, (_, i) => "file line " + i).join("\n") + "\n"
  await setupTimeline(page, { messages: [userMessage(), assistantMessage([
    toolPart("prt_manual_copy", "read", "completed", { filePath: "manual.txt" }, { output }),
    textPart("prt_manual_answer", answer),
  ])] })
  await page.locator(".pc-ac-footer").getByRole("button", { name: "Copy", exact: true }).click()
  const field = page.getByRole("textbox", { name: "Select and copy the text" })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue(answer)
  const selection = await field.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])
  expect(selection).toEqual([0, answer.length])
  await field.press("Escape")
  await expect(page.locator(".pc-ac-footer").getByRole("button", { name: "Copy", exact: true })).toBeFocused()
  await page.getByRole("button", { name: "Used 1 tool", exact: true }).click()
  await page.locator('[data-timeline-part-id="prt_manual_copy"]').getByRole("button", { name: /manual.txt/ }).click()
  await page.getByRole("button", { name: "Copy output", exact: true }).click()
  await expect(field).toHaveValue(output)
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click()
  await expect(field).toHaveCount(0)
})
