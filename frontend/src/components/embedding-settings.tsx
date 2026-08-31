import { ArrowClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, postJson } from "../lib/api";
import { number } from "../lib/localization";
import { ErrorState, LoadingState } from "./feedback";
import { ModelCombobox } from "./model-combobox";
import { ConnectionTestDialog, type EmbeddingTestReport } from "./connection-test-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type EmbeddingConfig = {
  provider: "ollama" | "openai_compatible"; base_url: string; model: string; api_key_configured: boolean;
  timeout_seconds: number; batch_size: number; query_prefix: string; document_prefix: string;
  sources: Record<string, string>; tested: boolean; dimensions: number | null;
};
type Draft = Partial<Omit<EmbeddingConfig, "sources" | "tested" | "dimensions" | "api_key_configured">> & { api_key?: string };
const fields = ["provider", "base_url", "model", "api_key", "timeout_seconds", "batch_size", "query_prefix", "document_prefix"] as const;
type EmbeddingField = typeof fields[number];

export function EmbeddingSettingsPanel() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [notice, setNotice] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const query = useQuery({ queryKey: ["embedding-settings"], queryFn: () => api<EmbeddingConfig>("/api/settings/embedding") });
  const current = query.data ? { ...query.data, ...draft } : null;
  const refresh = (value: EmbeddingConfig) => {
    models.reset(); test.reset();
    client.setQueryData(["embedding-settings"], value);
    for (const key of ["semantic-index", "configuration"]) void client.invalidateQueries({ queryKey: [key] });
  };
  const save = useMutation({
    mutationFn: () => api<EmbeddingConfig>("/api/settings/embedding", { method: "PUT", body: JSON.stringify(draft) }),
    onSuccess: (value) => { setDraft({}); setNotice(t("saved")); refresh(value); },
  });
  const reset = useMutation({
    mutationFn: (selected: readonly EmbeddingField[]) => postJson<EmbeddingConfig>("/api/settings/embedding/reset", { fields: selected }),
    onSuccess: (value, selected) => {
      // Reset only the requested fields; keep unrelated unsaved form edits.
      setDraft((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !selected.includes(key as EmbeddingField))));
      setNotice(t("environmentReset")); save.reset(); refresh(value);
    },
  });
  const test = useMutation({
    mutationFn: () => postJson<EmbeddingTestReport>("/api/settings/embedding/test", draft),
    onMutate: () => { setTestOpen(true); setNotice(""); },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["embedding-settings"] });
      void client.invalidateQueries({ queryKey: ["semantic-index"] });
    },
  });
  const models = useMutation({ mutationFn: () => postJson<{ models: string[] }>("/api/settings/embedding/models", draft) });
  const busy = save.isPending || reset.isPending || test.isPending || models.isPending;
  const change = (value: Draft) => {
    setDraft({ ...draft, ...value }); setNotice(""); test.reset(); save.reset(); reset.reset();
    if ("base_url" in value || "provider" in value || "api_key" in value) models.reset();
  };
  if (query.isPending) return <LoadingState />;
  if (!current || query.error) return <ErrorState message={(query.error as Error)?.message || t("settingsUnavailable")} />;
  const ready = !Object.keys(draft).length && query.data?.tested;
  const resetButton = (field: EmbeddingField, label: string) => <Button type="button" variant="ghost" size="sm" aria-label={t("xResetField", { field: label })} disabled={busy} onClick={() => reset.mutate([field])}>{t("resetEnv")}</Button>;
  const source = (field: EmbeddingField) => <span className="text-xs font-normal text-zinc-500">{t(current.sources[field] === "saved" ? "configOverride" : "configEnvironment")} · <bdi className="font-mono">{`APP_EMBEDDING_${field.toUpperCase()}`}</bdi></span>;

  return <div className="max-w-3xl space-y-4">
    <ConnectionTestDialog kind="embedding" open={testOpen} pending={test.isPending} embeddingReport={test.data} error={test.error?.message} model={current.model} onClose={() => setTestOpen(false)} onRetry={() => test.mutate()} />
    {(save.error || reset.error) && <ErrorState message={((save.error || reset.error) as Error).message} />}
    {notice && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{notice}</p>}
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-base font-semibold">{t("embeddingProvider")}</h2><p className="mt-1 max-w-prose text-sm leading-6 text-zinc-600 dark:text-zinc-400">{t("embeddingHelp")}</p></div>
      {test.isError ? <XCircle aria-hidden className="shrink-0 text-red-700" size={25} weight="fill" /> : ready || test.isSuccess ? <CheckCircle aria-hidden className="shrink-0 text-brand-600" size={25} weight="fill" /> : null}
    </div>
    <p role="status" className="text-xs text-brand-700 dark:text-brand-300">{ready ? t("embeddingReady", { dimensions: number(query.data?.dimensions || 0) }) : t("embeddingNotReady")}</p>
    <form className="mt-5 grid gap-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        <label className="grid gap-2 text-sm font-medium">{t("embeddingProvider")}<select className="h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900" value={current.provider} onChange={(event) => change({ provider: event.target.value as EmbeddingConfig["provider"] })}><option value="ollama">{t("nativeOllama")}</option><option value="openai_compatible">{t("openaiCompatible")}</option></select></label>
        <div className="grid gap-2 text-sm font-medium">
          <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="embedding-base-url">{t("baseUrl")}</label>{resetButton("base_url", t("baseUrl"))}</div>
          <Input id="embedding-base-url" dir="ltr" required type="url" value={current.base_url} onChange={(event) => change({ base_url: event.target.value })} />
          {source("base_url")}<span className="text-xs font-normal leading-5 text-zinc-500">{t("embeddingUrlHelp")}</span>
        </div>
        <div className="grid gap-2 text-sm font-medium">
          <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="embedding-api-key">{t("apiKey")}</label>{resetButton("api_key", t("apiKey"))}</div>
          <Input id="embedding-api-key" type="password" autoComplete="new-password" value={draft.api_key || ""} placeholder={current.api_key_configured ? t("secretPlaceholder") : current.provider === "ollama" ? t("optional") : t("enterKeyFirst")} onChange={(event) => change({ api_key: event.target.value })} />
          {source("api_key")}<span className="text-xs font-normal leading-5 text-zinc-500">{t("embeddingKeyHelp")}</span>
        </div>
        <div className="grid gap-2 text-sm font-medium">
          <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="embedding-model">{t("model")}</label><div className="flex flex-wrap items-center gap-1">{resetButton("model", t("model"))}<button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50 dark:text-brand-300" disabled={busy || !current.base_url.trim()} onClick={() => models.mutate()}><ArrowClockwise aria-hidden />{models.isPending ? t("loadingModels") : models.data?.models.length ? t("refreshModels") : t("loadModels")}</button></div></div>
          <ModelCombobox id="embedding-model" models={models.data?.models || []} value={current.model} onChange={(model) => change({ model })} />
          {source("model")}<span className="text-xs font-normal leading-5 text-zinc-500">{t("embeddingModelHelp")}</span>
          {models.error && <ErrorState message={(models.error as Error).message} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">{t("timeout")}<Input type="number" min={5} max={600} required value={current.timeout_seconds} onChange={(event) => change({ timeout_seconds: Number(event.target.value) })} /></label>
          <label className="grid gap-2 text-sm font-medium">{t("batchSize")}<Input type="number" min={1} max={64} required value={current.batch_size} onChange={(event) => change({ batch_size: Number(event.target.value) })} /></label>
        </div>
        <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700">{t("embeddingPrefixes")}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">{t("embeddingQueryPrefix")}<Input dir="ltr" value={current.query_prefix} onChange={(event) => change({ query_prefix: event.target.value })} /></label>
            <label className="grid gap-2 text-sm font-medium">{t("embeddingDocumentPrefix")}<Input dir="ltr" value={current.document_prefix} onChange={(event) => change({ document_prefix: event.target.value })} /></label>
          </div><p className="mt-3 text-xs leading-5 text-zinc-500">{t("embeddingPrefixHelp")}</p>
        </details>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !Object.keys(draft).length}>{t("save")}</Button>
        <Button type="button" variant="secondary" disabled={save.isPending || reset.isPending || models.isPending || !current.model.trim() || !current.base_url.trim()} onClick={() => test.isPending ? setTestOpen(true) : test.mutate()}>{test.isPending ? t("viewConnectionCheck") : t("test")}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => reset.mutate(fields)}>{t("resetAllEnv")}</Button>
      </div>
    </form>
  </div>;
}
