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
