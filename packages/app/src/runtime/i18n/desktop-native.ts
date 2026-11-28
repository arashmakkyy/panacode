import { flow, Option, Schema } from "effect"

/** Panacode uses one application language across the renderer and the native menu. */
export const DESKTOP_NATIVE_LOCALES = ["en"] as const

export type DesktopNativeLocale = (typeof DESKTOP_NATIVE_LOCALES)[number]

export const DESKTOP_NATIVE_LABELS = { en: "English" } as const

export const DESKTOP_NATIVE_LOCALE_TAGS = { en: "en" } as const

export function detectDesktopNativeLocale(_languages: readonly string[]): DesktopNativeLocale {
  return "en"
}

export const DESKTOP_NATIVE_ENGLISH = {
  "desktop.microphoneUsage": "Panacode uses your microphone for voice calls.",
  "desktop.documentsFolderUsage":
    "Panacode uses files in your Documents folder for projects you open and commands you run there.",
  "desktop.desktopFolderUsage": "Panacode uses files on your Desktop for projects you open and commands you run there.",
  "desktop.downloadsFolderUsage":
    "Panacode uses files in your Downloads folder for projects you open and commands you run there.",
  "desktop.networkVolumesUsage":
    "Panacode uses files on network volumes for projects you open and commands you run there.",
  "desktop.removableVolumesUsage":
    "Panacode uses files on removable volumes for projects you open and commands you run there.",
  "desktop.menu.app": "Panacode",
  "desktop.menu.file": "File",
  "desktop.menu.edit": "Edit",
  "desktop.menu.view": "View",
  "desktop.menu.go": "Go",
  "desktop.menu.window": "Window",
  "desktop.menu.help": "Help",
  "desktop.menu.installCli": "Install CLI…",
  "desktop.menu.settings": "Settings",
  "desktop.menu.reloadWebview": "Reload Webview",
  "desktop.menu.restart": "Restart",
  "desktop.menu.exportLogs": "Export Logs…",
  "desktop.menu.newSession": "New Session",
  "desktop.menu.openProject": "Open Project…",
  "desktop.menu.newWindow": "New Window",
  "desktop.menu.closeWindow": "Close Window",
  "desktop.menu.undo": "Undo",
  "desktop.menu.redo": "Redo",
  "desktop.menu.cut": "Cut",
  "desktop.menu.copy": "Copy",
  "desktop.menu.paste": "Paste",
  "desktop.menu.delete": "Delete",
  "desktop.menu.selectAll": "Select All",
  "desktop.menu.toggleSidebar": "Toggle Sidebar",
  "desktop.menu.toggleTerminal": "Toggle Terminal",
  "desktop.menu.toggleFileTree": "Toggle File Tree",
  "desktop.menu.reload": "Reload",
  "desktop.menu.toggleDeveloperTools": "Toggle Developer Tools",
  "desktop.menu.actualSize": "Actual Size",
  "desktop.menu.zoomIn": "Zoom In",
  "desktop.menu.zoomOut": "Zoom Out",
  "desktop.menu.toggleFullScreen": "Toggle Full Screen",
  "desktop.menu.back": "Back",
  "desktop.menu.forward": "Forward",
  "desktop.menu.previousSession": "Previous Session",
  "desktop.menu.nextSession": "Next Session",
  "desktop.menu.previousProject": "Previous Project",
  "desktop.menu.nextProject": "Next Project",
  "desktop.menu.minimize": "Minimize",
  "desktop.menu.maximize": "Maximize",
  "desktop.menu.documentation": "Panacode Documentation",
  "desktop.menu.supportForum": "Support Forum",
  "desktop.menu.shareFeedback": "Share Feedback",
  "desktop.menu.reportBug": "Report a Bug",
  "desktop.menu.ariaLabel": "Panacode menu",

  "desktop.cli.installed.title": "CLI Installed",
  "desktop.cli.installed.message": "CLI installed to {{path}}\n\nRestart your terminal to use the 'panacode' command.",
  "desktop.cli.failed.title": "Installation Failed",
  "desktop.cli.failed.message": "Failed to install CLI: {{error}}",

  "desktop.recovery.action.relaunch": "Relaunch",
  "desktop.recovery.action.exportLogs": "Export Logs",
  "desktop.recovery.action.keepWaiting": "Keep Waiting",
  "desktop.recovery.action.quit": "Quit",
  "desktop.recovery.loadFailed": "Panacode failed to load",
  "desktop.recovery.terminated": "Panacode window terminated unexpectedly",
  "desktop.recovery.unresponsive": "Panacode is not responding",
  "desktop.recovery.unresponsive.detail": "You can relaunch the app, open the logs, or keep waiting.",
  "desktop.recovery.loadFailed.detail": "Window: {{window}}\nURL: {{url}}\nError: {{code}} {{description}}",
  "desktop.recovery.terminated.detail": "Window: {{window}}\nReason: {{reason}}\nCode: {{code}}",
  "desktop.recovery.unknown": "<unknown>",

  "desktop.dialog.chooseFolder": "Choose a folder",
  "desktop.dialog.chooseFile": "Choose a file",
  "desktop.dialog.saveFile": "Save file",
  "desktop.dialog.files": "Files",
  "desktop.onboarding.defaultProject": "Default Project",

  "desktop.picker.error.notSelected": "File was not selected by the picker",
  "desktop.picker.error.sizeLimit": "Selected attachments exceed the {{limit}} MB limit",

  "desktop.contextMenu.spellcheck": "Spellcheck",
  "desktop.contextMenu.spellcheckLanguages": "Spellcheck Languages",
} as const

export type DesktopNativeKey = keyof typeof DESKTOP_NATIVE_ENGLISH

export type DesktopNativeMessages = Record<DesktopNativeKey, string>

export type DesktopNativeBundle = { locale: DesktopNativeLocale; messages: DesktopNativeMessages }

// SAFETY: DESKTOP_NATIVE_ENGLISH is a const literal, so its own keys are exactly DesktopNativeKey.
export const DESKTOP_NATIVE_KEYS = Object.keys(DESKTOP_NATIVE_ENGLISH) as DesktopNativeKey[]

export const DESKTOP_NATIVE_MAX_PAYLOAD_BYTES = 64 * 1024

export function createDesktopNativeBundle(
  locale: DesktopNativeLocale,
  translate: (key: DesktopNativeKey) => string,
): DesktopNativeBundle {
  return {
    locale,
    // SAFETY: the entries map every DesktopNativeKey to a string, which is exactly DesktopNativeMessages.
    messages: Object.fromEntries(DESKTOP_NATIVE_KEYS.map((key) => [key, translate(key)])) as DesktopNativeMessages,
  }
}

const DesktopNativeBundleSchema = Schema.Struct({
  locale: Schema.Literals(DESKTOP_NATIVE_LOCALES),
  messages: Schema.Record(Schema.Literals(DESKTOP_NATIVE_KEYS), Schema.String),
}).check(
  Schema.makeFilter(
    (bundle) => new TextEncoder().encode(JSON.stringify(bundle)).byteLength <= DESKTOP_NATIVE_MAX_PAYLOAD_BYTES,
  ),
)

const decodeDesktopNativeBundle = Schema.decodeUnknownOption(DesktopNativeBundleSchema, { onExcessProperty: "error" })

/** Validates a bundle the renderer sent over IPC: a supported locale, exactly the native keys, and a bounded size. */
export const parseDesktopNativeBundle = flow(decodeDesktopNativeBundle, Option.getOrUndefined)

export function formatDesktopNativeMessage(message: string, params?: Record<string, string | number>) {
  if (!params) return message

  return message.replace(/\{\{([^{}]+)\}\}/g, (match, key: string) => {
    const value = params[key]

    return value === undefined ? match : String(value)
  })
}
