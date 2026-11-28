/** PanaAI workbench colours. The Firouzeh logo and its artwork have their own palette. */
const primary = {
  yellow: "#F6C34C",
  button: "#EFC15A", buttonText: "#241A07", buttonHover: "#F6CD6C", buttonBorder: "#F5CF75",
  buttonHoverBorder: "#FFE09A", buttonShadow: "inset 0 1px 0 #ffffff33",
}

const light = {
  ...primary,
  canvas: "#F5F3EE", panel: "#FFFDF8", input: "#FFFDF9", popover: "#FFFEFB", control: "#FAF6EE",
  text: "#29271F", secondary: "#4C463C", muted: "#6D665A",
  focus: "#59564F", accent: "#47453F", strong: "#29271F", soft: "#F6C34C20",
  selection: "#F6C34C64", selectedRow: "#F6C34C38", hover: "#F6C34C12",
  border: "#E2DCCF", hairline: "#E9E3D6", controlBorder: "#948A78",
  success: "#2B7045", successBg: "#E6F3E9", warning: "#845D1E", warningBg: "#FBEFD5", warningBorder: "#E5CD9B",
  error: "#B94335", errorBg: "#FCE9E5", info: "#315E87", infoBg: "#E4EDF6",
  syntaxConstant: "#067563", added: "#2B70451A", removed: "#B943351A",
}
const dark: typeof light = {
  ...primary,
  canvas: "#0B0E17", panel: "#17191F", input: "#14161D", popover: "#1B1D24", control: "#22242B",
  text: "#F3F2F5", secondary: "#D1CFD7", muted: "#A7A7B1",
  focus: primary.yellow, accent: "#F1C35B", strong: "#FFE3A2", soft: "#F6BD4010",
  selection: "#F1C35B30", selectedRow: "#F6BD4018", hover: "#FFFFFF06",
  border: "#FFFFFF18", hairline: "#FFFFFF12", controlBorder: "#727480",
  success: "#80E6A6", successBg: "#173525", warning: "#EAC675", warningBg: "#332B1B", warningBorder: "#655027",
  error: "#FF8B80", errorBg: "#472823", info: "#ADC9ED", infoBg: "#243043",
  syntaxConstant: "#62F0D8", added: "#80E6A620", removed: "#FF8B8020",
}

function variant(c: typeof light, grey: Record<string, string>) {
  return {
    grey,
    palette: {
      neutral: c.panel, ink: c.text, primary: c.text, interactive: c.focus,
      success: c.success, warning: c.warning, error: c.error, info: c.info,
      diffAdd: c.success, diffDelete: c.error,
    },
    overrides: {
      "background-base": c.canvas, "background-strong": c.panel,
      "text-strong": c.text, "text-base": c.secondary, "text-weak": c.muted, "text-weaker": c.muted,
      "icon-base": c.secondary, "icon-weak-base": c.muted, "icon-success-base": c.success,
      "input-base": c.input, "surface-base": c.panel, "surface-base-hover": c.hover,
      "surface-raised-base": c.popover, "surface-raised-base-hover": c.control,
      "border-weak-base": c.border, "border-weaker-base": c.hairline,
      "surface-interactive-weak": c.soft, "surface-success-base": c.successBg, "surface-critical-base": c.errorBg,
      "surface-diff-add-base": c.added, "surface-diff-delete-base": c.removed,
      "pana-row-selected": c.selectedRow, "pana-selection": c.selection,
      "pana-brand-yellow": c.yellow,
      "syntax-constant": c.syntaxConstant,
      "terminal-background": c.input, "terminal-selection": c.selection,
      "pana-button-text": c.buttonText, "pana-button-hover": c.buttonHover, "pana-button-border": c.buttonBorder,
      "pana-button-hover-border": c.buttonHoverBorder, "pana-button-shadow": c.buttonShadow,
    },
    v2Overrides: {
      "v2-background-bg-deep": c.canvas, "v2-background-bg-base": c.panel, "v2-background-bg-layer-01": c.input,
      "v2-background-bg-layer-02": c.popover, "v2-background-bg-layer-03": c.control,
      "v2-background-bg-button-neutral": c.control, "v2-background-bg-accent": c.button,
      "v2-background-bg-icon-button-contrast": c.button, "v2-icon-icon-inverse": c.buttonText, "v2-text-text-inverse": c.buttonText,
      "v2-text-text-base": c.text, "v2-text-text-muted": c.muted, "v2-text-text-faint": c.muted,
      "v2-text-text-accent": c.accent, "v2-text-text-accent-hover": c.strong,
      "v2-text-text-code-accent": c.info, "v2-text-text-code-path": c.info, "v2-background-bg-code-path": c.infoBg,
      "v2-icon-icon-base": c.secondary, "v2-icon-icon-muted": c.muted, "v2-icon-icon-faint": c.muted,
      "v2-icon-icon-accent": c.accent, "v2-icon-icon-accent-hover": c.strong,
      "v2-border-border-base": c.border, "v2-border-border-muted": c.hairline,
      "v2-border-border-strong": c.controlBorder, "v2-border-border-focus": c.focus,
      "v2-overlay-simple-overlay-hover": c.hover,
      "v2-state-fg-success": c.success, "v2-state-bg-success": c.successBg,
      "v2-state-fg-danger": c.error, "v2-state-bg-danger": c.errorBg,
      "v2-state-fg-warning": c.warning, "v2-state-bg-warning": c.warningBg, "v2-state-border-warning": c.warningBorder,
      "v2-state-fg-info": c.info, "v2-state-bg-info": c.infoBg,
    },
  }
}

export const pack = {
  id: "firouzeh", name: "Panacode", direction: "Firouzeh",
  tagline: "Pure signal. Zero noise.", publisher: "PanaAI",
  theme: {
    dark: variant(dark, {
      50: "#FFFFFF", 100: dark.text, 200: "#E2E0E7", 300: dark.secondary, 400: "#BBBAC4", 500: dark.muted,
      600: "#858590", 700: "#575966", 800: "#3A3D48", 900: dark.control, 1000: dark.popover, 1100: dark.panel, 1200: dark.canvas,
    }),
    light: variant(light, {
      50: light.popover, 100: light.panel, 200: light.canvas, 300: light.hairline, 400: light.border, 500: "#B9B1A3",
      600: "#8D8475", 700: light.muted, 800: light.secondary, 900: "#39362E", 1000: light.text, 1100: "#211F19", 1200: "#16140F",
    }),
  },
} as const
