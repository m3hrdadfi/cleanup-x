import { WarningCircle, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { errorLabel } from "../lib/localization";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-zinc-600 dark:text-zinc-300"><SpinnerGap size={18} aria-hidden />{label || t("loading")}</div>;
}

export function ErrorState({ message }: { message: string }) {
  const { t, i18n } = useTranslation();
  const summary = errorLabel(message);
  return <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"><WarningCircle size={20} weight="fill" aria-hidden /><div className="min-w-0"><p>{summary}</p>{summary !== message && <details className="mt-2 text-xs"><summary className="cursor-pointer">{t("technicalDetails")}</summary><pre dir="auto" className="mt-2 whitespace-pre-wrap break-words font-mono" lang={i18n.language === "en" ? "en" : undefined}>{message}</pre></details>}</div></div>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700"><p className="font-semibold">{title}</p>{body && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>}</div>;
}
