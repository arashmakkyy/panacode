/**
 * Canonical Panacode switch. Visual source: Arc MCP Servers switch
 * (42×24 track, 18px thumb, critical spring glide, press stretch, scaleX bounce).
 * Kobalte owns the checkbox semantics; this module owns the motion.
 */
import { Control, Description, ErrorMessage, Input, Label, Root, Thumb } from "@kobalte/core/switch"
import { createEffect, onCleanup, onMount, Show, splitProps, type ComponentProps, type ParentProps } from "solid-js"
import { criticalOmega, stepSpring } from "../motion/spring"
import { prefersReducedMotion } from "../motion/reduced"
import { switchMotion } from "../motion"
import "./switch.css"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Root>> {
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "classList",
    "hideLabel",
    "description",
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
  ])
  const reduced = prefersReducedMotion()
  let root!: HTMLElement
  let releasedAt = -Infinity
  let pressed = false

  const initialOn = () => local.checked ?? local.defaultChecked ?? false

  onMount(() => {
    const thumb = () => root.querySelector<HTMLElement>("[data-slot='switch-thumb']")
    const omega = criticalOmega(switchMotion.glide.visualDuration)
    const widthOmega = criticalOmega(switchMotion.snappy.visualDuration)
    const readOn = () => root.dataset.checked !== undefined
    let x: number = initialOn() ? switchMotion.travel : 0
    let v = 0
    let width: number = switchMotion.size
    let widthV = 0
    let scale = 1
    let bounceStart = 0
    let bouncing = false
    let previous = readOn()
    let frame = 0

    const paint = () => {
      const node = thumb()

      if (!node) return
      const direction = document.documentElement.dir === "rtl" ? -1 : 1
      node.style.transform = `translateX(${direction * x}px) scaleX(${scale})`
      node.style.width = `${width}px`
    }

    const tick = (now: number) => {
      const dt = 1 / 60
      const on = readOn()
      const stretch = pressed && !reduced() && !local.disabled ? switchMotion.stretch : 0
      const targetX = on ? switchMotion.travel - stretch : 0
      const targetW = switchMotion.size + stretch

      if (on !== previous) {
        const fromPress = now - releasedAt < switchMotion.pressReleaseMs

        if (!reduced() && !fromPress) {
          bouncing = true
          bounceStart = now
        }

        previous = on
      }

      if (reduced()) {
        x = targetX
        v = 0
        width = targetW
        widthV = 0
        scale = 1
        bouncing = false
      } else {
        const nextX = stepSpring({ x, v, target: targetX }, omega, dt)
        x = nextX.x
        v = nextX.v
        const nextW = stepSpring({ x: width, v: widthV, target: targetW }, widthOmega, dt)
        width = nextW.x
        widthV = nextW.v

        if (bouncing) {
          const t = Math.min(1, (now - bounceStart) / switchMotion.bounceMs)
          scale =
            t < 0.4
              ? 1 + ((switchMotion.bounceScale - 1) * t) / 0.4
              : switchMotion.bounceScale + (1 - switchMotion.bounceScale) * ((t - 0.4) / 0.6)

          if (t >= 1) {
            scale = 1
            bouncing = false
          }
        } else scale = 1
      }

      paint()
      const done =
        Math.abs(x - targetX) < 0.05 &&
        Math.abs(v) < 0.05 &&
        Math.abs(width - targetW) < 0.05 &&
        !bouncing &&
        !pressed

      frame = done ? 0 : requestAnimationFrame(tick)
    }

    const kick = () => {
      if (frame) return
      frame = requestAnimationFrame(tick)
    }

    const press = (down: boolean) => {
      if (down) pressed = true
      else {
        if (pressed && !local.disabled) releasedAt = performance.now()
        pressed = false
      }

      kick()
    }

    root.addEventListener("pointerdown", (event) => {
      if (event.button === 0) press(true)
    })
    root.addEventListener("pointerup", () => press(false))
    root.addEventListener("pointerleave", () => press(false))
    root.addEventListener("pointercancel", () => press(false))
    root.addEventListener("keydown", (event) => {
      if (event.key === " ") press(true)
    })
    root.addEventListener("keyup", (event) => {
      if (event.key === " ") press(false)
    })
    root.addEventListener("blur", () => press(false))

    createEffect(() => {
      local.checked
      local.disabled
      reduced()
      kick()
    })

    const observer = new MutationObserver(kick)
    observer.observe(root, { attributes: true, attributeFilter: ["data-checked"] })
    kick()
    onCleanup(() => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    })
  })

  return (
    <Root
      {...others}
      ref={root}
      checked={local.checked}
      defaultChecked={local.defaultChecked}
      disabled={local.disabled}
      onChange={local.onChange}
      data-component="panacode-switch"
      data-panacode-primitive="switch"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Input data-slot="switch-input" />
      <Show when={local.children}>
        {(label) => (
          <Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        <Description data-slot="switch-description">{local.description}</Description>
      </Show>
      <Control data-slot="switch-control">
        <Thumb
          data-slot="switch-thumb"
          style={{
            width: `${switchMotion.size}px`,
            transform: `translateX(${initialOn() ? switchMotion.travel : 0}px)`,
          }}
        />
      </Control>
      <ErrorMessage data-slot="switch-error" />
    </Root>
  )
}
