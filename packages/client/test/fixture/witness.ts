import { appendFileSync, writeFileSync } from "node:fs"

// A fixture-owned process used to prove that service lifecycle operations never stop a process
// that merely appears in a registration file. It keeps writing a heartbeat so the test can
// observe that it was alive across the whole operation.
const heartbeat = process.argv[2]
if (heartbeat === undefined) throw new Error("Missing witness heartbeat path")
writeFileSync(heartbeat, "")
setInterval(() => appendFileSync(heartbeat, Date.now() + "\n"), 25)