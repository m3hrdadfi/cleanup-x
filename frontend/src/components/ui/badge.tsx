import { cn } from "../../lib/utils";

export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger"; className?: string }) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    success: "bg-brand-100 text-brand-900 dark:bg-brand-950 dark:text-brand-200",
    warning: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200",
    danger: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  };
  return <span className={cn("inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold leading-none tracking-[-0.01em]", tones[tone], className)}>{children}</span>;
}
