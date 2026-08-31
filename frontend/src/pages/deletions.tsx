import { ArrowRight, ClockCounterClockwise } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { statusLabel, number, currency } from "../lib/localization";
import { api } from "../lib/api";

type Job = {
  id: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  retryable: number;
  estimated_cost_usd: number;
  created_at: string;
  updated_at: string;
};

type Response = { items: Job[]; total: number; page: number; page_size: number };

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (["cancelled", "failed"].includes(status)) return "danger";
  if (["rate_limited", "paused", "reauth_required"].includes(status)) return "warning";
  return "neutral";
}

export function DeletionsPage() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["deletions", page],
    queryFn: () => api<Response>(`/api/deletion-jobs?page=${page}&page_size=25`),
  });

  return <>
    <PageHeader title={t("deletionHistory")} description={t("deletionHistoryBody")} />
    {query.isLoading ? <LoadingState label={t("loading")} /> : query.error ? <ErrorState message={(query.error as Error).message} /> : !query.data?.items.length ? <EmptyState title={t("noDeletionJobs")} body={t("noDeletionJobsBody")} /> : <>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {query.data.items.map((job) => <article key={job.id} className="session-row">
            <div>
              <time className="text-sm font-medium">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(job.created_at))}</time>
              <p className="mt-1 font-mono text-[11px] text-zinc-500">{job.id.slice(0, 13)}…</p>
            </div>
            <div className="session-metrics">
              <div><p className="font-mono text-base font-semibold">{number(job.processed)}/{number(job.total)}</p><p className="text-xs text-zinc-500">{t("processed")}</p></div>
              <div><p className="font-mono text-base font-semibold">{number(job.succeeded)}</p><p className="text-xs text-zinc-500">{t("succeeded")}</p></div>
              <div><p className="font-mono text-base font-semibold">{number(job.retryable)}</p><p className="text-xs text-zinc-500">{t("remaining")}</p></div>
              <div><p className="font-mono text-base font-semibold">{currency(job.estimated_cost_usd)}</p><p className="text-xs text-zinc-500">{t("costEstimate")}</p></div>
            </div>
            <div className="session-actions">
              <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
              <Button asChild variant="secondary" size="sm"><Link to={`/deletions/${job.id}`}>{t("view")}<ArrowRight className="rtl:rotate-180" /></Link></Button>
            </div>
          </article>)}
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Button variant="secondary" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button>
        <span className="flex items-center gap-2 text-xs text-zinc-500"><ClockCounterClockwise />{t("jobCount", { value: number(query.data.total) })}</span>
        <Button variant="secondary" disabled={page * query.data.page_size >= query.data.total} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button>
      </div>
    </>}
  </>;
}
