import { expect, test } from "bun:test"
import { cleanShellConfig, shellPathCommands } from "../src/services/shell-config"

const bin = "/home/ali/.panacode/bin"
const commands = shellPathCommands({ bin, fish: false })
const fishCommands = shellPathCommands({ bin, fish: true })
const block = (command: string, eol = "\n") => `${eol}# >>> panacode >>>${eol}${command}${eol}# <<< panacode <<<${eol}`

test.each([
  {
    name: "managed block",
    input: `before\n${block(`export PATH="${bin}:$PATH"`)}after\n`,
    expected: "before\nafter\n",
  },
  {
    name: "managed block at the end without a final newline",
    input: `before\n# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n# <<< panacode <<<`,
    expected: "before",
  },
  {
    name: "managed block after a terminated line",
    input: `before\n\n# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n# <<< panacode <<<`,
    expected: "before\n",
  },
  {
    name: "legacy exact pair",
    input: `before\n\n# panacode\nexport PATH=${bin}:$PATH\nafter\n`,
    expected: "before\nafter\n",
  },
  {
    name: "legacy exact pair at the end without a final newline",
    input: `before\n# panacode\nexport PATH=${bin}:$PATH`,
    expected: "before",
  },
  {
    name: "legacy pair after a terminated line",
    input: `before\n\n# panacode\nexport PATH=${bin}:$PATH`,
    expected: "before\n",
  },
  {
    name: "standalone OpenCode PATH line",
    input: `export PATH=/home/ali/.opencode/bin:$PATH\n${block(`export PATH="${bin}:$PATH"`)}`,
    expected: "export PATH=/home/ali/.opencode/bin:$PATH\n",
  },
  {
    name: "combined Panacode and OpenCode PATH line",
    input: `export PATH=${bin}:/home/ali/.opencode/bin:$PATH\n${block(`export PATH="${bin}:$PATH"`)}`,
    expected: `export PATH=${bin}:/home/ali/.opencode/bin:$PATH\n`,
  },
  {
    name: "custom line after a Panacode comment",
    input: `# panacode\nexport PATH=/home/ali/.opencode/bin:$PATH\n`,
    expected: `# panacode\nexport PATH=/home/ali/.opencode/bin:$PATH\n`,
  },
  {
    name: "duplicate Panacode comment",
    input: `# panacode\n# panacode\nexport PATH=${bin}:$PATH\nafter\n`,
    expected: "# panacode\nafter\n",
  },
  {
    name: "edited block with an extra line",
    input: `# >>> panacode >>>\nexport PATH="${bin}:$PATH"\nexport FOO=1\n# <<< panacode <<<\n`,
    expected: `# >>> panacode >>>\nexport PATH="${bin}:$PATH"\nexport FOO=1\n# <<< panacode <<<\n`,
  },
  {
    name: "edited block command",
    input: `# >>> panacode >>>\nexport PATH=/custom/bin:$PATH\n# <<< panacode <<<\n`,
    expected: `# >>> panacode >>>\nexport PATH=/custom/bin:$PATH\n# <<< panacode <<<\n`,
  },
  {
    name: "lone begin marker",
    input: `# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n`,
    expected: `# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n`,
  },
  {
    name: "lone end marker",
    input: `export PATH="${bin}:$PATH"\n# <<< panacode <<<\n`,
    expected: `export PATH="${bin}:$PATH"\n# <<< panacode <<<\n`,
  },
  {
    name: "empty block",
    input: `# >>> panacode >>>\n# <<< panacode <<<\n`,
    expected: `# >>> panacode >>>\n# <<< panacode <<<\n`,
  },
  {
    name: "bare owned command without a marker",
    input: `export PATH=${bin}:$PATH\n# panacode\n`,
    expected: `export PATH=${bin}:$PATH\n# panacode\n`,
  },
  {
    name: "third-party PATH line",
    input: `export PATH=/opt/homebrew/bin:$PATH\n${block(`export PATH="${bin}:$PATH"`)}`,
    expected: "export PATH=/opt/homebrew/bin:$PATH\n",
  },
  {
    name: "similar directory from another install",
    input: `export PATH=/opt/panacode/bin:$PATH\n`,
    expected: `export PATH=/opt/panacode/bin:$PATH\n`,
  },
  {
    name: "marker text inside a larger comment",
    input: `# note: # >>> panacode >>>\nexport PATH="${bin}:$PATH"\n`,
    expected: `# note: # >>> panacode >>>\nexport PATH="${bin}:$PATH"\n`,
  },
  {
    name: "CRLF block",
    input: `before\r\n\r\n# >>> panacode >>>\r\nexport PATH="${bin}:$PATH"\r\n# <<< panacode <<<\r\nafter\r\n`,
    expected: "before\r\nafter\r\n",
  },
  {
    name: "mixed line endings",
    input: `before\n\n# >>> panacode >>>\r\nexport PATH="${bin}:$PATH"\r\n# <<< panacode <<<\r\nafter\n`,
    expected: "before\nafter\n",
  },
  {
    name: "BOM",
    input: `\uFEFFbefore\n\n# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n# <<< panacode <<<\nafter\n`,
    expected: "\uFEFFbefore\nafter\n",
  },
  {
    name: "block at the start followed by content without a final newline",
    input: `# >>> panacode >>>\nexport PATH="${bin}:$PATH"\n# <<< panacode <<<\nafter`,
    expected: "after",
  },
  {
    name: "multiple owned fragments",
    input: `one\n\n# panacode\nexport PATH=${bin}:$PATH\ntwo\n${block(`export PATH="${bin}:$PATH"`)}three\n`,
    expected: "one\ntwo\nthree\n",
  },
] as const)("cleanShellConfig: $name", ({ input, expected }) => {
  const cleaned = cleanShellConfig(input, commands)

  expect(cleaned).toBe(expected)
  expect(cleanShellConfig(cleaned, commands)).toBe(cleaned)
})

test.each([
  {
    name: "quoted fish block",
    input: `before\n${block(`fish_add_path "${bin}"`)}after\n`,
    expected: "before\nafter\n",
  },
  {
    name: "legacy fish pair",
    input: `before\n# panacode\nfish_add_path ${bin}\nafter\n`,
    expected: "before\nafter\n",
  },
  {
    name: "standalone fish path",
    input: `fish_add_path /home/ali/.opencode/bin\n`,
    expected: `fish_add_path /home/ali/.opencode/bin\n`,
  },
] as const)("cleanShellConfig fish: $name", ({ input, expected }) => {
  expect(cleanShellConfig(input, fishCommands)).toBe(expected)
})

test("removes the MSYS form of a Windows binary directory", () => {
  const windows = shellPathCommands({ bin: "C:\\Users\\A B\\.panacode\\bin", fish: false })
  const input = `before\n\n# >>> panacode >>>\nexport PATH="/c/Users/A B/.panacode/bin:$PATH"\n# <<< panacode <<<\nafter\n`

  expect(windows).toContain('export PATH="/c/Users/A B/.panacode/bin:$PATH"')
  expect(cleanShellConfig(input, windows)).toBe("before\nafter\n")
})

test("leaves a Windows native path of another binary alone", () => {
  const windows = shellPathCommands({ bin: "C:\\Users\\A B\\.panacode\\bin", fish: false })
  const input = `export PATH="C:\\Users\\A B\\.opencode\\bin:$PATH"\n`

  expect(cleanShellConfig(input, windows)).toBe(input)
})
