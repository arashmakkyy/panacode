import { writeFileSync } from "node:fs"

// A replacement service that must never start when the client refuses to replace an
// unidentified or unowned registration.
const marker = process.argv[2]
if (marker === undefined) throw new Error("Missing marker path")
writeFileSync(marker, "")
process.exit(0)