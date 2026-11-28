import { createUniqueId, onMount } from "solid-js"
import "./manual-copy.css"

export function ManualCopy(props: { text: string; label: string; close: string; onClose: () => void }) {
  let dialog!: HTMLDialogElement
  let field!: HTMLTextAreaElement
  const id = createUniqueId()
  onMount(() => {
    dialog.showModal()
    field.focus()
    field.select()
  })
  return (
    <dialog
      ref={dialog}
      class="pc-manual-copy"
      aria-labelledby={id}
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        event.preventDefault()
        dialog.close()
      }}
    >
      <label id={id} for={id + "-text"}>
        {props.label}
      </label>
      <textarea ref={field} id={id + "-text"} dir="auto" readOnly value={props.text} />
      <button type="button" onClick={() => dialog.close()}>
        {props.close}
      </button>
    </dialog>
  )
}
