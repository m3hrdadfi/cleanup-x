import * as React from "react";
import i18n from "../../i18n";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onInvalid, onInput, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-500 hover:border-zinc-400 focus-visible:border-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-400 dark:focus-visible:ring-brand-600",
        className,
      )}
      {...props}
      onInvalid={(event) => { event.currentTarget.setCustomValidity(i18n.t("invalidRequest")); onInvalid?.(event); }}
      onInput={(event) => { event.currentTarget.setCustomValidity(""); onInput?.(event); }}
    />
  ),
);
Input.displayName = "Input";
