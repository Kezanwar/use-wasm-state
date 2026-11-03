import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "cn";

function TooltipProvider({
  delayDuration = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // No animate-in / fade-in-0 here: those come from tw-animate-css,
          // which this demo does not install, so they would do nothing.
          "bg-foreground text-background z-50 w-fit max-w-[16rem] rounded-md px-2.5 py-1.5 text-xs text-balance shadow-md",
          className
        )}
        {...props}
      >
        {children}
        {/* Radix renders the arrow as an <svg>, so it takes a fill, not a
            background. It has to match the bubble. */}
        <TooltipPrimitive.Arrow width={11} height={5} className="fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
