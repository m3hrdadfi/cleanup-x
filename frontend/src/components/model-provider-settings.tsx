import { ArrowClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, postJson } from "../lib/api";
import { ErrorState, LoadingState } from "./feedback";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ModelCombobox } from "./model-combobox";
import { ConnectionTestDialog, type ConnectionTestReport } from "./connection-test-dialog";

type LLMField = "provider" | "base_url" | "model" | "api_key" | "timeout_seconds" | "batch_size" | "vision_enabled";
type LLM = {
  provider: "ollama" | "openai_compatible";
  base_url: string;
  model: string;
  api_key: string;
  timeout_seconds: number;
  batch_size: number;
  vision_enabled: boolean;
  environment_fields?: LLMField[];
  sources?: Partial<Record<LLMField, "environment" | "saved">>;
  environment?: { provider: LLM["provider"]; base_url: string; model: string; api_key_configured: boolean; timeout_seconds: number; batch_size: number; vision_enabled: boolean };
};

export function ModelProviderSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [message, setMessage] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [error, setError] = useState("");
  const llm = useQuery({ queryKey: ["llm-settings"], queryFn: () => api<LLM>("/api/settings/llm") });
  const [form, setForm] = useState<LLM | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState("");
  const current = form || llm.data;
  const updateForm = (field: LLMField, value: LLM[LLMField]) => {
    setForm((previous) => {
      const active = previous || llm.data;
      if (!active) return previous;
      return {
        ...active,
        [field]: value,
        environment_fields: active.environment_fields?.filter((item) => item !== field),
        sources: { ...active.sources, [field]: "saved" },
      } as LLM;
    });
  };
  const save = useMutation({ mutationFn: (value: LLM) => api<LLM>("/api/settings/llm", { method: "PUT", body: JSON.stringify(value) }), onSuccess: (data) => { setForm(data); setMessage(t("modelSettingsSaved")); qc.setQueryData(["llm-settings"], data); void qc.invalidateQueries({ queryKey: ["configuration"] }); }, onError: (e: Error) => setError(e.message) });
  const resetToEnv = useMutation({ mutationFn: (fields: LLMField[]) => postJson<LLM>("/api/settings/llm/reset", { fields }), onSuccess: (data) => { setForm(data); setError(""); setMessage(t("environmentReset")); qc.setQueryData(["llm-settings"], data); void qc.invalidateQueries({ queryKey: ["configuration"] }); }, onError: (e: Error) => setError(e.message) });
  const test = useMutation({
    mutationFn: async (value: LLM) => {
      const report = await postJson<ConnectionTestReport>("/api/settings/llm/test", value);
      if (!report.ok || report.reply !== "pong" || !report.structured_output) throw new Error(t("pingInvalid"));
      return report;
    },
    onMutate: () => { setTestOpen(true); setError(""); setMessage(""); },
  });
  const testMatchesCurrent = JSON.stringify(test.variables) === JSON.stringify(current);
  const modelDiscovery = useMutation({ mutationFn: (value: LLM) => postJson<{ models: string[] }>("/api/settings/llm/models", value), onSuccess: (data) => { setAvailableModels(data.models); setModelError(""); }, onError: (e: Error) => { setAvailableModels([]); setModelError(e.message); } });

  useEffect(() => {
    if (!current?.base_url.trim()) return;
    if (current.provider === "openai_compatible" && !current.api_key.trim()) return;
    const timer = window.setTimeout(() => modelDiscovery.mutate(current), 500);
    return () => window.clearTimeout(timer);
  }, [current?.provider, current?.base_url, current?.api_key]);


  if (llm.isLoading) return <LoadingState />;
  if (llm.error || !current) return <ErrorState message={(llm.error as Error)?.message || t("settingsUnavailable")} />;
  return <div className="max-w-3xl space-y-4">
    <ConnectionTestDialog open={testOpen} pending={test.isPending} report={test.isSuccess ? test.data : undefined} error={test.error?.message} model={test.variables?.model || current?.model || ""} onClose={() => setTestOpen(false)} onRetry={() => { if (test.variables) test.mutate(test.variables); }} />

    {error && <ErrorState message={error} />}
    {message && <p role="status" className="text-sm text-brand-700 dark:text-brand-300">{message}</p>}
        <div className="flex items-center justify-between"><div><h2 className="scroll-mt-20 text-base font-semibold">{t("llmProvider")}</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("providerHelp")}</p></div>{testMatchesCurrent && test.isSuccess ? <CheckCircle className="text-brand-600" size={25} weight="fill" /> : testMatchesCurrent && test.isError ? <XCircle className="text-red-700" size={25} weight="fill" /> : null}</div>
        {current && <form className="mt-5 grid gap-4" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate(current); }}>
          <label className="grid gap-2 text-sm font-medium">{t("llmProvider")}<select className="h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900" value={current.provider} onChange={(e) => updateForm("provider", e.target.value as LLM["provider"])}><option value="ollama">{t("nativeOllama")}</option><option value="openai_compatible">{t("openaiCompatible")}</option></select></label>
          <div className="grid gap-2 text-sm font-medium"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="llm-base-url">{t("baseUrl")}</label><Button type="button" variant="ghost" size="sm" disabled={resetToEnv.isPending} onClick={() => resetToEnv.mutate(["base_url"])}>{t("resetEnv")}</Button></div><Input id="llm-base-url" value={current.base_url} onChange={(e) => updateForm("base_url", e.target.value)} /><span className="text-xs font-normal text-zinc-500">{current.sources?.base_url === "environment" ? t("baseUrlEnvHelp") : t("baseUrlSavedHelp")}</span></div>
          <div className="grid gap-2 text-sm font-medium"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="llm-api-key">{t("apiKey")}</label><Button type="button" variant="ghost" size="sm" disabled={resetToEnv.isPending} onClick={() => resetToEnv.mutate(["api_key"])}>{t("resetEnv")}</Button></div><Input id="llm-api-key" type="password" value={current.api_key === "********" ? "" : current.api_key} placeholder={current.api_key === "********" ? t("secretPlaceholder") : current.provider === "ollama" ? t("optional") : t("enterKeyFirst")} autoComplete="new-password" onChange={(e) => updateForm("api_key", e.target.value)} /><span className="text-xs font-normal text-zinc-500">{current.sources?.api_key === "environment" && current.environment?.api_key_configured ? t("keyEnvHelp") : t("keyPrivacyHelp")}</span></div>
          <div className="grid gap-2 text-sm font-medium"><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="llm-model">{t("model")}</label><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" disabled={resetToEnv.isPending} onClick={() => resetToEnv.mutate(["model"])}>{t("resetEnv")}</Button><button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50 dark:text-brand-300" disabled={modelDiscovery.isPending || !current.base_url.trim()} onClick={() => modelDiscovery.mutate(current)}><ArrowClockwise />{modelDiscovery.isPending ? t("loadingModels") : availableModels.length ? t("refreshModels") : t("loadModels")}</button></div></div><ModelCombobox id="llm-model" models={availableModels} value={current.model} onChange={(model) => updateForm("model", model)} />{modelError && <span className="text-xs font-normal text-red-700 dark:text-red-300"><ErrorState message={modelError} /></span>}</div>
          <div className="grid grid-cols-2 gap-4"><label className="grid gap-2 text-sm font-medium">{t("timeout")}<Input type="number" min={5} max={600} value={current.timeout_seconds} onChange={(e) => updateForm("timeout_seconds", Number(e.target.value))} /></label><label className="grid gap-2 text-sm font-medium">{t("batchSize")}<Input type="number" min={1} max={50} value={current.batch_size} onChange={(e) => updateForm("batch_size", Number(e.target.value))} /></label></div>
          <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" checked={current.vision_enabled} onChange={(e) => updateForm("vision_enabled", e.target.checked)} />{t("vision")}</label>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={save.isPending}>{t("save")}</Button><Button type="button" variant="secondary" onClick={() => test.isPending ? setTestOpen(true) : test.mutate(current)} disabled={!current.model.trim() || !current.base_url.trim()}>{test.isPending ? t("viewConnectionCheck") : t("test")}</Button><Button type="button" variant="ghost" disabled={resetToEnv.isPending} onClick={() => resetToEnv.mutate(["provider", "base_url", "model", "api_key", "timeout_seconds", "batch_size", "vision_enabled"])}>{t("resetAllEnv")}</Button></div>

        </form>}

  </div>;
}

