import { useQuery } from "@tanstack/react-query";
import { ArrowsClockwise, Check, Circle, PlugsConnected, Scan, Trash, Warning } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { eventLabel, entityLabel, number } from "../lib/localization";
import { api } from "../lib/api";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";

type Event = { id: string; created_at: string; event_type: string; entity_type: string; entity_id?: string; details: Record<string, unknown> };

function eventStyle(type: string) {
  if (type.includes("unresolved") || type.includes("rate_limit")) return { Icon: Warning, tone: "warning" as const, dot: "bg-amber-500", icon: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" };
  if (type.includes("failed") || type.includes("error")) return { Icon: Warning, tone: "danger" as const, dot: "bg-red-600", icon: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" };
  if (type.includes("deletion")) return { Icon: type.includes("completed") || type.includes("deleted") ? Check : Trash, tone: "success" as const, dot: "bg-brand-600", icon: "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200" };
  if (type.includes("scan")) return { Icon: Scan, tone: "neutral" as const, dot: "bg-brand-400", icon: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" };
  if (type.includes("connect") || type.includes("auth")) return { Icon: PlugsConnected, tone: "neutral" as const, dot: "bg-zinc-500", icon: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" };
  return { Icon: ArrowsClockwise, tone: "neutral" as const, dot: "bg-zinc-400", icon: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200" };
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: Event[] }>("/api/audit?limit=250") });
  const count = query.data?.items.length || 0;
  return <>
    <PageHeader title={t("auditTitle")} description={t("auditBody")} action={count ? <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900"><span className="relative flex size-2"><span className="absolute inline-flex size-full rounded-full bg-brand-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-brand-600" /></span><span className="font-mono tabular-nums">{number(count)}</span> {t("events")}</div> : undefined} />
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState message={(query.error as Error).message} /> : !count ? <EmptyState title={t("noData")} /> : <section className="audit-shell overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200/70 px-5 py-4 dark:border-white/8 md:px-7"><div><h2 className="text-sm font-semibold">{t("recentActivity")}</h2><p className="mt-0.5 text-xs text-zinc-500">{t("recentActivityBody")}</p></div><Circle size={10} weight="fill" className="text-brand-600" /></div>
      <ol className="audit-timeline px-4 py-3 md:px-7 md:py-5">{query.data!.items.map((event) => {
        const visual = eventStyle(event.event_type); const Icon = visual.Icon; const date = new Date(event.created_at);
        return <li key={event.id} className="audit-event group relative grid grid-cols-[40px_1fr] gap-3 py-3 lg:grid-cols-[48px_140px_minmax(0,1fr)_auto] md:items-center md:gap-4">
          <div className="relative z-10 flex size-10 items-center justify-center rounded-xl ring-4 ring-white dark:ring-zinc-900" aria-hidden><span className={cn("absolute inset-0 rounded-xl", visual.icon)} /><Icon className="relative" size={18} weight="duotone" /></div>
          <time className="col-start-2 row-start-1 font-mono text-[11px] tabular-nums text-zinc-500 lg:col-start-2">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(date)}</time>
          <div className="col-start-2 min-w-0 lg:col-start-3"><p className="break-words text-[13px] font-medium capitalize">{eventLabel(event.event_type)}<span className="sr-only" dir="ltr"> ({event.event_type})</span></p><p className="mt-1 truncate font-mono text-[11px] text-zinc-500" title={event.entity_id || JSON.stringify(event.details)}>{event.entity_id || JSON.stringify(event.details)}</p></div>
          <Badge tone={visual.tone} className="col-start-2 mt-1 w-fit lg:col-start-4 md:mt-0">{entityLabel(event.entity_type)}</Badge>
        </li>;
      })}</ol>
    </section>}
  </>;
}
