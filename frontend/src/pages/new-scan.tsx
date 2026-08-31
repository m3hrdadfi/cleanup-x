import { useMutation, useQuery } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ErrorState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Panel } from "../components/ui/panel";
import { Textarea } from "../components/ui/textarea";
import { statusLabel, number, percentage } from "../lib/localization";
import { api, postJson } from "../lib/api";

type Policy = { target_topic: string; languages: string[]; content_types: string[]; positive_indicators: string[]; positive_indicators_fa: string[]; exclusions: string[]; exclusions_fa: string[]; ambiguity_guidance: string; ambiguity_guidance_fa: string };
type ScanSummary = { id: string; prompt: string; status: string; processed: number; total: number };

export function NewScanPage() {
  const { t, i18n } = useTranslation(); const navigate = useNavigate();
  const [prompt, setPrompt] = useState(""); const [threshold, setThreshold] = useState(0.85); const [policy, setPolicy] = useState<Policy | null>(null);
  const [maxPosts, setMaxPosts] = useState(0);
  const [types, setTypes] = useState(["post", "reply", "quote", "repost"]);
  const scans = useQuery({ queryKey: ["scans"], queryFn: () => api<{ items: ScanSummary[] }>("/api/scans?page_size=10"), refetchInterval: (query) => query.state.data?.items.some((scan) => ["pending", "running"].includes(scan.status)) ? 1500 : false });
  const activeScan = scans.data?.items.find((scan) => ["pending", "running"].includes(scan.status));
  const compile = useMutation({ mutationFn: () => postJson<Policy>("/api/scans/compile", { prompt, languages: ["en", "fa"], content_types: types }), onSuccess: setPolicy });
  const create = useMutation({ mutationFn: () => postJson<{ id: string }>("/api/scans", { prompt, threshold, max_posts: maxPosts, languages: ["en", "fa"], content_types: types, policy }, true), onSuccess: (data) => navigate(`/scans/${data.id}`) });
  const error = compile.error || create.error;
  return <><PageHeader title={t("scanTitle")} description={t("scanBody")} />
    {error && <div className="mb-5"><ErrorState message={(error as Error).message} /></div>}
    {activeScan && <div role="status" className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-semibold"><Badge tone="warning">{statusLabel(activeScan.status)}</Badge>{t("activeScanRunning")}</div><p className="mt-1 text-xs">{activeScan.prompt} · {t("processedSummary", { processed: number(activeScan.processed), total: number(activeScan.total) })}</p></div><Button asChild variant="secondary" size="sm"><Link to={`/scans/${activeScan.id}`}>{t("view")}</Link></Button></div>}
    <div className="form-layout items-start">
      <Panel><form className="grid gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (prompt.trim() && types.length && !compile.isPending) compile.mutate(); }}>
        <label className="grid gap-2 text-sm font-medium">{t("instruction")}<Textarea required placeholder={t("promptExample")} value={prompt} onChange={(e) => { setPrompt(e.target.value); setPolicy(null); }} /></label>
        <fieldset><legend className="mb-2 text-sm font-medium">{t("type")}</legend><div className="grid grid-cols-2 gap-2">{[["post", t("posts")], ["reply", t("replies")], ["quote", t("quotes")], ["repost", t("reposts")]].map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"><input type="checkbox" checked={types.includes(value)} onChange={(e) => setTypes(e.target.checked ? [...types, value] : types.filter((type) => type !== value))} />{label}</label>)}</div></fieldset>
        <div className="grid gap-2"><label htmlFor="scan-max-posts" className="text-sm font-medium">{t("postsToScan")}</label><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><Input id="scan-max-posts" className="font-mono" type="number" min="0" max="1000000" step="1" value={maxPosts} onChange={(e) => setMaxPosts(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /><span className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{maxPosts === 0 ? t("allEligiblePosts") : t("newestPosts", { value: maxPosts.toLocaleString(i18n.language) })}</span></div><p className="text-xs leading-relaxed text-zinc-500">{t("trialScanHelp")}</p></div>
        <label className="grid gap-2 text-sm font-medium">{t("threshold")}<div className="grid grid-cols-[1fr_88px] items-center gap-3"><input type="range" min="0.5" max="1" step="0.01" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="accent-brand-700" /><Input className="font-mono" type="number" min="0.5" max="1" step="0.01" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></div></label>
        <Button type="submit" disabled={compile.isPending || !prompt.trim() || !types.length}>{t("compilePolicy")}</Button>
      </form></Panel>
      <Panel>{policy ? <div><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold text-zinc-500">{t("targetTopic")}</p><h2 className="mt-1 text-xl font-semibold">{policy.target_topic}</h2><p className="mt-2 text-xs text-zinc-500">{t("scanScope", { value: maxPosts === 0 ? t("allEligiblePosts") : t("newestPosts", { value: maxPosts.toLocaleString(i18n.language) }) })}</p></div><span className="font-mono text-sm text-brand-800 dark:text-brand-300">{percentage(threshold)}</span></div><div className="mt-5 grid gap-4"><div><h3 className="text-sm font-semibold">{t("indicators")}</h3><ul className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{policy.positive_indicators.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3 className="text-sm font-semibold">{t("exclusions")}</h3><ul className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{policy.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></div></div><div className="mt-6 rounded-lg bg-zinc-100 p-3 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"><span className="font-semibold">{t("ambiguity")}: </span>{policy.ambiguity_guidance}</div><Button className="mt-6" onClick={() => create.mutate()} disabled={create.isPending || Boolean(activeScan)}>{activeScan ? t("waitForActiveScan") : t("startScan")}</Button></div> : <div className="flex min-h-48 flex-col justify-center text-zinc-500"><p className="font-medium text-zinc-700 dark:text-zinc-300">{t("policyPreview")}</p><p className="mt-2 max-w-sm text-sm">{t("policyPreviewHelp")}</p></div>}</Panel>
    </div>
  </>;
}
