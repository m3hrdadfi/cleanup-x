import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClockCounterClockwise, Coins, Desktop, Fingerprint, MoonStars, Sun } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { ErrorState, LoadingState } from "../components/feedback";
import { PageHeader } from "../components/page-header";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Panel } from "../components/ui/panel";
import { currency } from "../lib/localization";
import { api } from "../lib/api";
import { locales, type LocaleCode } from "../locales";
import { setLocale, setTheme, useLocale, useTheme, type ThemePreference } from "../lib/preferences";
import { cn } from "../lib/utils";
import { ConfigurationSections } from "../components/configuration-sections";
import { TranslationGuide } from "../components/translation-guide";

type RuntimeSettings = { api_budget_usd: number; audit_retention_days: number; x_credentials_configured: boolean; encryption_source: string; delete_unit_cost_usd: number; owned_read_unit_cost_usd: number };

const themeIcons = { system: Desktop, light: Sun, dark: MoonStars };

export function SettingsPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const qc = useQueryClient();
  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const theme = useTheme();
  const locale = useLocale();
  const query = useQuery({ queryKey: ["app-settings"], queryFn: () => api<RuntimeSettings>("/api/settings/app") });
  const current = form || query.data;
  const openSection = (id: string) => {
    const section = document.getElementById(`settings-${id}`);
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView?.({ block: "start", behavior: "auto" });
  };
  useEffect(() => {
    if (!query.isLoading && ["#settings-interface", "#settings-cost", "#settings-translations"].includes(hash)) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [hash, query.isLoading]);
  const mutation = useMutation({ mutationFn: (value: RuntimeSettings) => api<RuntimeSettings>("/api/settings/app", { method: "PUT", body: JSON.stringify({ api_budget_usd: value.api_budget_usd, audit_retention_days: value.audit_retention_days }) }), onSuccess: (value) => { setForm(null); setSaved(true); qc.setQueryData(["app-settings"], value); void qc.invalidateQueries({ queryKey: ["configuration"] }); } });
  if (query.isLoading) return <LoadingState />;
  if (query.error || !current) return <ErrorState message={(query.error as Error)?.message || t("settingsUnavailable")} />;

  return <>
    <PageHeader title={t("settings")} description={t("settingsBody")} action={<Badge tone="success">{t("protectedLocal")}</Badge>} />
    <nav aria-label={t("settingsSections")} className="mb-5 flex flex-wrap gap-1 border-b border-zinc-200 pb-4 dark:border-zinc-800">{([
      ["interface", "interfaceTitle"], ["connections", "account"], ["model", "llmProvider"], ["embedding", "embeddingProvider"], ["archive", "archive"], ["cost", "costStorage"], ["limits", "configLimits"], ["deployment", "configAdvanced"], ["translations", "localization"],
    ] as const).map(([id, label]) => <Link key={id} to={`#settings-${id}`} onClick={() => openSection(id)} aria-current={hash === `#settings-${id}` ? "location" : undefined} className={cn("rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700", hash === `#settings-${id}` ? "bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800")}>{t(label)}</Link>)}</nav>
    {mutation.error && <div className="mb-5"><ErrorState message={(mutation.error as Error).message} /></div>}

    <Panel id="settings-interface" className="scroll-mt-20">
      <div className="mb-5 border-b border-zinc-100 pb-4 dark:border-zinc-800"><h2 className="text-base font-semibold">{t("interfaceTitle")}</h2><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("interfaceBody")}</p></div>
      <div className="preferences-grid">
        <label className="grid content-start gap-2 text-sm font-medium">
          {t("interfaceLanguage")}
          <select aria-label={t("interfaceLanguage")} className="h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-950" value={locale} onChange={(event) => setLocale(event.target.value as LocaleCode)}>
            {Object.entries(locales).map(([code, definition]) => <option key={code} value={code}>{definition.nativeLabel}</option>)}
          </select>
          <span className="text-xs font-normal leading-5 text-zinc-500 dark:text-zinc-400">{t("interfaceLanguageHelp")}</span>
        </label>
        <div><h3 className="mb-2 text-sm font-medium">{t("theme")}</h3><div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">{(["system", "light", "dark"] as ThemePreference[]).map((value) => { const Icon = themeIcons[value]; return <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)} className={cn("flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium", theme === value ? "bg-brand-700 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800")}><Icon className="shrink-0" size={15} weight="regular" /><span>{t(value)}</span></button>; })}</div><p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{t("themeHelp")}</p></div>
      </div>
    </Panel>

    <ConfigurationSections />
    <div id="settings-cost" className="mb-4 mt-6 flex scroll-mt-20 items-end justify-between gap-4"><div><h2 className="text-lg font-semibold tracking-tight">{t("costStorage")}</h2><p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{t("costStorageBody")}</p></div></div>
    <form onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(current); }}><div className="form-layout">
      <Panel className="p-5"><div className="relative"><span className="flex size-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300"><Coins size={20} /></span><h3 className="mt-3 text-base font-semibold">{t("budgetTitle")}</h3><p className="mt-2 max-w-xl text-xs leading-5 text-zinc-600 dark:text-zinc-400">{t("budgetHelp")}</p><label className="mt-4 grid max-w-md gap-2 text-xs font-semibold">{t("maxUsd")}<div className="relative"><span className="absolute inset-y-0 start-4 flex items-center font-mono text-zinc-500">$</span><Input className="ps-8 font-mono text-base tabular-nums" type="number" min="0" step="0.01" value={current.api_budget_usd} onChange={(e) => { setSaved(false); setForm({ ...current, api_budget_usd: Number(e.target.value) }); }} /></div></label><div className="mt-4 flex flex-wrap gap-2 font-mono text-[11px] text-zinc-500"><span>{currency(current.owned_read_unit_cost_usd, 3)} {t("perOwnedRead")}</span><span aria-hidden>·</span><span>{currency(current.delete_unit_cost_usd, 3)} {t("perDelete")}</span></div></div></Panel>
      <Panel className="p-5"><span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"><ClockCounterClockwise size={20} /></span><h3 className="mt-3 text-base font-semibold">{t("retentionTitle")}</h3><p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{t("retentionHelp")}</p><label className="mt-4 grid gap-2 text-xs font-semibold">{t("retentionDays")}<Input className="font-mono text-base tabular-nums" type="number" min="0" max="3650" value={current.audit_retention_days} onChange={(e) => { setSaved(false); setForm({ ...current, audit_retention_days: Number(e.target.value) }); }} /></label></Panel>
    </div><div className="mt-3 flex justify-end"><Button type="submit" disabled={mutation.isPending || !form}>{saved ? t("saved") : t("save")}</Button></div></form>

    <section className="mt-4 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#2c2c2c] text-white dark:bg-brand-700"><Fingerprint size={22} weight="duotone" /></span><div><h2 className="text-base font-semibold">{t("securityStatus")}</h2><div className="mt-2 flex flex-wrap gap-2"><Badge tone={current.x_credentials_configured ? "success" : "warning"}>{current.x_credentials_configured ? t("credentialsReady") : t("credentialsMissing")}</Badge><Badge tone="success">{t("encryption")}: {current.encryption_source === "local_key_file" ? t("localKeyFile") : current.encryption_source === "environment" ? t("environmentKey") : t("unknownValue")}</Badge></div></div></div>
    </section>
    <TranslationGuide />
  </>;
}
