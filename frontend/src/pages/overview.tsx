import { Archive, ArrowRight, CalendarDots, ChartLineUp, Image, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Panel } from "../components/ui/panel";
import { ArchiveTimeline } from "../components/archive-timeline";
import { number, percentage, languageName, contentTypeLabel } from "../lib/localization";
import { api } from "../lib/api";

type Count = { key: string; count: number };
type Overview = {
  summary: { total: number; remaining: number; deleted: number; first_post?: string; last_post?: string; span_days: number; active_days: number; average_per_active_day: number; average_characters: number; media_posts: number };
  coverage: { archive_only: number; archive_and_api: number };
  content_types: Count[];
  languages: Count[];
  timeline: { month: string; count: number }[];
  years: { year: string; count: number }[];
  weekdays: { day: string; count: number }[];
  hours: { hour: number; count: number }[];
  top_dates: { date: string; count: number }[];
  hashtags: { name: string; count: number }[];
  mentions: { name: string; count: number }[];
  latest_scan?: { id: string; prompt: string; threshold: number; classified: number; selected: number; selection_rate: number; failed: number; confidence: Count[]; topics: Count[] };
  cleanup: { deletion_jobs: number; unresolved_reposts: number };
};

const typeColors: Record<string, string> = { post: "#612d53", reply: "#a75d8d", quote: "#66798d", repost: "#b6a4b1" };




function Bars({ values, total, label }: { values: Count[]; total: number; label: (key: string) => string }) {
  const { i18n } = useTranslation();
  return <div className="mt-5 space-y-3">{values.map((item) => <div key={item.key}><div className="mb-1.5 flex items-start justify-between gap-2 text-xs"><span className="min-w-0 break-words font-medium">{label(item.key)}</span><span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">{item.count.toLocaleString(i18n.language)} · {percentage(total ? item.count / total : 0)}</span></div><div className="h-1.5 overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-sm bg-brand-700 dark:bg-brand-400" style={{ width: `${total ? Math.min(100, item.count / total * 100) : 0}%` }} /></div></div>)}</div>;
}

export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/api/overview") });
  if (query.isLoading) return <LoadingState label={t("loadingArchiveOverview")} />;
  if (query.error || !query.data) return <ErrorState message={(query.error as Error)?.message || t("error")} />;
  const data = query.data; const total = data.summary.total;
  if (!total) return <><PageHeader title={t("overviewTitle")} description={t("overviewBody")} /><EmptyState title={t("noArchiveOverview")} body={t("noArchiveOverviewBody")} /></>;
  const years = data.summary.first_post && data.summary.last_post ? Math.max(1, new Date(data.summary.last_post).getUTCFullYear() - new Date(data.summary.first_post).getUTCFullYear() + 1) : 0;
  const firstYear = data.summary.first_post ? new Date(data.summary.first_post).getUTCFullYear() : "—"; const lastYear = data.summary.last_post ? new Date(data.summary.last_post).getUTCFullYear() : "—";
  const peakWeekday = data.weekdays.reduce((best, item) => item.count > best.count ? item : best, { day: "", count: 0 });
  const peakHour = data.hours.reduce((best, item) => item.count > best.count ? item : best, { hour: 0, count: 0 });
  const weekdayIndex = data.weekdays.findIndex((item) => item.day === peakWeekday.day);
  const localWeekday = !peakWeekday.count ? "—" : new Intl.DateTimeFormat(i18n.language, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + weekdayIndex)));
  const maxWeekday = Math.max(...data.weekdays.map((item) => item.count), 1); const maxHour = Math.max(...data.hours.map((item) => item.count), 1);
  
  return <>
    <PageHeader title={t("overviewTitle")} description={t("overviewBody")} action={<div className="flex gap-2"><Button asChild variant="secondary" size="sm"><Link to="/inventory"><Archive />{t("inventory")}</Link></Button><Button asChild size="sm"><Link to="/scans/new"><MagnifyingGlass />{t("newScan")}</Link></Button></div>} />

    <section className="metric-strip gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
      {[{ label: t("archivePosts"), value: total.toLocaleString(i18n.language), detail: t("archiveOnlyCount", { value: number(data.coverage.archive_only) }), icon: Archive }, { label: t("historySpan"), value: number(years, { style: "unit", unit: "year", unitDisplay: "long" }), detail: `${typeof firstYear === "number" ? number(firstYear, { useGrouping: false }) : firstYear}–${typeof lastYear === "number" ? number(lastYear, { useGrouping: false }) : lastYear}`, icon: CalendarDots }, { label: t("stillInInventory"), value: data.summary.remaining.toLocaleString(i18n.language), detail: t("deletedCount", { value: number(data.summary.deleted) }), icon: ChartLineUp }, { label: t("postsWithMedia"), value: data.summary.media_posts.toLocaleString(i18n.language), detail: t("inventoryPercent", { value: percentage(data.summary.media_posts / total) }), icon: Image }].map(({ label, value, detail, icon: Icon }) => <div key={label} className="bg-white p-5 dark:bg-zinc-900"><div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-500">{label}</span><Icon className="text-brand-700 dark:text-brand-400" size={16} weight="regular" /></div><p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-zinc-500">{detail}</p></div>)}
    </section>

    <div className="overview-primary mt-4">
      <Panel><ArchiveTimeline values={data.timeline} /></Panel>
      <Panel><h2 className="chart-title">{t("postingFingerprint")}</h2><p className="chart-description">{t("postingFingerprintBody")}</p><div className="mt-5 divide-y divide-zinc-200 dark:divide-zinc-800">{[[t("mostActiveWeekday"), localWeekday], [t("peakHourUtc"), peakHour.count ? `${String(peakHour.hour).padStart(2, "0")}:00` : "—"], [t("averageActiveDay"), number(data.summary.average_per_active_day, { minimumFractionDigits: 1, maximumFractionDigits: 1 })], [t("averagePostLength"), t("characterCount", { value: number(Math.round(data.summary.average_characters)) })]].map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 py-3"><span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span><strong className="font-mono text-sm">{value}</strong></div>)}</div><p className="mt-4 border-s-2 border-brand-200 ps-3 text-xs leading-5 text-zinc-500 dark:border-brand-700 dark:text-zinc-400">{t("localCoverageNote")}</p></Panel>
    </div>

    <div className="overview-secondary mt-4">
      <Panel><h2 className="chart-title">{t("contentMix")}</h2><div className="mt-5 flex h-4 gap-0.5 overflow-hidden rounded-sm" aria-hidden>{data.content_types.map((item) => <div key={item.key} style={{ flex: item.count, backgroundColor: typeColors[item.key] || "#71717a" }} />)}</div><dl className="mt-5 space-y-3">{data.content_types.map((item) => <div key={item.key} className="flex items-center justify-between gap-2 text-xs"><dt className="flex items-center gap-2"><i className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: typeColors[item.key] }} />{contentTypeLabel(item.key)}</dt><dd className="font-mono">{item.count.toLocaleString(i18n.language)} <span className="ms-2 inline-block w-9 text-end text-zinc-500 dark:text-zinc-400">{percentage(total ? item.count / total : 0)}</span></dd></div>)}</dl></Panel>
      <Panel><h2 className="chart-title">{t("languageMix")}</h2><p className="chart-description">{t("languageMixBody")}</p><Bars values={data.languages} total={total} label={languageName} /></Panel>
      <Panel><h2 className="chart-title">{t("activityRhythm")}</h2><p className="chart-description">{t("utcNote")}</p><div dir="ltr" className="mt-5 flex h-24 items-end gap-2">{data.weekdays.map((item, index) => <div key={item.day} className="flex flex-1 flex-col items-center justify-end gap-2"><span className="font-mono text-[10px] text-zinc-500">{number(item.count)}</span><div className="w-full rounded-t bg-brand-700 dark:bg-brand-500" style={{ height: `${(item.count / maxWeekday) * 64}px` }} title={`${number(item.count)}`} /><span className="text-[10px] text-zinc-500">{new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + index)))}</span></div>)}</div><div className="mt-5 space-y-2" dir="ltr">{[0, 12].map((start) => <div key={start} className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2"><span className="font-mono text-[9px] text-zinc-500">{String(start).padStart(2, "0")}:00</span><div className="grid grid-cols-12 gap-1">{Array.from({ length: 12 }, (_, index) => { const hour = start + index, count = data.hours.find((item) => item.hour === hour)?.count || 0; return <div key={hour} tabIndex={0} aria-label={t("hourlyPosts", { hour: number(hour) + ":00", value: number(count) })} title={t("hourlyPosts", { hour: number(hour) + ":00", value: number(count) })} className="group relative h-5 rounded-sm bg-zinc-100 dark:bg-zinc-800"><div className="absolute inset-0 rounded-sm bg-brand-700 dark:bg-brand-400" style={{ opacity: count ? .18 + count / maxHour * .82 : 0 }} /><span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] text-white group-hover:block group-focus:block dark:bg-zinc-100 dark:text-zinc-900">{hour}:00 · {number(count)}</span></div>; })}</div><span className="font-mono text-[9px] text-zinc-500">{start + 11}:00</span></div>)}</div></Panel>
    </div>

    <div className="overview-bottom mt-4">
      <Panel><h2 className="chart-title">{t("recurringSignals")}</h2><div className="mt-4 grid grid-cols-2 gap-5">{[{ title: t("hashtags"), prefix: "#", items: data.hashtags }, { title: t("mentions"), prefix: "@", items: data.mentions }].map(({ title, prefix, items }) => <div key={title} className="min-w-0"><h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</h3><ol className="mt-3 space-y-3">{items.map((item) => <li key={item.name} className="flex items-baseline justify-between gap-2 text-xs"><span dir="auto" className="min-w-0 truncate" title={prefix + item.name}>{prefix}{item.name}</span><span className="shrink-0 font-mono text-zinc-500 dark:text-zinc-400">{number(item.count)}</span></li>)}</ol>{!items.length && <p className="mt-3 text-xs text-zinc-500">{t("noneDetected")}</p>}</div>)}</div></Panel>
      <Panel>{data.latest_scan ? <><div className="flex items-start justify-between gap-4"><div><h2 className="chart-title">{t("latestScanInsight")}</h2><p className="mt-1 line-clamp-2 text-sm text-zinc-500">“{data.latest_scan.prompt}”</p></div><Button asChild variant="secondary" size="sm"><Link to={`/scans/${data.latest_scan.id}`}>{t("view")}<ArrowRight className="rtl:rotate-180" /></Link></Button></div><div className="mt-4 grid gap-4"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-zinc-100 py-3 dark:border-zinc-800"><p className="font-mono text-2xl font-semibold text-brand-800 dark:text-brand-300">{percentage(data.latest_scan.classified ? data.latest_scan.selected / data.latest_scan.classified : 0)}</p><p className="text-xs text-zinc-500 dark:text-zinc-400">{t("selectedSummary", { selected: number(data.latest_scan.selected), total: number(data.latest_scan.classified) })}</p></div><Bars values={data.latest_scan.confidence} total={data.latest_scan.classified} label={(key) => t(`confidence_${key}`)} /></div>{data.latest_scan.topics.length > 0 && <div className="mt-6 flex flex-wrap gap-2">{data.latest_scan.topics.map((topic) => <Badge key={topic.key}>{topic.key} · {number(topic.count)}</Badge>)}</div>}</> : <EmptyState title={t("noCompletedScan")} body={t("noCompletedScanBody")} />}</Panel>
    </div>

    <Panel className="mt-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="flex items-center gap-2 chart-title"><Trash className="text-brand-700 dark:text-brand-400" />{t("cleanupSnapshot")}</h2><p className="mt-2 text-sm text-zinc-500">{t("cleanupSnapshotBody")}</p><div className="mt-4 flex flex-wrap gap-2"><Badge tone="success">{t("deletedCount", { value: number(data.summary.deleted) })}</Badge><Badge tone={data.cleanup.unresolved_reposts ? "warning" : "success"}>{t("unresolved")}: {number(data.cleanup.unresolved_reposts)}</Badge><Badge>{t("jobCount", { value: number(data.cleanup.deletion_jobs) })}</Badge></div></div><Button asChild variant="secondary"><Link to="/deletions">{t("deletionHistory")}<ArrowRight className="rtl:rotate-180" /></Link></Button></div></Panel>
  </>;
}
