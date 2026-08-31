import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Panel } from "../components/ui/panel";
import { statusLabel, contentTypeLabel, languageName, number, percentage } from "../lib/localization";
import { api, postJson } from "../lib/api";

type Scan = { id: string; prompt: string; status: string; processed: number; total: number; threshold: number; max_posts: number; error?: string; policy: { target_topic: string }; counts: { selected?: number; matches?: number; non_matches?: number; failed?: number } };
type Result = { post_id: string; text: string; content_type: string; matches: boolean; confidence: number; detected_language: string; reason_en: string; reason_fa: string; selected: boolean; status: string };

export function ScanDetailPage() {
  const [searchParams] = useSearchParams();
  const deletionReview = useRef<HTMLElement>(null);
  const { id = "" } = useParams(); const { t } = useTranslation(); const navigate = useNavigate(); const qc = useQueryClient(); const [confirm, setConfirm] = useState("");
  const scan = useQuery({ queryKey: ["scan", id], queryFn: () => api<Scan>(`/api/scans/${id}`), refetchInterval: (q) => ["completed", "failed"].includes(q.state.data?.status || "") ? false : 1200 });
  const results = useQuery({ queryKey: ["scan-results", id], queryFn: () => api<{ items: Result[]; total: number }>(`/api/scans/${id}/results?page_size=200`), enabled: Boolean(scan.data), refetchInterval: scan.data?.status === "completed" ? false : 1600 });
  useEffect(() => {
    if (searchParams.get("review") !== "deletion" || !scan.data?.id || !deletionReview.current) return;
    deletionReview.current.focus({ preventScroll: true });
    deletionReview.current.scrollIntoView({ block: "start", behavior: "auto" });
  }, [searchParams, scan.data?.id]);
  useEffect(() => {
    if (!id || ["completed", "failed", "cancelled"].includes(scan.data?.status || "")) return;
    const events = new EventSource(`/api/jobs/${id}/events`);
    events.addEventListener("progress", () => {
      qc.invalidateQueries({ queryKey: ["scan", id] });
      qc.invalidateQueries({ queryKey: ["scan-results", id] });
    });
    events.onerror = () => events.close();
    return () => events.close();
  }, [id, qc, scan.data?.status]);
  const selection = useMutation({ mutationFn: (row: Result) => postJson(`/api/scans/${id}/selection`, { post_ids: [row.post_id], selected: !row.selected }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["scan", id] }); qc.invalidateQueries({ queryKey: ["scan-results", id] }); } });
  const deletion = useMutation({ mutationFn: () => postJson<{ id: string }>("/api/deletion-jobs", { scan_id: id, confirmation_count: Number(confirm) }, true), onSuccess: (data) => navigate(`/deletions/${data.id}`) });
  const cancelScan = useMutation({ mutationFn: () => postJson(`/api/scans/${id}/cancel`, {}), onSuccess: () => { qc.invalidateQueries({ queryKey: ["scan", id] }); qc.invalidateQueries({ queryKey: ["scans"] }); } });
  if (scan.isLoading) return <LoadingState label={t("loading")} />;
  if (scan.error || !scan.data) return <ErrorState message={(scan.error as Error)?.message || t("scanNotFound")} />;
  const selected = scan.data.counts.selected || 0; const matches = scan.data.counts.matches || 0; const nonMatches = scan.data.counts.non_matches || 0; const progress = scan.data.total ? Math.round(scan.data.processed / scan.data.total * 100) : 0;
  return <><PageHeader title={scan.data.policy.target_topic} description={scan.data.prompt} action={<div className="flex flex-wrap items-center gap-2"><Badge tone={scan.data.status === "completed" ? "success" : scan.data.status === "failed" || scan.data.status === "cancelled" ? "danger" : "warning"}>{statusLabel(scan.data.status)}</Badge><Button asChild variant="secondary" size="sm"><Link to={`/inventory/${id}`}>{t("viewInInventory")}</Link></Button>{["pending", "running"].includes(scan.data.status) && <Button variant="ghost" size="sm" disabled={cancelScan.isPending} onClick={() => cancelScan.mutate()}>{t("cancelScan")}</Button>}</div>} />
    {scan.data.error && <div className="mb-5"><ErrorState message={scan.data.error} /></div>}
    <div className="scan-metrics mb-4 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800"><div className="bg-white p-4 dark:bg-zinc-900"><div className="font-mono text-2xl font-semibold">{number(scan.data.processed)}/{number(scan.data.total)}</div><div className="text-xs text-zinc-500">{t("processed")}</div></div><div className="bg-white p-4 dark:bg-zinc-900"><div className="font-mono text-2xl font-semibold">{percentage(progress / 100)}</div><div className="text-xs text-zinc-500">{t("scanProgress")}</div></div><div className="bg-brand-50 p-4 dark:bg-brand-950/60"><div className="font-mono text-2xl font-semibold text-brand-800 dark:text-brand-200">{number(matches)}</div><div className="text-xs text-brand-700 dark:text-brand-300">{t("matches")}</div></div><div className="bg-white p-4 dark:bg-zinc-900"><div className="font-mono text-2xl font-semibold">{number(nonMatches)}</div><div className="text-xs text-zinc-500">{t("nonMatches")}</div></div><div className="bg-white p-4 dark:bg-zinc-900"><div className="font-mono text-2xl font-semibold text-brand-800 dark:text-brand-300">{number(selected)}</div><div className="text-xs text-zinc-500">{t("selected")}</div></div></div>
    {scan.data.status === "completed" && matches === 0 && <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/80 p-4 text-sm leading-6 text-brand-950 dark:border-brand-900 dark:bg-brand-950/50 dark:text-brand-100"><span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-brand-700" />{t("noMatchesFound")}</div>}
    <div className="detail-layout"><div>{results.isLoading ? <LoadingState /> : <div className="space-y-3">{results.data?.items.map((row) => <article key={row.post_id} className={`rounded-xl border bg-white p-4 dark:bg-zinc-900 ${row.selected ? "border-brand-500 dark:border-brand-700" : "border-zinc-200 dark:border-zinc-800"}`}><div className="flex items-start gap-3"><input aria-label={t("selectPost", { id: row.post_id })} type="checkbox" className="mt-1 accent-brand-700" checked={row.selected} disabled={selection.isPending} onChange={() => selection.mutate(row)} /><div className="min-w-0 flex-1"><p dir="auto" className="text-sm leading-relaxed">{row.text}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Badge tone={row.matches ? "success" : "neutral"}>{row.matches ? t("match") : t("notMatch")}</Badge><Badge>{contentTypeLabel(row.content_type)}</Badge><Badge>{languageName(row.detected_language)}</Badge><span className="font-mono text-xs font-semibold text-zinc-600 dark:text-zinc-300">{t("classificationConfidence")}: {percentage(row.confidence)}</span>{row.status === "failed" && <Badge tone="danger">{t("failed")}</Badge>}</div><p dir="auto" className="mt-3 border-s-2 border-brand-200 ps-3 text-xs leading-relaxed text-zinc-600 dark:border-brand-900 dark:text-zinc-400">{row.reason_en}</p></div></div></article>)}</div>}</div>
      <aside ref={deletionReview} tabIndex={-1} aria-label={t("deleteSelected")} className="scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-brand-700"><Panel className="sticky top-6 overflow-hidden border-brand-100"><div className="absolute inset-x-0 top-0 h-1 bg-brand-700" /><h2 className="text-base font-semibold">{t("deleteSelected")}</h2><p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("permanentWarning")}</p><div className="mt-5 rounded-xl bg-brand-50 p-4 dark:bg-brand-950/60"><div className="font-mono text-2xl font-semibold text-brand-800 dark:text-brand-200">{number(selected)}</div><div className="text-xs text-brand-700 dark:text-brand-300">{t("selected")}</div></div><label className="mt-5 grid gap-2 text-sm font-medium">{t("exactCount")}<Input type="number" min="0" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>{deletion.error && <ErrorState message={(deletion.error as Error).message} />}<Button variant="danger" className="mt-4 w-full" disabled={scan.data.status !== "completed" || Number(confirm) !== selected || !selected || deletion.isPending} onClick={() => deletion.mutate()}>{t("confirmDelete")}</Button></Panel></aside>
    </div>
  </>;
}
