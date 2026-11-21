// Side-effect import: strip inherited upstream OpenCode runtime overrides before any other CLI
// module reads the environment. Panacode reads PANACODE_* only.
import { sanitizeProductEnv } from "@opencode/util/product-env"

sanitizeProductEnv()