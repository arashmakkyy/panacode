import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly PANACODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __OPENCODE__?: {
      deepLinks?: string[]
    }
  }
}
