import { setIconArtwork } from "@opencode/ui/icons/catalog"
import { lucideArtwork, lucideViewBox } from "./lucide-artwork"

/**
 * Arc draws lucide at stroke 1.75. Importing this module swaps OpenCode's icon artwork for lucide
 * under the same names, so `<Icon name="…">` call sites do not change.
 * Regenerate with `bun script/panacode-icons-generate.ts`.
 */
setIconArtwork(lucideArtwork, lucideViewBox)

export { lucideArtwork, lucideViewBox }
