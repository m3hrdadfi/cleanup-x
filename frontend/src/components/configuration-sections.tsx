import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CaretDown, Cpu, GearSix, PlugsConnected, SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { api, postJson } from "../lib/api";
import { number } from "../lib/localization";
import { ErrorState, LoadingState } from "./feedback";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { XSettings } from "./x-credentials-form";
import { XAccountSettings } from "./x-account-settings";
import { ModelProviderSettings } from "./model-provider-settings";
import { ArchiveSettings } from "./archive-settings";
import { EmbeddingSettingsPanel } from "./embedding-settings";

const limits = [
  { key: "max_archive_mb", label: "archiveSizeLimit", min: 1, max: 10240, step: 1 },
  { key: "max_archive_files", label: "archiveFileLimit", min: 10, max: 100000, step: 1 },
  { key: "delete_unit_cost_usd", label: "deleteEstimate", min: 0, max: 100, step: .000001 },
  { key: "owned_read_unit_cost_usd", label: "readEstimate", min: 0, max: 100, step: .000001 },
  { key: "post_lookup_unit_cost_usd", label: "lookupUnitEstimate", min: 0, max: 100, step: .000001 },
] as const;
type LimitField = typeof limits[number]["key"];
type Configuration = {
  x: XSettings;
  fields: { name: string; group: "x" | "llm" | "embedding" | "deployment"; value: string | number | boolean | null; secret: boolean; configured: boolean }[];
  runtime: Record<LimitField, number>;
  environment: Record<LimitField, number>;
  sources: Record<LimitField, "saved" | "environment">;
};

export function ConfigurationSections() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  const [draft, setDraft] = useState<Partial<Record<LimitField, string>>>({});
  const [saved, setSaved] = useState(false);
  const query = useQuery({ queryKey: ["configuration"], queryFn: () => api<Configuration>("/api/settings/configuration"), enabled });
  useEffect(() => {
    if (!["#settings-connections", "#settings-model", "#settings-embedding", "#settings-archive", "#settings-limits", "#settings-deployment"].includes(hash)) return;
    const section = document.getElementById(hash.slice(1)) as HTMLDetailsElement | null;
    if (section) { section.open = true; setEnabled(true); setVisited((previous) => [...new Set([...previous, hash.replace("#settings-", "")])]); section.scrollIntoView?.({ block: "start", behavior: "auto" }); }
  }, [hash]);
  const refresh = () => {
    setDraft({}); setSaved(true);
    for (const key of ["configuration", "app-settings", "deletions", "deletion"]) void client.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({ mutationFn: () => api("/api/settings/app", { method: "PUT", body: JSON.stringify(Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)]))) }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => postJson("/api/settings/app/reset", { fields: limits.map(({ key }) => key) }), onSuccess: refresh });
  const pending = save.isPending || reset.isPending;
  const fields = (group: Configuration["fields"][number]["group"]) => <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">{query.data?.fields.filter((field) => field.group === group).map((field) => <div key={field.name} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-4"><dt className="break-all font-mono text-[11px] text-zinc-500">{field.name}</dt><dd className="min-w-0 break-all text-sm sm:text-end">{field.secret ? <Badge tone={field.configured ? "success" : "neutral"}>{field.configured ? t("configConfigured") : t("configUnset")}</Badge> : typeof field.value === "boolean" ? field.value ? t("configEnabled") : t("configDisabled") : typeof field.value === "number" ? number(field.value) : <bdi>{field.value || "—"}</bdi>}</dd></div>)}</dl>;
  const state = query.isPending ? <LoadingState /> : query.error ? <ErrorState message={(query.error as Error).message} /> : null;
  return <section id="configuration" className="mt-6 space-y-3">
    <h2 className="text-lg font-semibold">{t("configurationTitle")}</h2>
    {([
      { id: "connections", title: "xCredentialsTitle", icon: PlugsConnected },
      { id: "model", title: "llmProvider", icon: Cpu },
      { id: "embedding", title: "embeddingProvider", icon: Cpu },
      { id: "archive", title: "archive", icon: Archive },
      { id: "limits", title: "configLimits", icon: SlidersHorizontal },
      { id: "deployment", title: "configAdvanced", icon: GearSix },
    ] as const).map(({ id, title, icon: Icon }) => <details key={id} id={`settings-${id}`} className="group scroll-mt-20 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" onToggle={(event) => { if (event.currentTarget.open) { setEnabled(true); setVisited((previous) => previous.includes(id) ? previous : [...previous, id]); } }}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 [&::-webkit-details-marker]:hidden"><Icon size={19} className="text-brand-700 dark:text-brand-300" />{t(title)}<CaretDown className="ms-auto group-open:rotate-180" /></summary>
      {visited.includes(id) && <div className="border-t border-zinc-100 p-4 dark:border-zinc-800 sm:p-5">{id === "embedding" ? <EmbeddingSettingsPanel /> : id === "model" ? <ModelProviderSettings /> : id === "archive" ? <ArchiveSettings /> : state || (id === "connections" ? <>
        <p className="mb-5 max-w-prose text-sm leading-6 text-zinc-500">{t("configConnectionsHelp")}</p>
        {query.data?.x && <XAccountSettings settings={query.data.x} />}
      </> : id === "deployment" ? <><p className="mb-3 max-w-prose text-sm leading-6 text-zinc-500">{t("configRestartHelp")}</p>{fields("deployment")}<p className="mt-3 text-xs leading-5 text-zinc-500">{t("configDatabaseHelp")}</p></> : <form onSubmit={(event) => { event.preventDefault(); if (!pending) save.mutate(); }}>
        <p className="mb-5 max-w-prose text-sm leading-6 text-zinc-500">{t("configLimitsHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">{limits.map(({ key, label, min, max, step }) => <label key={key} className="grid content-start gap-2 text-sm font-medium">{t(label)}<Input type="number" required min={min} max={max} step={step} disabled={pending} value={draft[key] ?? String(query.data?.runtime[key] ?? "")} onChange={(event) => { setSaved(false); setDraft({ ...draft, [key]: event.target.value }); }} /><span className="break-all font-mono text-[10px] font-normal text-zinc-500">{`APP_${key.toUpperCase()}`}</span><span className="text-xs font-normal text-zinc-500">{query.data?.sources[key] === "saved" ? t("configOverride") : t("configEnvironment")}</span></label>)}</div>
        {(save.error || reset.error) && <div className="mt-4"><ErrorState message={((save.error || reset.error) as Error).message} /></div>}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">{saved && <p role="status" className="me-auto text-xs text-brand-700 dark:text-brand-300">{t("saved")}</p>}<Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => reset.mutate()}>{t("resetEnv")}</Button><Button type="submit" size="sm" disabled={pending || Object.keys(draft).length === 0}>{t("save")}</Button></div>
      </form>)}</div>}
    </details>)}
  </section>;
}
