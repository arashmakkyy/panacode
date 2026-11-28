/** Keep focus and text selection when copying on a plain HTTP origin or from a modal. */
export async function writeClipboard(text: string, native?: (text: string) => Promise<void>): Promise<boolean> {
  try {
    if (native) {
      await native(text)

      return true
    }
  } catch {
    /* Fall through to the browser. */
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)

      return true
    }
  } catch {
    /* Permission-denied origins may still allow a user-initiated copy. */
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const selection = document.getSelection()

  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : []

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.readOnly = true
  textarea.tabIndex = -1
  textarea.style.cssText = "position:fixed;inset:0 auto auto 0;opacity:0;pointer-events:none"
  ;(active?.parentElement ?? document.body).appendChild(textarea)

  try {
    textarea.select()

    return document.execCommand?.("copy") === true
  } catch {
    return false
  } finally {
    textarea.remove()
    active?.focus({ preventScroll: true })
    selection?.removeAllRanges()

    for (const range of ranges) selection?.addRange(range)
  }
}
