import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CheckCircle, MagnifyingGlass } from "@phosphor-icons/react";
import { api, postJson } from "../lib/api";
import { contentTypeLabel, number, statusLabel } from "../lib/localization";
import { PageHeader } from "../components/page-header";
import { ErrorState, LoadingState } from "../components/feedback";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Panel } from "../components/ui/panel";
import { Badge } from "../components/ui/badge";
import { SemanticResults, type SearchResult } from "../components/semantic-results";

type IndexJob = { id: string; status: string; total: number; processed: number; indexed: number; skipped: number; error: string | null };
type IndexStatus = { eligible: number; indexed: number; pending: number; ready: boolean; model: string; base_url: string; job: IndexJob | null };

export function SearchPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [type, setType] = useState("");
  const [language, setLanguage] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(25);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState("");
  const status = useQuery({ queryKey: ["semantic-index"], queryFn: () => api<IndexStatus>("/api/search/index"), refetchInterval: 3000 });
  const refresh = () => { setConfirmed(false); void client.invalidateQueries({ queryKey: ["semantic-index"] }); };
  const index = useMutation({ mutationFn: () => postJson("/api/search/index", { confirmed: true }, true), onSuccess: refresh });
  const control = useMutation({ mutationFn: (action: string) => postJson(`/api/search/index/${status.data?.job?.id}/${action}`, {}), onSuccess: refresh });
  const search = useMutation({ mutationFn: () => { setSubmitted(query); return postJson<SearchResult>("/api/search", { query, mode, limit, content_type: type || null, language: language.trim() || null, date_from: from || null, date_to: to || null }); } });
  const job = status.data?.job;
  const active = job && ["pending", "running", "paused"].includes(job.status);
  const indexCurrent = !active && status.data?.ready && status.data.eligible > 0 && status.data.pending === 0;
  const selectClass = "h-10 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return <>
    <PageHeader title={t("semanticSearch")} description={t("semanticSearchHelp")} action={<Button asChild variant="secondary"><Link to="/settings#settings-embedding">{t("embeddingProvider")}</Link></Button>} />
    <Panel className="mb-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t("semanticIndex")}</h2>{status.data && <span className="text-sm tabular-nums">{t("indexCoverage", { indexed: number(status.data.indexed), total: number(status.data.eligible) })}</span>}</div>
      {status.isPending && <LoadingState />}{status.error && <ErrorState message={(status.error as Error).message} />}
      {status.data && <>
        {indexCurrent ? <details className="text-xs text-zinc-500"><summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{t("searchIndexDetails")}</summary><div className="mt-2"><p className="text-xs leading-5 text-zinc-500">{t("indexPrivacy")} <bdi className="break-all">{status.data.base_url}</bdi> · <bdi>{status.data.model || t("needsSetup")}</bdi></p></div></details> : <p className="text-xs leading-5 text-zinc-500">{t("indexPrivacy")} <bdi className="break-all">{status.data.base_url}</bdi> · <bdi>{status.data.model || t("needsSetup")}</bdi></p>}
        {!status.data.ready && <p className="text-sm">{t("embeddingNotReady")}</p>}
        {active ? <div className="space-y-3"><div className="flex flex-wrap items-center gap-3"><Badge>{statusLabel(job.status)}</Badge><span className="text-sm">{t("processed")}: {number(job.processed)}/{number(job.total)}</span><span className="text-xs text-zinc-500">{t("indexSkipped", { value: number(job.skipped) })}</span><div className="ms-auto flex gap-2"><Button variant="secondary" size="sm" disabled={control.isPending} onClick={() => control.mutate(job.status === "paused" ? "resume" : "pause")}>{job.status === "paused" ? t("resume") : t("pause")}</Button><Button variant="ghost" size="sm" disabled={control.isPending} onClick={() => control.mutate("cancel")}>{t("cancel")}</Button></div></div><progress className="h-2 w-full accent-brand-700" aria-label={t("semanticIndex")} value={job.processed} max={Math.max(job.total, 1)} />{job.error && <ErrorState message={job.error} />}</div> : indexCurrent ? <p className="flex items-center gap-2 text-xs text-brand-700 dark:text-brand-300"><CheckCircle size={16} aria-hidden />{t("searchIndexCurrent")}</p> : <div className="flex flex-wrap items-center gap-4"><label className="flex flex-1 items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1 accent-brand-700" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t("indexConsent")}</label><Button size="sm" disabled={!confirmed || !status.data.ready || !status.data.pending || index.isPending} onClick={() => index.mutate()}>{t("indexMissing", { value: number(status.data.pending) })}</Button></div>}
      </>}
      {(index.error || control.error) && <ErrorState message={((index.error || control.error) as Error).message} />}
    </Panel>
    <Panel className="mb-5"><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); search.mutate(); }}>
      <div className="flex gap-2"><label className="flex-1"><span className="sr-only">{t("search")}</span><Input dir="auto" required maxLength={2000} placeholder={t("semanticPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><Button type="submit" disabled={!query.trim() || search.isPending || mode !== "keyword" && !status.data?.ready}><MagnifyingGlass size={16} />{t("search")}</Button></div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="grid gap-1.5 text-xs">{t("searchMode")}<select className={selectClass} value={mode} onChange={(event) => setMode(event.target.value)}>{(["hybrid", "semantic", "keyword"] as const).map((value) => <option key={value} value={value}>{t(`search_${value}`)}</option>)}</select></label>
        <label className="grid gap-1.5 text-xs">{t("type")}<select className={selectClass} value={type} onChange={(event) => setType(event.target.value)}><option value="">{t("all")}</option>{["post", "reply", "quote", "repost"].map((value) => <option key={value} value={value}>{contentTypeLabel(value)}</option>)}</select></label>
        <label className="grid gap-1.5 text-xs">{t("searchLanguageCode")}<Input value={language} maxLength={20} onChange={(event) => setLanguage(event.target.value)} /></label>
        <label className="grid gap-1.5 text-xs">{t("searchFrom")}<Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1.5 text-xs">{t("searchTo")}<Input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="grid gap-1.5 text-xs">{t("searchLimit")}<Input type="number" min={1} max={100} required value={limit} onChange={(event) => setLimit(Number(event.target.value))} /></label>
      </div>
      <p className="text-xs leading-5 text-zinc-500">{t("searchScoreHelp")}</p>
    </form></Panel>
    {search.isPending ? <LoadingState /> : search.error ? <ErrorState message={(search.error as Error).message} /> : search.data ? <SemanticResults key={search.submittedAt} data={search.data} query={submitted} /> : <p className="py-8 text-center text-sm text-zinc-500">{t("searchIdle")}</p>}
  </>;
}
