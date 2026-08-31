import * as React from "react";
import i18n from "../../i18n";
import { cn } from "../../lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, onInvalid, onInput, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-400",
        className,
      )}
      {...props}
      onInvalid={(event) => { event.currentTarget.setCustomValidity(i18n.t("invalidRequest")); onInvalid?.(event); }}
      onInput={(event) => { event.currentTarget.setCustomValidity(""); onInput?.(event); }}
    />
  ),
);
Textarea.displayName = "Textarea";
