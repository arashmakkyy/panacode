/** Splits a binding such as "Ctrl+Shift+L" (or "Ctrl++") into keys; several bindings are joined with ", ". */
export function shortcutParts(binding: string): string[][] {
  return binding
    .split(/,\s+/)
    .filter(Boolean)
    .map((chord) => {
      const keys: string[] = []
      let current = ""
      for (const ch of chord) {
        if (ch === "+" && current) {
          keys.push(current)
          current = ""
          continue
        }
        current += ch
      }
      if (current) keys.push(current)
      return keys
    })
}
