/** Parse an argv field without invoking a shell. Preserve Windows path separators and quoted empty arguments. */
export function parseMcpCommand(value: string): string[] | undefined {
  const args: string[] = []
  let quote = ""
  let word = ""
  let started = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    const next = value[i + 1]
    if (char === "\\" && next && (next === quote || (!quote && /[\s'"]/.test(next)))) {
      word += next
      i++
    } else if (quote) {
      if (char === quote) quote = ""
      else word += char
    } else if (char === "'" || char === '"') quote = char
    else if (/\s/.test(char)) {
      if (started) args.push(word)
      word = ""
      started = false
      continue
    } else word += char
    started = true
  }
  if (quote || value.includes("\0")) return
  if (started) args.push(word)
  if (!args[0] || /^https?:\/\//i.test(args[0])) return
  return args
}
