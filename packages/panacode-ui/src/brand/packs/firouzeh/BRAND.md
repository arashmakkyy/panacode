# Panacode brand, direction 3: Firouzeh (فیروزه)

Pure signal. Zero noise.

Firouzeh is Persian turquoise, the stone of protection and victory. Here it becomes a single high-voltage signal on near-black. The mark is a P whose counter is a block cursor, cut at a 45° prompt angle: fast, sharp, engineered. The Warp/Zed end of the spectrum: crisp geometry, mono details, and one colour that means 'live'.

## Files
- `mark.svg` (primary), `mark-on-light.svg`, `mark-mono.svg` (uses currentColor). Hand-drawn on a 64-unit grid.
- `wordmark.svg`: Space Grotesk, outlined to paths, so no font is needed.
- `lockup-dark-bg.svg`, `lockup-light-bg.svg`
- `icon.svg`: Windows 11 tile master. `renders/icon-1024.png`
- `tokens.css`: Arc theme contract (dark default, `[data-theme="light"]`). `tokens.json` holds the same values.
- `fonts.css` + `fonts/`: OFL fonts (Space Grotesk, Inter, JetBrains Mono, Noto Sans Arabic)
- `splash.html`, `app-mock.html` (1440x900), `board.html`
- `renders/`: mark-16/32/64/512, icon-1024, splash, app-mock (1x and 2x)

## Type
Display: Space Grotesk (wordmark, hero and splash only). UI: Inter. Code: JetBrains Mono.

| token | size | line-height | weight | tracking | role |
|---|---|---|---|---|---|
| display-xl | 56px | 1.04 | 650 | -0.035em | Splash, onboarding hero |
| display-lg | 40px | 1.08 | 650 | -0.03em | Empty states, big moments |
| title-lg | 28px | 1.15 | 600 | -0.02em | Page titles (Settings, MCP) |
| title | 20px | 1.25 | 600 | -0.015em | Session title, dialog title |
| body-lg | 16px | 1.5 | 450 | -0.01em | Chat prose |
| body | 14px | 1.45 | 450 | -0.006em | UI default, sidebar, menus |
| label | 13px | 1.35 | 550 | -0.003em | Buttons, pills, tabs |
| caption | 12px | 1.35 | 500 | 0.0em | Meta, timestamps, counters |
| micro | 11px | 1.3 | 600 | 0.04em | Overlines (uppercase) |
| code | 13px | 1.6 | 450 | 0.0em | Code, diffs, terminal (mono) |

## Motion
- **Instant or nothing.** UI feedback lands in 120ms or less. Panels take 160ms on ease-standard. Nothing is decorative.
- **Cursor is the heartbeat.** The block cursor blinks when the agent is idle and holds solid while it streams.
- **One pulse per state.** On a state change (live, done, error) the accent glows once for 240ms and fades.
- **Linear for data.** Progress and meters move linearly. Space (layout, drawers) eases. You never mix the two.

## Colour rule (Arc language)
Neutrals carry the UI. The accent appears only on the mark, the send action, live state (caret, active session, progress, focus) and links.
Risk and status use semantic tones (success, warning, danger). The primary approval CTA stays solid high-contrast neutral.
