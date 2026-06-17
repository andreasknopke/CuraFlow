import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * A container that provides an always-visible horizontal scrollbar
 * at the bottom, reusing the existing Radix ScrollBar component.
 *
 * The native horizontal scrollbar is hidden via CSS internally.
 * The container fills its parent (`max-h-full`) so that the
 * horizontal scrollbar sticks to the visible bottom edge.
 * Overflow content scrolls vertically within the container.
 *
 * Props:
 *   className  — additional classes for the Root container
 *   children   — scrollable content
 */
const StickyHorizontalScrollbar = React.forwardRef(
  ({ className, children, ...props }, ref) => {
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        type="always"
        className={cn("relative overflow-hidden max-h-full", className)}
        {...props}
      >
        {/* Viewport — handles both horizontal and vertical scrolling */}
        <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
          {children}
        </ScrollAreaPrimitive.Viewport>

        {/* Horizontal scrollbar — always visible via type="always" */}
        <ScrollBar
          orientation="horizontal"
          className="sticky bottom-0 z-10"
        />

        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    );
  }
);
StickyHorizontalScrollbar.displayName = "StickyHorizontalScrollbar";

export { StickyHorizontalScrollbar };
