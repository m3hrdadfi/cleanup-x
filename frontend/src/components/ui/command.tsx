import { MagnifyingGlass } from "@phosphor-icons/react";
import { Command as CommandPrimitive } from "cmdk";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";

export const Command = forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive ref={ref} className={cn("flex w-full flex-col overflow-hidden", className)} {...props} />
));
Command.displayName = CommandPrimitive.displayName;

export const CommandInput = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700">
    <MagnifyingGlass className="shrink-0 text-zinc-500" size={17} aria-hidden />
    <CommandPrimitive.Input
      ref={ref}
      className={cn("h-10 w-full bg-transparent text-sm outline-none placeholder:text-zinc-500", className)}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List ref={ref} className={cn("max-h-72 overflow-y-auto overscroll-contain p-1", className)} {...props} />
));
CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty ref={ref} className={cn("px-3 py-8 text-center text-sm text-zinc-500", className)} {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandItem = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-brand-100 data-[selected=true]:text-brand-950 data-[disabled=true]:opacity-50 dark:data-[selected=true]:bg-brand-950 dark:data-[selected=true]:text-brand-100",
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;
