import { dict } from "./en"

// Provider-defined actions and effort levels may not have a label in the app dictionary.
export function hasAppLabel<Key extends string>(key: Key): key is Key & keyof typeof dict {
  return Object.hasOwn(dict, key)
}
