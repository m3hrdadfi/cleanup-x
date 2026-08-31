import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, postJson } from "../lib/api";
import { ErrorState, LoadingState } from "./feedback";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { XCredentialsForm, type XSettings } from "./x-credentials-form";

export type XStatus = { configured: boolean; connected: boolean; user_id?: string; username?: string; name?: string };

export function XAccountSettings({ settings }: { settings: XSettings }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const status = useQuery({ queryKey: ["x-status"], queryFn: () => api<XStatus>("/api/auth/x/status") });
  const connect = useMutation({
    mutationFn: () => postJson<{ authorize_url: string }>("/api/auth/x/start", {}),
    onSuccess: (data) => { window.location.href = data.authorize_url; },
  });
  const disconnect = useMutation({
    mutationFn: () => postJson("/api/auth/x/disconnect", {}),
    onSuccess: () => {
      client.setQueryData(["x-status"], { configured: settings.client_id_configured, connected: false });
      for (const key of ["x-status", "configuration", "app-settings"]) void client.invalidateQueries({ queryKey: [key] });
    },
  });
  if (status.isLoading) return <LoadingState />;
  if (status.error || !status.data) return <ErrorState message={status.error?.message || t("settingsUnavailable")} />;
  const pending = connect.isPending || disconnect.isPending;
  return <div className="max-w-3xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-800">
      <div><h3 className="text-sm font-semibold">{t("account")}</h3><div className="mt-2 flex items-center gap-3"><Badge tone={status.data.connected ? "success" : "neutral"}>{status.data.connected ? t("connected") : t("notConnected")}</Badge>{status.data.username && <bdi className="text-sm text-zinc-500">@{status.data.username}</bdi>}</div></div>
      {status.data.connected ? <Button variant="secondary" size="sm" disabled={pending} onClick={() => disconnect.mutate()}>{t("disconnect")}</Button> : <Button size="sm" disabled={pending || !settings.client_id_configured} onClick={() => connect.mutate()}>{t("connectX")}</Button>}
    </div>
    {(connect.error || disconnect.error) && <ErrorState message={((connect.error || disconnect.error) as Error).message} />}
    <XCredentialsForm settings={{ ...settings, connected: status.data.connected }} disabled={pending} />
  </div>;
}
