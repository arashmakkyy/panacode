import { expect, test } from "@playwright/test"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { setupTimeline } from "../utils/timeline"

for (const { width, locale } of [
  { width: 1400, locale: "en" },
  { width: 390, locale: "ar" },
]) {
  test(`keeps notices on one line at ${width}px with stored locale ${locale}`, async ({ page }) => {
    const command =
      "bun run inspect --target src/renderer/session-timeline.ts --output artifacts/inspection-report.json ".repeat(5)

    const descriptions = [
      `${command}--finished`,
      `Instructions changed\n${command}--updated`,
      `\u0645\u0631\u0627\u062c\u0639\u0629 ${command}--reviewed`,
    ]

    await setupTimeline(page, {
      settings: {
        timelineDetail: { ...timelinePresets[2].value, notices: { placement: "separate" } },
      },
      locale,
      viewport: { width, height: 900 },
      sessionMessages: [
        {
          id: "msg_notice_user",
          type: "user",
          text: "Inspect the project and report completion.",
          time: { created: 1 },
        },
        {
          id: "msg_notice_shell",
          type: "synthetic",
          text: "Complete",
          description: descriptions[0],
          metadata: { source: "shell", state: "completed" },
          time: { created: 2 },
        },
        { id: "msg_notice_system", type: "system", text: descriptions[1], time: { created: 3 } },
        {
          id: "msg_notice_agent",
          type: "synthetic",
          text: "Complete",
          description: descriptions[2],
          metadata: { source: "subagent", state: "completed", agent: "general" },
          time: { created: 4 },
        },
      ],
    })
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr")
    await page.getByRole("button", { name: "Finished 1 shell" }).click()
    await page.getByRole("button", { name: "Finished 1 subagent" }).click()
    const notices = page.locator('[data-slot="session-timeline-notice"], [data-slot="timeline-event-item-title"]')
    await expect(notices).toHaveCount(3)
    await expect(notices).toContainText(descriptions)
    await expect
      .poll(() =>
        notices.evaluateAll((nodes) =>
          nodes.map((element) => {
            const style = getComputedStyle(element)

            return {
              direction: style.direction,
              whiteSpace: style.whiteSpace,
              textOverflow: style.textOverflow,
              overflow: style.overflowX,
              singleLine:
                Math.abs(
                  element.clientHeight -
                    parseFloat(style.paddingTop) -
                    parseFloat(style.paddingBottom) -
                    parseFloat(style.lineHeight),
                ) <= 1,
              clipped: element.scrollWidth > element.clientWidth,
            }
          }),
        ),
      )
      .toEqual(
        Array.from({ length: 3 }, () => ({
          direction: "ltr",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          overflow: "hidden",
          singleLine: true,
          clipped: true,
        })),
      )
  })
}
