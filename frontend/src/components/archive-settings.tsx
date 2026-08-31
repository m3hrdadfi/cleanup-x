import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, postJson } from "../lib/api";
import { ErrorState, LoadingState } from "./feedback";
import { Button } from "./ui/button";
import type { XStatus } from "./x-account-settings";

export function ArchiveSettings() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const x = useQuery({ queryKey: ["x-status"], queryFn: () => api<XStatus>("/api/auth/x/status") });
  const coverage = useQuery({ queryKey: ["setup-coverage"], queryFn: () => api<{ coverage: { archive: number } }>("/api/posts?page_size=1") });
  const refresh = () => { for (const key of ["posts", "setup-coverage", "overview", "configuration"]) void client.invalidateQueries({ queryKey: [key] }); };
  const upload = useMutation({
    mutationFn: (file: File) => { const body = new FormData(); body.append("file", file); return api<{ report: Record<string, number> }>("/api/imports/x-archive", { method: "POST", body }); },
    onMutate: () => setMessage(""),
    onSuccess: (data) => { setMessage(t("importedRecords", { value: data.report.imported.toLocaleString(i18n.language) })); refresh(); },
  });
  const sync = useMutation({
    mutationFn: () => postJson<Record<string, number>>("/api/sync/x", {}),
    onMutate: () => setMessage(""),
    onSuccess: (data) => { setMessage(t("syncedRecords", { value: data.api_records.toLocaleString(i18n.language) })); refresh(); },
  });
  return <div className="max-w-3xl space-y-5">
    {coverage.isLoading ? <LoadingState /> : coverage.error ? <ErrorState message={coverage.error.message} /> : <p className="text-sm text-zinc-600 dark:text-zinc-400">{coverage.data?.coverage.archive ? t("archiveRecordCount", { value: coverage.data.coverage.archive.toLocaleString(i18n.language) }) : t("importOlderHistory")}</p>}
    <div><h3 className="text-sm font-semibold">{t("importArchive")}</h3><p className="mt-2 text-sm leading-6 text-zinc-500">{t("archiveHelp")}</p>
      <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-400 px-4 py-6 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:outline-brand-700 dark:border-zinc-700">
        {upload.isPending ? t("importingArchive") : t("chooseArchive")}
        <input className="sr-only" type="file" accept=".zip,application/zip" disabled={upload.isPending || sync.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
      </label>
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"><Button variant="secondary" disabled={!x.data?.connected || sync.isPending || upload.isPending} onClick={() => sync.mutate()}>{t("syncNow")}</Button>{!x.data?.connected && <Link to="/settings#settings-connections" className="text-sm text-brand-700 underline dark:text-brand-300">{t("connectX")}</Link>}</div>
    {x.error && <ErrorState message={x.error.message} />}
    {(upload.error || sync.error) && <ErrorState message={((upload.error || sync.error) as Error).message} />}
    {message && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{message}</p>}
  </div>;
}
