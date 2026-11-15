// Side-effect import: prefer PANACODE_* over OPENCODE_* before other CLI modules read env.
import { syncProductEnv } from "@opencode/util/product-env"

syncProductEnv()
