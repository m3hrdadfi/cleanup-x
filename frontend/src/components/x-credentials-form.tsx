import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, postJson } from "../lib/api";
import { ErrorState } from "./feedback";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const credentialFields = ["client_id", "client_secret", "callback_url"] as const;
type CredentialField = typeof credentialFields[number];
export type XSettings = {
  client_id_configured: boolean;
  client_secret_configured: boolean;
  callback_url: string;
  connected: boolean;
  sources: Record<CredentialField, "saved" | "environment">;
};

export function XCredentialsForm({ settings, disabled = false }: { settings: XSettings; disabled?: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Partial<Record<CredentialField, string>>>({});
  const [saved, setSaved] = useState(false);
  const refresh = (value: XSettings) => {
    client.setQueryData(["configuration"], (previous: Record<string, unknown> | undefined) => previous ? { ...previous, x: value } : previous);
    for (const key of ["configuration", "app-settings", "x-status"]) void client.invalidateQueries({ queryKey: [key] });
    setSaved(true);
  };
  const save = useMutation({
    mutationFn: () => api<XSettings>("/api/settings/x", { method: "PUT", body: JSON.stringify(Object.fromEntries(Object.entries(draft).filter(([, value]) => value?.trim()))) }),
    onSuccess: (value) => { setDraft({}); refresh(value); },
  });
  const reset = useMutation({
    mutationFn: (fields: CredentialField[]) => postJson<XSettings>("/api/settings/x/reset", { fields }),
    onSuccess: (value, fields) => {
      setDraft((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !fields.includes(key as CredentialField))));
      refresh(value);
    },
  });
  const pending = save.isPending || reset.isPending;
  const locked = settings.connected || pending || disabled;
  const dirty = credentialFields.some((key) => key === "callback_url" ? draft[key] !== undefined && draft[key] !== settings.callback_url : Boolean(draft[key]?.trim()));
  const labels = { client_id: "xClientId", client_secret: "xClientSecret", callback_url: "xCallbackUrl" } as const;
  return <form aria-label={t("xCredentialsTitle")} className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!locked && dirty) save.mutate(); }}>
    <div><h3 className="text-sm font-semibold">{t("xCredentialsTitle")}</h3><p className="mt-2 text-xs leading-5 text-zinc-500">{t("xCredentialsHelp")}</p></div>
    {settings.connected && <p role="status" className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-800 dark:bg-brand-950">{t("xDisconnectToEdit")}</p>}
    {credentialFields.map((key) => {
      const secret = key !== "callback_url";
      const configured = key === "client_id" ? settings.client_id_configured : settings.client_secret_configured;
      return <div key={key} className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={`x-${key}`} className="text-sm font-medium">{t(labels[key])}</label>{secret && <Badge tone={configured ? "success" : "neutral"}>{configured ? t("configConfigured") : t("configUnset")}</Badge>}</div>
        <Input id={`x-${key}`} name={key} dir="ltr" type={secret ? "password" : "url"} autoComplete={secret ? "new-password" : "off"} spellCheck={false} disabled={locked} required={!secret} maxLength={secret ? 4096 : 2048} placeholder={secret ? configured ? t("secretPlaceholder") : t("xEnterCredential") : undefined} value={draft[key] ?? (secret ? "" : settings.callback_url)} onChange={(event) => { setSaved(false); setDraft({ ...draft, [key]: event.target.value }); }} />
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="break-all font-mono text-[10px] text-zinc-500">{`APP_X_${key.toUpperCase()}`}</p><p className="text-xs text-zinc-500">{settings.sources[key] === "saved" ? t("configOverride") : t("configEnvironment")}</p></div><Button type="button" variant="ghost" size="sm" disabled={locked || settings.sources[key] !== "saved"} aria-label={t("xResetField", { field: t(labels[key]) })} onClick={() => reset.mutate([key])}>{t("resetEnv")}</Button></div>
        {!secret && <p className="text-xs leading-5 text-zinc-500">{t("xCallbackHelp")}</p>}
      </div>;
    })}
    {(save.error || reset.error) && <ErrorState message={((save.error || reset.error) as Error).message} />}
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">{saved && <p role="status" className="me-auto text-xs text-brand-700 dark:text-brand-300">{t("xCredentialsSaved")}</p>}<Button type="button" variant="ghost" size="sm" disabled={locked || !credentialFields.some((key) => settings.sources[key] === "saved")} onClick={() => reset.mutate([...credentialFields])}>{t("resetAllEnv")}</Button><Button type="submit" size="sm" disabled={locked || !dirty}>{t("save")}</Button></div>
  </form>;
}
