@panacode-arc-ex.zip 
# PANACODE — Complete UI Redesign with Upstream-Safe Architecture

## ROLE

You are the lead software architect, senior SolidJS engineer, UI design system engineer, and OpenCode fork maintainer responsible for transforming OpenCode into **Panacode**.

This is a real production implementation task.

Your work must satisfy three major objectives:

1. Replace OpenCode's visual identity with a complete, consistent Panacode design system.
2. Integrate the eight custom UI implementations supplied in the attached archive, adapting them to the actual application.
3. Maintain an upstream-friendly architecture that makes future OpenCode updates significantly easier to integrate without destroying Panacode customizations.

**Your goal is not merely to redesign OpenCode. Your goal is to maintain a sustainable, independently branded OpenCode fork.**

The work must be completed in two implementation phases, followed by mandatory documentation and upstream-maintenance verification.

---

# 1. SOURCE INPUT — ATTACHED ZIP

I am providing an attached archive containing eight UI component projects.

The attachment is named:

`panacode-arc-ex.zip`

**Important: The internal projects have already been extracted.**

Unlike the original archive format, the supplied archive now contains the extracted project directories and their actual source files.

Do not expect eight nested ZIP archives.

Do not search for a `new-ui-com/` directory in the GitHub repository.

### Required procedure

1. Locate the supplied attachment.
2. Extract the outer ZIP archive once.
3. Discover all eight component project directories.
4. Recursively inspect their existing extracted contents.
5. Locate their TypeScript, TSX, CSS, JSON, dependency manifests, and other supporting assets.
6. Read and understand the actual implementations.
7. Identify their component dependencies, animation systems, and reusable UI primitives.
8. Identify demo-only logic and mock data.
9. Prepare an integration mapping for the existing OpenCode application.

Do not extract files that have already been extracted.

Do not overwrite existing repository files with the contents of these standalone projects.

Use safe archive extraction and keep the input files isolated from production source until their integration is planned.

The eight provided implementations are:

- AI Chat
- AI Composer
- Agent Run
- Agent Orchestrator
- Agent Approvals
- Tool Call
- Code Suggestion
- MCP Servers

These are design and implementation references.

They must be adapted intelligently to Panacode rather than copied into the application unchanged.

Preserve any required licenses and third-party notices.

---

# 2. PRODUCT VISION

Panacode is an independent AI coding IDE based on OpenCode.

The final product will eventually include:

- A Windows desktop application
- A centralized web dashboard
- Browser-based desktop authentication
- Prepaid wallet and credit management
- Usage-based AI billing
- AI model routing through a reseller provider

This implementation focuses on the **desktop application UI**.

Do not build unrelated backend, wallet, or payment functionality during this task.

## Visual goal

The finished application must have a completely independent Panacode visual identity.

A user should not feel that Panacode is simply OpenCode with changed colors and a different logo.

The entire interface must be consistent, including:

- Application shell
- Sidebar and navigation
- Chat and composer
- Agent execution UI
- Tools and permissions
- Code review
- Settings
- File explorer
- Terminal controls
- Browser controls
- Dialogs
- Buttons
- Switches
- Inputs
- Menus
- Notifications
- Loading and error states

Every existing feature should retain its functionality while adopting the new design.

**Functional OpenCode underneath. Visually independent Panacode on top.**

---

# 3. CRITICAL — UPSTREAM-SAFE ARCHITECTURE

This is one of the most important requirements in the entire project.

OpenCode is actively developed upstream.

Panacode must be able to receive future OpenCode updates without having to redo the complete redesign.

Future updates may include:

- New agent capabilities
- Model integrations
- Performance improvements
- Security fixes
- New tools
- New settings
- New UI features
- Architectural refactors
- Bug fixes

We must preserve the ability to incorporate these changes.

## 3.1 Golden rule: Separate Panacode customization from upstream functionality

**Never modify upstream code unnecessarily.**

Whenever possible, create Panacode-owned modules, adapters, design tokens, wrappers, and components instead of directly rewriting large OpenCode files.

Prefer:

- Composition over modification
- Presentation adapters over domain rewrites
- Centralized theme overrides over scattered CSS edits
- Dedicated components over copied upstream files
- Small integration points over large source replacements
- Stable contracts over direct access to implementation details

When direct modification is unavoidable, keep it as small, isolated, and well-documented as possible.

The objective is to minimize the surface area where Panacode-specific code overlaps with upstream OpenCode changes.

## 3.2 Preserve upstream architecture

OpenCode currently uses SolidJS for the application UI and Electron for its desktop shell.

Keep the existing architecture unless a specific change is essential.

Do not:

- Rewrite the entire frontend in React.
- Replace the OpenCode session engine.
- Replace the existing backend.
- Rewrite provider integrations unnecessarily.
- Replace the terminal emulator.
- Replace the file diff engine.
- Rewrite the application routing system without a strong reason.
- Duplicate core application services.
- Replace working data flows with demo implementations.

The supplied component projects use React.

Port their design and required behavior into native SolidJS-compatible components.

The ported implementations should use existing OpenCode services and application state.

## 3.3 Introduce a Panacode-owned UI layer

Create a clearly separated area for Panacode-specific UI code.

A possible structure is:

```text
packages/
  panacode-ui/
    src/
      theme/
      tokens/
      primitives/
      components/
      features/
      adapters/
      motion/
      icons/
      styles/
      index.ts
```

This structure is a suggested architecture, not an instruction to blindly create a new package.

First inspect the actual monorepo and workspace configuration.

If a separate package is technically appropriate, create it with correct workspace integration.

Otherwise, use an isolated Panacode namespace within the existing shared UI architecture.

Choose the solution that minimizes upstream conflicts while remaining compatible with the existing build system.

### Requirements

- Panacode-specific components should be identifiable by location and ownership.
- Shared tokens should have one authoritative source.
- Panacode feature adapters should be separated from generic primitives.
- Upstream-facing integration files should remain small.
- Avoid duplicating original OpenCode components when composition can achieve the same result.
- Document every unavoidable modification to an upstream-owned file.

## 3.4 Prefer adapters for existing application functionality

Use a presentation-adapter approach:

```text
Existing OpenCode State / Services
               |
               v
      Panacode UI Adapter
               |
               v
      Panacode Component
```

For example:

```text
OpenCode Session State
          |
          v
Panacode Chat Adapter
          |
          v
Panacode Chat UI
```

The adapter translates existing application state and events into the props and callbacks expected by the Panacode component.

Do not create a new, independent source of truth for the same functionality.

Keep application events, permissions, persistence, and domain behavior connected to their existing implementations.

## 3.5 Avoid destructive source replacements

Do not replace entire upstream files when only a small integration change is needed.

For example, if an OpenCode file contains session logic and UI rendering, prefer extracting or isolating the presentation boundary rather than replacing its internal logic with the imported component.

Avoid wholesale rewrites of complex files merely to obtain a visual change.

When an upstream component must be modified:

1. Identify its existing public behavior.
2. Determine whether wrapping, composition, or a small integration hook is possible.
3. Prefer the smallest safe change.
4. Preserve the existing component contract where practical.
5. Add regression tests.
6. Document the change in the upstream merge guide.

Do not use brittle runtime monkey patches, arbitrary DOM mutations, or uncontrolled CSS selectors that could silently break after upstream updates.

## 3.6 Preserve internal compatibility

Do not blindly rename existing internal packages such as:

`@opencode/*`

Do not change internal API routes, protocol names, storage formats, event names, or configuration keys solely for visual branding.

Visible application branding should become Panacode.

Internal compatibility identifiers may remain unchanged when changing them would harm functionality or upstream maintainability.

Preserve legal attribution and upstream license notices.

## 3.7 Preserve build and release independence

Panacode must eventually ship its own desktop builds.

Do not rely on OpenCode's production update channel for Panacode releases.

Preserve or establish distinct:

- Desktop application identity
- Application data directories
- Deep-link protocol handling
- Update configuration
- Build artifacts
- Installer identity
- Release channels

Audit the existing desktop packaging process, including how it bundles or downloads the CLI/server.

Ensure that production Panacode builds do not unintentionally bundle or download incompatible upstream OpenCode executables.

Where full release migration is outside this UI task, document the exact blocker rather than silently using upstream release infrastructure.

Do not modify production credentials or deploy new update infrastructure as part of the redesign.

---

# 4. UPSTREAM MAINTENANCE STRATEGY

Create a sustainable Git strategy.

The repository should retain two distinct concepts:

**Upstream:** Original OpenCode development.

**Panacode:** Our own product development.

Use conventional remotes where appropriate:

```bash
git remote -v
```

The intended structure is:

```text
origin    → Panacode fork
upstream  → Original OpenCode repository
```

Do not replace the original upstream remote with the Panacode repository.

Do not assume the upstream default branch is permanently named `dev`.

Discover the actual upstream default branch or deliberately selected integration branch.

Pin and record the exact upstream commit used as the baseline.

## Branch strategy

Use a stable Panacode integration branch and separate working branches for development.

A recommended structure is:

```text
panacode/main
feature/panacode-ui-foundation
feature/panacode-ui-phase-1
feature/panacode-ui-phase-2
integration/upstream-YYYYMMDD
```

Adapt branch names to the existing repository conventions.

Do not destructively rename existing branches without a justified migration.

## Update strategy

Future OpenCode updates must be integrated through a controlled process.

The preferred process is:

1. Fetch the latest upstream changes.
2. Identify the upstream commit range.
3. Review affected files.
4. Compare those changes with Panacode integration points.
5. Create a dedicated integration branch.
6. Merge the selected upstream branch into the integration branch.
7. Resolve conflicts carefully.
8. Run automated tests.
9. Validate all major UI surfaces.
10. Compare functional behavior before and after the merge.
11. Merge the verified integration branch into the stable Panacode branch.

Do not automatically accept all upstream changes.

Do not automatically prefer Panacode changes during conflicts.

Review conflicts based on actual behavior and source contracts.

Prefer regular merges for shared long-lived branches so the relationship with upstream is traceable.

Use rebase only where appropriate for unpublished or disposable branches.

Never force-push shared or protected branches as a routine update mechanism.

---

# 5. REQUIRED DOCUMENTATION — `panacode-docs`

Create this folder at the root of the repository:

```text
panacode-docs/
```

Inside it, create the following mandatory Markdown document:

```text
panacode-docs/UPSTREAM-MERGE.md
```

**This document is mandatory.**

It must be sufficiently detailed that a future developer or AI coding agent can safely update Panacode from a newer OpenCode version without requiring access to the original implementation conversation.

Do not write a vague or generic maintenance document.

It must describe the actual architecture and changes implemented in this repository.

## Required sections of `UPSTREAM-MERGE.md`

### A. Repository identity

Document:

- Original upstream repository URL
- Panacode fork URL, if available
- Current upstream default or selected integration branch
- Panacode's stable branch
- Baseline upstream commit SHA
- Date of the recorded baseline
- Current Panacode commit SHA
- Relevant dependency and toolchain versions

Use real values from Git whenever available.

Never invent repository URLs or commit SHAs.

### B. Panacode customization architecture

Explain how the UI customization is organized.

Include:

- Location of the Panacode design system
- Component directories
- Theme and token configuration
- Adaptation layers
- Integration points
- Application shell changes
- Desktop branding changes
- Preserved upstream packages

Explain how upstream OpenCode services connect to the Panacode UI.

### C. Changed-file ownership matrix

Maintain a table with at least:

| File or directory | Owner | Reason | Upstream conflict risk | Merge guidance |
|---|---|---|---|---|

Classify files as:

- Upstream-owned
- Panacode-owned
- Shared integration boundary
- Generated output
- External reference material

Do not automatically treat a file as Panacode-owned merely because it was modified by this project.

Record upstream files modified by Panacode and why those changes could not be isolated.

### D. Component replacement map

Document the actual mapping from OpenCode components to Panacode components.

For each migrated component include:

- Original file path
- New component path
- Adapter path, if applicable
- Functionality preserved
- External dependencies
- Relevant tests
- Important upstream contracts

This mapping is essential when future upstream updates modify the original implementation.

### E. Step-by-step upstream update procedure

Provide exact, copyable Git commands appropriate for the actual repository and branching strategy.

Include:

- Checking for a clean working tree
- Verifying remotes
- Fetching upstream
- Creating an integration branch
- Comparing upstream changes
- Identifying affected files
- Performing the merge
- Reviewing conflicts
- Running tests
- Completing the integration
- Updating the recorded baseline

Example command patterns may include:

```bash
git status
git remote -v
git fetch upstream
git log --oneline --left-right HEAD...upstream/<branch>
git diff --stat HEAD...upstream/<branch>
git switch -c integration/upstream-YYYYMMDD
git merge --no-ff upstream/<branch>
```

Replace placeholders with the actual verified branch names when documenting a concrete example.

Include instructions for reviewing changes before executing a merge.

### F. Conflict resolution playbook

Explain how to handle conflicts in:

- Application shell
- Shared UI components
- Session UI
- Composer
- Agent timeline
- Tool execution
- MCP settings
- Code review
- Desktop integration
- Package manifests
- Lockfiles
- Generated files

Explain when to retain Panacode presentation, when to incorporate new upstream functionality, and when an adapter must be updated.

**Never use a blanket rule such as "always keep ours" or "always accept theirs."**

The intended result is:

New upstream functionality + preserved Panacode visual identity.

### G. New upstream feature policy

Future OpenCode releases may introduce new screens, components, menus, settings, and controls.

These must not automatically introduce old OpenCode styling into Panacode.

Define a policy that requires new upstream UI surfaces to use the existing Panacode design system.

Where a new upstream feature has no matching Panacode component:

1. Preserve its functionality.
2. Identify the closest existing Panacode primitive.
3. Create a compatible Panacode presentation if necessary.
4. Integrate the new feature.
5. Add tests.
6. Update the component mapping.

Avoid copying an entire upstream UI into Panacode without adaptation.

### H. Regression testing checklist

Include specific verification instructions for:

- Desktop startup
- Session creation
- Streaming responses
- Composer
- Model selection
- Agent execution
- Tool calls
- Permissions
- MCP
- Code review
- File explorer
- Terminal
- Browser
- SSH and WSL where supported
- Settings persistence
- Light and dark themes
- Keyboard shortcuts
- Desktop packaging
- Application identity
- Updater behavior

Include the actual commands supported by the repository.

Document platform-specific verification requirements.

### I. Visual regression checklist

Include checks for:

- Panacode buttons
- Switches
- Inputs
- Dialogs
- Popovers
- Menus
- Tabs
- Sidebars
- Color tokens
- Typography
- Loading indicators
- Component animation
- Responsive behavior
- Light and dark modes

Require visual comparison when upstream changes affect relevant surfaces.

### J. Rollback and recovery

Provide safe instructions for:

- Aborting an unfinished merge
- Recovering from failed validation
- Returning to a known-good commit
- Reverting an already merged integration
- Preserving uncommitted work
- Restoring a previous desktop build
- Investigating a broken upstream integration

Prefer non-destructive recovery operations.

Explain when `git merge --abort` is appropriate and when a revert commit is safer.

Do not prescribe destructive resets as the default recovery method.

### K. Future AI agent instructions

Include a dedicated section addressed to future AI coding agents.

It must instruct them to:

- Read this document before modifying UI or merging upstream.
- Identify Panacode-owned code before editing shared files.
- Preserve the separation between application logic and presentation.
- Keep modifications to upstream-owned files minimal.
- Avoid duplicating UI primitives.
- Preserve the Panacode visual identity.
- Run functional and visual regression checks.
- Update the merge guide whenever integration boundaries change.

### L. Known risks and limitations

Document realistic maintenance risks.

Acknowledge that large upstream architectural changes can still cause merge conflicts.

Identify high-risk integration points and how to reduce their impact.

Do not claim that the architecture guarantees conflict-free updates.

---

# PHASE 1 — INTEGRATE THE EIGHT UI IMPLEMENTATIONS

# 6. Build the Panacode Design System

Inspect the eight supplied projects and extract their common design language.

Create canonical Panacode primitives for:

- Button
- Icon button
- Switch
- Checkbox
- Radio
- Text input
- Textarea
- Select
- Dropdown
- Dialog
- Popover
- Tooltip
- Tabs
- Cards
- Badges
- Progress indicators
- Loading indicators
- Toasts
- Search controls
- Scrollable areas

Use centralized tokens and reusable components.

Do not duplicate component definitions across features.

## Special rule: Canonical Switch

The provided MCP Servers implementation contains a custom animated Switch.

Use it as the main visual reference for all Panacode toggle switches.

Every application-controlled toggle throughout Panacode must use this design.

Preserve accessibility, focus handling, disabled state, and reduced-motion support.

Integrate it through the shared design system rather than modifying switches independently throughout the codebase.

Apply this same centralization principle to every other reusable primitive.

---

# 7. Feature Integration Mapping

Integrate the following implementations.

For every feature, retain the existing OpenCode functionality and replace its presentation using the supplied design.

## 7.1 AI Chat

Source: Extracted `ai-chat` project.

Targets:

```text
packages/app/src/session/
packages/app/src/session/timeline/
packages/session-ui/src/message/
packages/session-ui/src/timeline/
```

Use a Panacode chat adapter connected to real session state.

Preserve:

- Message history
- Streaming
- Markdown and code
- Reasoning where available
- Tool events
- Editing and retry
- Cancellation
- Scroll behavior
- Session restoration
- Errors and interrupted responses

Do not create a separate chat engine.

## 7.2 AI Composer

Source: Extracted `ai-composer` project.

Targets:

```text
packages/app/src/composer/
packages/app/src/providers/models/
```

Preserve:

- Prompt editing
- File attachments
- Mentions
- Slash commands
- Model selection
- Keyboard shortcuts
- Draft persistence
- Send and stop
- Existing submission lifecycle

Use the original application controllers.

## 7.3 Agent Run

Source: Extracted `agent-run` project.

Targets:

```text
packages/app/src/session/timeline/
packages/session-ui/src/timeline/
packages/session-ui/src/tools/
```

Connect the UI to real execution events.

Preserve progress, tool activity, status changes, errors, cancellation, and completion.

Do not use simulated execution state in production.

## 7.4 Agent Orchestrator

Source: Extracted `agent-orchestrator` project.

Targets:

```text
packages/app/src/session/
packages/session-ui/src/
```

Integrate the design with existing subagent and delegated-work functionality.

Use actual task relationships and statuses.

Do not invent unsupported agent orchestration features.

## 7.5 Agent Approvals

Source: Extracted `agent-approvals` project.

Targets:

```text
packages/app/src/session/requests/
packages/session-ui/src/
```

Preserve existing authorization semantics.

Keep approve, reject, permission scopes, pending requests, and errors operational.

Never weaken permissions to simplify the redesign.

## 7.6 Tool Call

Source: Extracted `tool-call` project.

Targets:

```text
packages/session-ui/src/tools/
packages/session-ui/src/components/
```

Preserve all supported tool types, arguments, output, errors, execution status, and disclosure behavior.

Do not lose important tool information.

## 7.7 Code Suggestion

Source: Extracted `code-suggestion` project.

Targets:

```text
packages/gui-plugins/src/review/
packages/session-ui/src/components/
packages/session-ui/src/v2/
```

Keep the existing diff engine and review logic.

Preserve syntax highlighting, file changes, comments, and supported review actions.

Use the new design as the presentation layer.

## 7.8 MCP Servers

Source: Extracted `mcp-servers` project.

Targets:

```text
packages/app/src/settings/
packages/app/src/providers/connect/
packages/gui-plugins/src/details/
```

Preserve existing MCP connections, authentication, tool discovery, configuration, and error handling.

Connect all controls to actual application state.

Do not introduce fake connection states.

---

# 8. PHASE 1 VERIFICATION

Before proceeding:

1. Verify all eight integrations.
2. Confirm real application state is used.
3. Confirm no demo-only logic remains in production.
4. Confirm shared primitives are centralized.
5. Confirm no new, unnecessary parallel architecture exists.
6. Run relevant tests.
7. Run typechecks.
8. Verify available builds.
9. Document integration points.
10. Update `panacode-docs/UPSTREAM-MERGE.md`.

Commit the changes in small, logical units.

Preserve a clear separation between Phase 1 and Phase 2.

---

# PHASE 2 — COMPLETE VISUAL MIGRATION

# 9. Objective

Redesign all remaining application-controlled UI surfaces to match the Panacode design system.

**No legacy OpenCode visual language should remain in the finished product.**

This does not mean replacing native operating system functionality or rewriting backend behavior.

It means every UI surface controlled by the application should follow the same visual design rules.

## 9.1 Application shell

Redesign:

- Window layout
- Title bar
- Sidebar
- Project navigation
- Session navigation
- Workspace navigation
- Tabs
- Split panels
- Resize handles
- Status indicators

## 9.2 Home and sessions

Redesign:

- Home screen
- Recent projects
- Session lists
- Project cards
- New session screen
- Search
- Empty states

## 9.3 Settings

Redesign:

- General settings
- Appearance
- Providers
- Models
- MCP
- Keybindings
- Notifications
- Workspaces
- Project settings
- Account-related surfaces
- About and update screens

Use canonical Panacode primitives throughout.

## 9.4 File and code

Redesign:

- File explorer
- File tree
- File search
- File tabs
- File previews
- Review controls
- Diff headers
- Code-related toolbars
- Comments

Keep existing file operations and diff logic.

## 9.5 Terminal

Redesign terminal tabs, toolbar, surrounding controls, status displays, borders, and empty states.

Preserve the actual terminal emulator, PTY, ANSI rendering, and keyboard behavior.

## 9.6 Browser and debugging

Redesign browser tabs, address bar, navigation controls, toolbars, status displays, debug panels, and errors.

Preserve browser functionality.

## 9.7 Connections

Redesign SSH, WSL, provider authentication, server management, pairing, and connection management interfaces.

## 9.8 Other interfaces

Include all remaining:

- Dialogs
- Buttons
- Switches
- Checkboxes
- Radio controls
- Inputs
- Dropdowns
- Tooltips
- Popovers
- Context menus
- Notifications
- Toasts
- Loading states
- Progress indicators
- Error states
- Scrollbars
- Onboarding screens
- Update dialogs
- Responsive layouts

Do not exclude small or rarely used controls.

---

# 10. PHASE 2 IMPLEMENTATION STRATEGY

Start with shared primitives.

When a common component is replaced at the shared UI layer, ensure the change propagates to all intended consumers.

Use dedicated Panacode components rather than independently restyling every occurrence.

When a new upstream UI feature appears in the future, it should be possible to style it through these shared components or a thin adapter.

For each migrated interface:

1. Identify the original implementation.
2. Identify the required Panacode design.
3. Select the smallest safe integration point.
4. Preserve the existing behavior.
5. Integrate the Panacode component.
6. Test interactions.
7. Check light and dark themes.
8. Confirm accessibility.
9. Record the change in the component mapping.
10. Update upstream maintenance documentation if required.

Do not remove old implementation files before confirming the new implementation works.

Avoid large, unverified rewrites.

---

# 11. AUTOMATED UPSTREAM SAFETY CHECKS

Where practical, introduce automated checks to detect future maintenance problems.

These may include:

- Missing Panacode component imports
- Broken adapter contracts
- Remaining legacy UI primitives
- Accidental duplicate Switch implementations
- Unexpected upstream branding in Panacode-controlled surfaces
- Incorrect package dependencies
- Unsupported cross-framework imports
- Broken theme tokens
- Desktop build regressions

Prefer meaningful static checks and regression tests over brittle tests that simply search for filenames.

Do not make the build fail on harmless upstream changes without providing an actionable explanation.

Add visual regression coverage for critical screens where the existing test infrastructure supports it.

Use baseline screenshots where practical.

Do not introduce a completely new test stack unnecessarily.

---

# 12. FUNCTIONAL REGRESSION REQUIREMENTS

Verify that the redesign does not break:

- Agent execution
- Message streaming
- Session creation
- Session restoration
- Model selection
- Tool execution
- Permissions
- MCP
- File operations
- Code review
- Terminal
- Browser
- SSH and WSL where supported
- Keyboard shortcuts
- Desktop navigation
- Settings persistence
- Theme switching
- Error recovery

Run package-specific tests according to the actual repository instructions.

Check desktop build and packaging where the available environment supports them.

Explicitly report anything that could not be tested.

---

# 13. FINAL UPSTREAM-SAFETY REVIEW

After completing both phases, perform a dedicated upstream-maintainability audit.

Review the entire diff against the recorded upstream baseline.

Identify:

- Upstream-owned files modified
- Panacode-only files added
- Original files copied unnecessarily
- Components that directly depend on upstream internals
- Large changes that can be reduced
- Duplicated domain state
- Styling overrides likely to break after upstream changes
- Integration points without tests
- Build and packaging risks

Refactor avoidable conflicts before final delivery.

Do not remove required functionality merely to reduce the number of changed files.

## Mandatory deliverable

The project must contain:

```text
panacode-docs/
└── UPSTREAM-MERGE.md
```

This file must explain the actual implemented structure and provide complete upstream merge guidance.

It must not contain only generic Git instructions.

A future developer should be able to read it and understand how to safely merge a newer OpenCode version into Panacode.

---

# 14. FINAL DELIVERABLES

Complete:

1. Panacode design system
2. Integration of all eight supplied UI implementations
3. Complete remaining interface redesign
4. Preserved existing application functionality
5. Upstream-friendly customization architecture
6. Appropriate tests and validation
7. Small, logical Git commits
8. `panacode-docs/UPSTREAM-MERGE.md`

You may create additional implementation records if they are useful, but `UPSTREAM-MERGE.md` must remain the authoritative upstream maintenance guide.

Update the repository's existing `decisions.md` or status tracking documents if its conventions require them.

---

# 15. SUCCESS CRITERIA

The task is complete when:

- All eight supplied component projects have been inspected and integrated appropriately.
- All production integrations use the existing application state and functionality.
- No standalone React demo application has been embedded as a substitute for native integration.
- The complete interface follows the Panacode visual design.
- Shared components have canonical implementations.
- The animated MCP Switch design is consistently used throughout the application.
- Original OpenCode visual styling has been removed from application-controlled surfaces.
- Existing functionality is preserved.
- Panacode customization is reasonably isolated from upstream code.
- Future upstream updates have a documented integration process.
- High-risk upstream integration points are identified and tested.
- The mandatory upstream merge guide exists and is complete.
- Tests and builds have been executed wherever the environment supports them.
- Any unverified requirements or remaining blockers are explicitly documented.

Do not claim that an update is guaranteed to merge without conflicts.

The objective is to minimize merge conflicts and make unavoidable conflicts understandable and manageable.

---

# 16. EXECUTION INSTRUCTIONS

This is a real implementation task, not a planning exercise.

Execute the work in this order:

1. Inspect the repository and record its actual upstream baseline.
2. Extract the supplied archive once and inspect the eight already-extracted projects.
3. Define the upstream-safe Panacode UI architecture.
4. Implement shared design tokens and components.
5. Complete Phase 1 integration.
6. Test and commit Phase 1.
7. Complete the Phase 2 interface migration.
8. Test and commit Phase 2.
9. Audit upstream compatibility and reduce unnecessary source modifications.
10. Create and complete `panacode-docs/UPSTREAM-MERGE.md`.
11. Perform final verification.
12. Report completed work, Git commits, tests, and remaining limitations.

Do not stop after generating a plan.

Do not silently skip a phase.

Do not make unrelated backend or business logic changes.

Do not destructively modify repository history.

Follow the existing repository development and testing conventions.

## Final principle

**Panacode must be visually independent from OpenCode, functionally compatible with OpenCode, and architecturally prepared to receive future OpenCode updates.**

Build it as a maintainable product, not a one-time visual fork.

Begin implementation now.