import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as Radix from "@radix-ui/react-popover";
import styles from "./popover.module.css";

export const Popover = Radix.Root;
export const PopoverClose = Radix.Close;

export const PopoverTrigger = forwardRef<ElementRef<typeof Radix.Trigger>, ComponentPropsWithoutRef<typeof Radix.Trigger>>(
  function PopoverTrigger({ className, ...props }, ref) {
    return <Radix.Trigger {...props} ref={ref} className={[styles.anchor, className].filter(Boolean).join(" ")} />;
  },
);

export const PopoverContent = forwardRef<ElementRef<typeof Radix.Content>, ComponentPropsWithoutRef<typeof Radix.Content>>(
  function PopoverContent({ className, align = "start", sideOffset = 6, collisionPadding = 10, ...props }, ref) {
    return (
      <Radix.Portal>
        <Radix.Content
          {...props}
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={[styles.content, className].filter(Boolean).join(" ")}
        />
      </Radix.Portal>
    );
  },
);
