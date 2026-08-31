import { ArrowClockwise, CheckCircle, PlugsConnected, XCircle } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "./feedback";
import { number } from "../lib/localization";
import { Button } from "./ui/button";

export type ConnectionTestReport = {
  ok: boolean;
  reply: string;
  provider: string;
  base_url: string;
  model: string;
  latency_ms: number;
  structured_output: boolean;
  capabilities: string[];
};

export type EmbeddingTestReport = { ok: boolean; dimensions: number; latency_ms: number; saved_settings_tested: boolean };

export function ConnectionTestDialog({ open, pending, report, embeddingReport, kind = "chat", error, model, onClose, onRetry }: {
  open: boolean; pending: boolean; report?: ConnectionTestReport; error?: string;
  kind?: "chat" | "embedding"; embeddingReport?: EmbeddingTestReport;
  model: string; onClose: () => void; onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!pending) return;
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);
  const embedding = kind === "embedding";
  const success = !pending && !error && (embedding ? embeddingReport?.ok && embeddingReport.dimensions > 0 : report?.ok && report.reply === "pong" && report.structured_output);
  const failed = !pending && !success;
  const Icon = pending ? PlugsConnected : success ? CheckCircle : XCircle;
  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-zinc-950/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-3"><Icon size={26} className={failed ? "shrink-0 text-red-700 dark:text-red-300" : "shrink-0 text-brand-700 dark:text-brand-300"} /><div><h2 id={titleId} className="text-lg font-semibold">{t("connectionCheck")}</h2><p id={descriptionId} className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t(embedding ? "embeddingTestDescription" : "pingDescription")}</p></div></div>
      <p className="mt-4 break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">{model}</p>
      {!embedding && <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"><span className="text-xs text-zinc-500 dark:text-zinc-400">{t("pingRequest")}</span><p className="mt-2 font-mono text-xl font-semibold">ping</p></div><div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950"><span className="text-xs text-zinc-500 dark:text-zinc-400">{t("pingResponse")}</span><p className="mt-2 font-mono text-xl font-semibold">{success ? "pong" : pending ? "…" : "—"}</p></div></div>}
      <div className="mt-4" role={failed ? "alert" : "status"} aria-live={failed ? "assertive" : "polite"}><p className={`text-sm font-semibold ${failed ? "text-red-700 dark:text-red-300" : "text-brand-800 dark:text-brand-200"}`}>{pending ? t(embedding ? "embeddingTesting" : "pingWaiting") : success ? embedding && embeddingReport ? t("embeddingTestPassed", { dimensions: number(embeddingReport.dimensions), ms: number(embeddingReport.latency_ms) }) : t("pingSuccess") : t("pingFailure")}</p>{pending && !embedding && <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t("pingWaitHelp")}</p>}{failed && <ErrorState message={error || t("requestFailed")} />}{success && embeddingReport && !embeddingReport.saved_settings_tested && <p className="mt-3 text-sm">{t("embeddingNotReady")}</p>}</div>
      {pending && <p className="mt-2 font-mono text-xs text-zinc-500" aria-live="off">{number(seconds, { style: "unit", unit: "second", unitDisplay: "short" })}</p>}
      {success && report && <dl className="mt-4 space-y-3 border-t border-zinc-200 pt-4 text-xs dark:border-zinc-700"><div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">{t("responseTime")}</dt><dd className="font-mono">{t("milliseconds", { value: report.latency_ms.toLocaleString(i18n.language) })}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">{t("capabilityCheck")}</dt><dd>{t("structuredVerified")}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500 dark:text-zinc-400">{t("endpoint")}</dt><dd className="min-w-0 break-all text-end font-mono">{report.base_url}</dd></div><div><dt className="sr-only">{t("vision")}</dt><dd className="text-zinc-500 dark:text-zinc-400">{report.capabilities.includes("vision") ? t("visionAvailable") : t("visionUnavailable")}</dd></div></dl>}
    </div>
    <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-700"><Button type="button" variant="secondary" onClick={onClose}>{t("close")}</Button>{!pending && <Button type="button" onClick={onRetry}><ArrowClockwise />{t(embedding ? "embeddingTestAgain" : "pingAgain")}</Button>}</footer>
  </dialog>;
}
