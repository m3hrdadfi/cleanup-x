import { ArrowCounterClockwise, DownloadSimple, ListBullets, Pause, Play, Stop } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Panel } from "../components/ui/panel";
import { statusLabel, number, currency } from "../lib/localization";
import { api, postJson } from "../lib/api";

type Resolution = { id: string; status: string; total: number; processed: number; resolved: number; failed: number; resume_at?: string; error?: string };
type Job = { id: string; scan_id: string; status: string; total: number; processed: number; succeeded: number; failed: number; retryable: number; unresolved_reposts: number; resolution_estimated_cost_usd: number; resolution?: Resolution; manifest_sha256: string; resume_at?: string; error?: string; estimated_cost_usd: number; failures: { post_id: string; status: string; error: string }[] };

export function DeletionDetailPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const qc = useQueryClient(); const navigate = useNavigate();
  const [retryCount, setRetryCount] = useState("");
  const [resolutionCount, setResolutionCount] = useState("");
  const job = useQuery({ queryKey: ["deletion", id], queryFn: () => api<Job>(`/api/deletion-jobs/${id}`), refetchInterval: (q) => { const data = q.state.data; const deletionDone = ["completed", "cancelled", "failed"].includes(data?.status || ""); const resolutionDone = !data?.resolution || ["completed", "failed", "reauth_required"].includes(data.resolution.status); return deletionDone && resolutionDone ? false : 1200; } });
  useEffect(() => {
    if (!id || ["completed", "failed", "cancelled"].includes(job.data?.status || "")) return;
    const events = new EventSource(`/api/jobs/${id}/events`);
    events.addEventListener("progress", () => qc.invalidateQueries({ queryKey: ["deletion", id] }));
    events.onerror = () => events.close();
    return () => events.close();
  }, [id, job.data?.status, qc]);
  const control = useMutation({ mutationFn: (action: string) => postJson(`/api/deletion-jobs/${id}/${action}`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["deletion", id] }) });
  const retry = useMutation({ mutationFn: () => postJson<{ id: string }>(`/api/deletion-jobs/${id}/retry`, { confirmation_count: Number(retryCount) }, true), onSuccess: (result) => { qc.invalidateQueries({ queryKey: ["deletions"] }); navigate(`/deletions/${result.id}`); } });
  const resolveReposts = useMutation({ mutationFn: () => postJson<{ id: string }>(`/api/deletion-jobs/${id}/resolve-reposts`, { confirmation_count: Number(resolutionCount) }, true), onSuccess: () => qc.invalidateQueries({ queryKey: ["deletion", id] }) });
  const rerun = useMutation({ mutationFn: () => postJson<{ id: string }>(`/api/scans/${job.data?.scan_id}/rerun`, {}, true), onSuccess: (result) => navigate(`/scans/${result.id}`) });
  if (job.isLoading) return <LoadingState label={t("loading")} />;
  if (job.error || !job.data) return <ErrorState message={(job.error as Error)?.message || t("deletionNotFound")} />;
  const data = job.data; const tone = data.status === "completed" ? "success" : data.status === "cancelled" || data.status === "failed" ? "danger" : "warning";
  const terminal = ["completed", "cancelled", "failed"].includes(data.status);
  return <><PageHeader title={t("deletionTitle")} description={`${t("manifest")} ${data.manifest_sha256.slice(0, 16)}…`} action={<div className="flex items-center gap-2"><Button asChild variant="secondary" size="sm"><Link to="/deletions"><ListBullets />{t("backToHistory")}</Link></Button><Badge tone={tone}>{statusLabel(data.status)}</Badge></div>} />
    {data.error && <div className="mb-5"><ErrorState message={data.error} /></div>}
    <div className="detail-layout"><div className="space-y-4"><div className="detail-metrics gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">{[[t("processed"), `${number(data.processed)}/${number(data.total)}`], [t("succeeded"), number(data.succeeded)], [t("failed"), number(data.failed)], [t("costEstimate"), currency(data.estimated_cost_usd)]].map(([label, value]) => <div className="bg-white p-4 dark:bg-zinc-900" key={String(label)}><div className="font-mono text-xl font-semibold">{value}</div><div className="mt-1 text-xs text-zinc-500">{label}</div></div>)}</div>
      {data.status === "rate_limited" && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">{t("rateLimited")} {data.resume_at && new Date(data.resume_at).toLocaleTimeString(i18n.language)}</div>}
      {data.failures.length > 0 && <Panel><h2 className="font-semibold">{t("failuresReview")}</h2><div className="mt-4 space-y-3">{data.failures.map((failure) => <div key={failure.post_id} className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-800"><code className="text-xs">{failure.post_id}</code><ErrorState message={failure.error} /></div>)}</div></Panel>}</div>
      <aside className="space-y-4"><Panel><h2 className="font-semibold">{t("jobControls")}</h2><div className="mt-4 grid gap-2">{data.status === "paused" || data.status === "reauth_required" ? <Button onClick={() => control.mutate("resume")}><Play size={17} />{t("resume")}</Button> : <Button variant="secondary" disabled={["completed", "cancelled"].includes(data.status)} onClick={() => control.mutate("pause")}><Pause size={17} />{t("pause")}</Button>}<Button variant="danger" disabled={["completed", "cancelled"].includes(data.status)} onClick={() => control.mutate("cancel")}><Stop size={17} />{t("cancel")}</Button></div><div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800"><h2 className="font-semibold">{t("manifest")}</h2><p className="mt-2 break-all font-mono text-[11px] text-zinc-500">SHA-256 {data.manifest_sha256}</p><div className="mt-4 flex gap-2"><Button asChild variant="secondary" size="sm"><a href={`/api/exports/${id}.json`}><DownloadSimple />JSON</a></Button><Button asChild variant="secondary" size="sm"><a href={`/api/exports/${id}.csv`}><DownloadSimple />CSV</a></Button></div></div></Panel>
      {terminal && <Panel><h2 className="font-semibold">{t("runAgain")}</h2><p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("runAgainHelp")}</p>{rerun.error && <ErrorState message={(rerun.error as Error).message} />}<Button className="mt-4 w-full" variant="secondary" disabled={rerun.isPending} onClick={() => rerun.mutate()}><ArrowCounterClockwise />{t("runAgain")}</Button></Panel>}
      {terminal && data.unresolved_reposts > 0 && <Panel><h2 className="font-semibold">{t("resolveReposts")}</h2><p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("resolveRepostsHelp")}</p><div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><div><p className="font-mono text-xl font-semibold">{number(data.unresolved_reposts)}</p><p className="text-xs text-zinc-500">{t("unresolved")}</p></div><div><p className="font-mono text-xl font-semibold">{currency(data.resolution_estimated_cost_usd)}</p><p className="text-xs text-zinc-500">{t("lookupEstimate")}</p></div></div>{data.resolution && <div className="mt-3 text-sm"><Badge tone={["completed"].includes(data.resolution.status) ? "success" : ["failed", "reauth_required"].includes(data.resolution.status) ? "danger" : "warning"}>{statusLabel(data.resolution.status)}</Badge><span className="ms-2 text-zinc-500">{number(data.resolution.processed)}/{number(data.resolution.total)} · {number(data.resolution.resolved)} {t("resolved")}</span>{data.resolution.error && <ErrorState message={data.resolution.error} />}</div>}<label className="mt-4 grid gap-2 text-sm font-medium">{t("exactUnresolvedCount")}<Input type="number" min="0" value={resolutionCount} onChange={(event) => setResolutionCount(event.target.value)} /></label>{resolveReposts.error && <ErrorState message={(resolveReposts.error as Error).message} />}<Button className="mt-4 w-full" disabled={Number(resolutionCount) !== data.unresolved_reposts || resolveReposts.isPending || ["pending", "running", "rate_limited"].includes(data.resolution?.status || "")} onClick={() => resolveReposts.mutate()}><ArrowCounterClockwise />{t("resolveReposts")}</Button></Panel>}
      {terminal && data.retryable > 0 && <Panel><h2 className="font-semibold">{t("retryRemaining")}</h2><p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("retryHelp")}</p><div className="mt-4 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><span className="font-mono text-xl font-semibold">{number(data.retryable)}</span><span className="ms-2 text-xs text-zinc-500">{t("remaining")}</span></div><label className="mt-4 grid gap-2 text-sm font-medium">{t("exactRetryCount")}<Input type="number" min="0" value={retryCount} onChange={(event) => setRetryCount(event.target.value)} /></label>{retry.error && <ErrorState message={(retry.error as Error).message} />}<Button className="mt-4 w-full" disabled={Number(retryCount) !== data.retryable || retry.isPending} onClick={() => retry.mutate()}><ArrowCounterClockwise />{t("startRetry")}</Button></Panel>}</aside>
    </div>
  </>;
}
