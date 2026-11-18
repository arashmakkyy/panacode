# Agent Run

A functional, independent recreation of Arc's public Agent run preview, built with React, TypeScript, Vite, and Motion. It does not include or require the proprietary Arc Pro source.

## Run

- `npm install`
- `npm run dev`
- `npm run build`
- `npx tsc --noEmit`
- `npx playwright test`

For a fresh browser testing environment, run `npx playwright install --with-deps chromium` first.

## Files

- `src/App.tsx`: preview page, navigation, searchable library, themes, responsive preview, and usage documentation.
- `src/components/agent-run/agent-run.tsx`: reusable `AgentRun` component and public exports.
- `src/components/agent-run/types.ts`: runtime state, steps, diffs, result, script, and callback types.
- `src/components/agent-run/use-simulated-run.ts`: animation-frame simulation with visibility and approval pauses.
- `src/components/agent-run/sample-script.ts`: the default two-file task and its single revision branch.
- `tests/agent-run.spec.ts`: browser tests, including live-runtime fixtures and accessibility audits.

## Behavior

The default run is a simulation. It reads and searches, pauses for a two-file approval, then reports simulated writes, type checks, and 12 passing tests. Rejecting requires a note and triggers one scripted revision. A second rejection stops without writing. The default pull request is explicitly simulated as PR #482.

The revision is predefined sample data, not an actual AI response to the rejection note. The note is preserved in the sent-back step.

For a real integration, pass `run` and connect `onApprove`, `onReject`, `onOpenPullRequest`, and `onRestart` to your own agent runtime. The component never executes code, edits repository files, or calls an AI API by itself. A live runtime remains the sole owner of the passed state. See the on-page live example and exported TypeScript interfaces.

Use `autoPlay={false}` to show a Start run button. Pass `script` to play your own scenario. The simulation pauses off screen, in a hidden browser tab, and at the approval gate.

## Reference

Public visual and behavior reference: https://uiarc.dev/components/blocks/agent-run

The original component is part of Arc Pro. This implementation was recreated from the public preview and documented behavior; it is not the original source or an assertion of pixel-for-pixel identity.