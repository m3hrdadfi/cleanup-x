import { ArrowLeft, ArrowRight, CaretDown, CaretUp, ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { statusLabel, contentTypeLabel, languageName, number, percentage } from "../lib/localization";
import { api } from "../lib/api";
import { RemoveInventoryButton } from "../components/remove-inventory-button";

type Classification = { matches: boolean; confidence: number; detected_language: string; reason_en: string; selected: boolean; status: string };
type Scan = { id: string; prompt: string; status: string; processed: number; total: number; created_at: string; policy: { target_topic: string }; counts?: { matches: number; selected: number; failed: number } };
type Post = { id: string; text: string; source_text?: string; language?: string; posted_at?: string; content_type: string; from_api: boolean; from_archive: boolean; classification?: Classification | null };
type PostResponse = { items: Post[]; total: number; page: number; page_size: number; coverage: Record<string, number>; complete_history: boolean; scan?: Scan | null };
type ScanResponse = { items: Scan[]; total: number; page: number; page_size: number };

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (["cancelled", "failed"].includes(status)) return "danger";
  if (["pending", "running"].includes(status)) return "warning";
  return "neutral";
}

function PostRow({ post, locale, scanId, removalDisabled, onRemoved }: { post: Post; locale: string; scanId?: string; removalDisabled?: boolean; onRemoved: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const content = post.source_text || post.text;
  const result = post.classification;
  return <article className={`inventory-post ${expanded ? "bg-brand-50/70 dark:bg-brand-950/30" : ""}`}>
    <div><time className="text-sm font-medium">{post.posted_at ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(post.posted_at)) : "—"}</time><p className="mt-1 font-mono text-[10px] text-zinc-500">{post.id.slice(0, 16)}{post.id.length > 16 ? "…" : ""}</p></div>
    <div className="min-w-0"><p dir="auto" className={`${expanded ? "whitespace-pre-wrap" : "line-clamp-2"} break-words text-sm leading-6`}>{content}</p>{expanded && result?.reason_en && <div className="mt-4 border-s-2 border-brand-300 ps-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">{t("reason")}</p><p dir="auto" className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{result.reason_en}</p></div>}</div>
    <div className="grid grid-cols-2 gap-x-4 gap-y-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t("type")}</p><Badge className="mt-1">{contentTypeLabel(post.content_type)}</Badge></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t("language")}</p><p className="mt-1 font-mono text-xs font-semibold">{post.language ? languageName(post.language) : "—"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t("origin")}</p><div className="mt-1 flex gap-1">{post.from_api && <Badge tone="success">API</Badge>}{post.from_archive && <Badge>ZIP</Badge>}</div></div><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t("scanResult")}</p>{result ? <div className="mt-1 flex flex-wrap items-center gap-1"><Badge tone={result.status === "failed" ? "danger" : result.matches ? "success" : "neutral"}>{result.status === "failed" ? t("failed") : result.matches ? t("match") : t("notMatch")}</Badge><span className="font-mono text-[10px] text-zinc-500">{percentage(result.confidence)}</span></div> : <span className="mt-1 block text-xs text-zinc-400">—</span>}</div></div>
    <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">{result?.selected && <Badge tone="success">{t("selected")}</Badge>}<Button type="button" variant="secondary" size="sm" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? t("close") : t("view")}{expanded ? <CaretUp /> : <CaretDown />}</Button>{scanId && <RemoveInventoryButton compact scanId={scanId} postId={post.id} label={content} disabled={removalDisabled} onRemoved={onRemoved} />}</div>
  </article>;
}

function InventorySessions() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [removed, setRemoved] = useState(false);
  const query = useQuery({ queryKey: ["scans", page], queryFn: () => api<ScanResponse>(`/api/scans?page=${page}&page_size=25`), refetchInterval: (result) => result.state.data?.items.some((scan) => ["pending", "running"].includes(scan.status)) ? 1500 : false });
  return <><PageHeader title={t("inventoryTitle")} description={t("inventorySessionsBody")} action={<Button asChild variant="secondary" size="sm"><Link to="/inventory/all">{t("browseAllPosts")}</Link></Button>} />
    {removed && <p role="status" className="mb-4 text-sm text-brand-800 dark:text-brand-200">{t("inventoryRemoved")}</p>}
    {query.isLoading ? <LoadingState label={t("loading")} /> : query.error ? <ErrorState message={(query.error as Error).message} /> : !query.data?.items.length ? <EmptyState title={t("noScans")} body={t("noScansBody")} /> : <>
      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"><div className="divide-y divide-zinc-200 dark:divide-zinc-800">{query.data.items.map((scan) => <article key={scan.id} className="session-row">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><time className="text-xs text-zinc-500">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(scan.created_at))}</time><Badge tone={statusTone(scan.status)}>{statusLabel(scan.status)}</Badge></div><h2 className="mt-2 truncate text-sm font-semibold" title={scan.prompt}>{scan.prompt}</h2><p className="mt-1 truncate font-mono text-[10px] text-zinc-500" title={scan.id}>{scan.id}</p></div>
        <div className="session-metrics"><div><p className="font-mono text-base font-semibold">{number(scan.processed)}/{number(scan.total)}</p><p className="text-xs text-zinc-500">{t("processed")}</p></div><div><p className="font-mono text-base font-semibold text-brand-800 dark:text-brand-200">{number(scan.counts?.matches || 0)}</p><p className="text-xs text-zinc-500">{t("matches")}</p></div><div><p className="font-mono text-base font-semibold">{number(scan.counts?.selected || 0)}</p><p className="text-xs text-zinc-500">{t("selected")}</p></div><div><p className="font-mono text-base font-semibold">{number(scan.counts?.failed || 0)}</p><p className="text-xs text-zinc-500">{t("failed")}</p></div></div>
        <div className="session-actions"><Button asChild variant="secondary" size="sm"><Link to={`/inventory/${scan.id}`}>{t("view")}<ArrowRight className="rtl:rotate-180" /></Link></Button><RemoveInventoryButton compact scanId={scan.id} label={scan.prompt} disabled={["pending", "running"].includes(scan.status)} onRemoved={() => { setPage(1); setRemoved(true); }} /></div>
      </article>)}</div></section>
      <div className="mt-5 flex items-center justify-between"><Button variant="secondary" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button><span className="flex items-center gap-2 text-xs text-zinc-500"><ClockCounterClockwise />{t("sessionCount", { value: number(query.data.total) })}</span><Button variant="secondary" disabled={page * query.data.page_size >= query.data.total} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button></div>
    </>}
  </>;
}

function InventoryDetail({ scanId }: { scanId: string }) {
  const { t, i18n } = useTranslation();
  const allPosts = scanId === "all";
  const [removed, setRemoved] = useState(false);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [type, setType] = useState(""); const [scanResult, setScanResult] = useState("");
  const queryPath = `/api/posts?page=${page}&page_size=50&search=${encodeURIComponent(search)}&content_type=${type}${allPosts ? "" : `&scan_id=${encodeURIComponent(scanId)}${scanResult ? `&scan_result=${scanResult}` : ""}`}`;
  const query = useQuery({ queryKey: ["posts", page, search, type, scanId, scanResult], queryFn: () => api<PostResponse>(queryPath), refetchInterval: (result) => ["pending", "running"].includes(result.state.data?.scan?.status || "") ? 1500 : false });
  const scan = query.data?.scan;
  return <><PageHeader title={allPosts ? t("allImportedPosts") : scan?.policy.target_topic || t("inventorySession")} description={allPosts ? t("allImportedPostsBody") : scan?.prompt || t("loading")} action={<div className="flex items-center gap-2">{scan && <Badge tone={statusTone(scan.status)}>{statusLabel(scan.status)}</Badge>}<Button asChild variant="secondary" size="sm"><Link to="/inventory"><ArrowLeft className="rtl:rotate-180" />{t("backToInventory")}</Link></Button></div>} />
    {query.error && <ErrorState message={(query.error as Error).message} />}
    {removed && <p role="status" className="mb-4 text-sm text-brand-800 dark:text-brand-200">{t("inventoryRemoved")}</p>}
    {!allPosts && scan && !query.error && <section className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{t("reviewDeletion")}</h2><p className="mt-1 max-w-[70ch] text-xs leading-5 text-zinc-500 dark:text-zinc-400">{scan.status === "completed" ? t("inventoryDeletionHelp") : t("inventoryDeletionWaiting")}</p></div>
      {scan.status === "completed" ? <Button asChild><Link to={`/scans/${encodeURIComponent(scan.id)}?review=deletion`}><Trash size={16} />{t("reviewDeletion")}<ArrowRight className="rtl:rotate-180" size={16} /></Link></Button> : <Button disabled><Trash size={16} />{t("reviewDeletion")}</Button>}
    </section>}
    {scan && <section className="mb-5 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/75 p-4 dark:border-brand-900 dark:bg-brand-950/40 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-brand-950 dark:text-brand-100">{t("showingScan", { prompt: scan.prompt })}</p><span className="font-mono text-xs text-brand-700 dark:text-brand-300">{t("processedSummary", { processed: number(scan.processed), total: number(scan.total) })}</span></section>}
    {allPosts && query.data && <><div className="mb-6 grid gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-2 xl:grid-cols-4">{[[t("apiRecords"), query.data.coverage.live_api], [t("archiveRecords"), query.data.coverage.archive], [t("archiveOnly"), query.data.coverage.archive_only], [t("unresolved"), query.data.coverage.unresolved_reposts]].map(([label, value]) => <div key={String(label)} className="bg-white p-4 dark:bg-zinc-900"><div className="font-mono text-2xl font-semibold">{typeof value === "number" ? number(value) : value}</div><div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{label}</div></div>)}</div><div className={`mb-5 rounded-xl border p-3 text-sm ${query.data.complete_history ? "border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-100" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>{query.data.complete_history ? t("complete") : t("incomplete")}</div></>}
    <div className={`inventory-filters mb-4 ${allPosts ? "" : "has-scan"}`}><Input aria-label={t("search")} placeholder={t("search")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><select aria-label={t("type")} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">{t("all")}</option><option value="post">{t("posts")}</option><option value="reply">{t("replies")}</option><option value="quote">{t("quotes")}</option><option value="repost">{t("reposts")}</option></select>{!allPosts && <select aria-label={t("scanResult")} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={scanResult} onChange={(event) => { setScanResult(event.target.value); setPage(1); }}><option value="">{t("allResults")}</option><option value="match">{t("matches")}</option><option value="non_match">{t("nonMatches")}</option><option value="selected">{t("selected")}</option><option value="failed">{t("failed")}</option></select>}</div>
    {query.isLoading ? <LoadingState label={t("loading")} /> : !query.data?.items.length ? <EmptyState title={t("noData")} body={allPosts ? t("noImportedPostsBody") : t("noScanItemsBody")} /> : <section aria-label={t("inventoryItems")} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"><div className="divide-y divide-zinc-200 dark:divide-zinc-800">{query.data.items.map((post) => <PostRow key={post.id} post={post} locale={i18n.language} scanId={allPosts ? undefined : scanId} removalDisabled={!scan || ["pending", "running"].includes(scan.status)} onRemoved={() => { setPage(1); setRemoved(true); }} />)}</div></section>}
    {query.data && <div className="mt-4 flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400"><span>{t("recordCount", { value: number(query.data.total) })}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("previous")}</Button><Button variant="secondary" size="sm" disabled={page * query.data.page_size >= query.data.total} onClick={() => setPage(page + 1)}>{t("next")}</Button></div></div>}
  </>;
}

export function InventoryPage() {
  const { scanId } = useParams();
  const [params] = useSearchParams();
  const legacyScanId = params.get("scan_id");
  if (!scanId && legacyScanId) return <Navigate replace to={`/inventory/${legacyScanId}`} />;
  return scanId ? <InventoryDetail key={scanId} scanId={scanId} /> : <InventorySessions />;
}
