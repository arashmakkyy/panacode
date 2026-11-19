import { expect, test } from "bun:test"
import path from "node:path"
import { cliServiceRegistrationFile } from "./cli-service-file"

test.each([
  {
    version: "2.3.0",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-latest-202611150802",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    // panacode-windows workflow builds: OPENCODE_CHANNEL=prod with the run number. The CLI treats prod as a release
    // channel, so Desktop must poll service.json too (r9/r10 timed out polling the wrong file).
    version: "0.0.0-prod-3",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-prod-12.2",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service.json"),
  },
  {
    version: "0.0.0-feature-x-7",
    expected: path.join("/home/ali", ".local", "state", "panacode", "service-feature-x.json"),
  },
  {
    version: "0.0.0-cursor-panacode-install-isolate-58f9-202611150802",
    expected: path.join(
      "/home/ali",
      ".local",
      "state",
      "panacode",
      "service-cursor-panacode-install-isolate-58f9.json",
    ),
  },
])("cliServiceRegistrationFile for $version", ({ version, expected }) => {
  expect(
    cliServiceRegistrationFile({
      join: path.join,
      home: "/home/ali",
      cliVersion: version,
    }),
  ).toBe(expected)
})
