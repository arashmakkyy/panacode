import { appendFileSync, writeFileSync } from "node:fs"

// A fixture-owned process used to prove that uninstall never signals or stops a process that
// merely appears in a registration file it does not own.
const heartbeat = process.argv[2]
if (heartbeat === undefined) throw new Error("Missing witness heartbeat path")
writeFileSync(heartbeat, "")
setInterval(() => appendFileSync(heartbeat, Date.now() + "\n"), 25)