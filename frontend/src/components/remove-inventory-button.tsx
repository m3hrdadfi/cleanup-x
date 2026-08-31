import { DotsThree, Trash } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { ErrorState } from "./feedback";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function RemoveInventoryButton({ scanId, postId, label, disabled = false, compact = false, onRemoved }: {
  scanId: string; postId?: string; label: string; disabled?: boolean; compact?: boolean; onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef("");
  const titleId = useId(), descriptionId = useId();
  const mutation = useMutation({
    mutationFn: () => api(`/api/inventory/sessions/${encodeURIComponent(scanId)}${postId ? `/items/${encodeURIComponent(postId)}` : ""}`, {
      method: "DELETE", body: JSON.stringify({ confirmed: true }), headers: { "Idempotency-Key": key.current },
    }),
    onSuccess: () => {
      setOpen(false);
      for (const query of ["scans", "posts", "scan", "scan-results", "overview", "audit"]) void client.invalidateQueries({ queryKey: [query] });
      onRemoved();
    },
  });
  useEffect(() => { if (open && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [open]);
  const confirmRemoval = () => { mutation.reset(); key.current = crypto.randomUUID(); setMenuOpen(false); setOpen(true); };
  return <>
    {compact ? <Popover open={menuOpen} onOpenChange={setMenuOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="size-9 p-0" aria-label={t("moreActions")} title={t("moreActions")}><DotsThree size={22} /></Button></PopoverTrigger><PopoverContent align="end" className="w-60" onCloseAutoFocus={(event) => { if (open) event.preventDefault(); }}><Button type="button" variant="ghost" size="sm" className="w-full justify-start text-red-700 dark:text-red-300" disabled={disabled} onClick={confirmRemoval}><Trash size={14} />{t("removeLocally")}</Button><p className="px-2 py-2 text-xs leading-5 text-zinc-500">{disabled ? t("inventoryRemovalActive") : t("localActionHint")}</p></PopoverContent></Popover> : <Button type="button" variant="secondary" size="sm" disabled={disabled} title={disabled ? t("inventoryRemovalActive") : undefined} onClick={confirmRemoval}><Trash size={14} />{t("removeLocally")}</Button>}
    {open && <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!mutation.isPending) setOpen(false); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-zinc-950/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
      <h2 id={titleId} className="text-lg font-semibold">{postId ? t("removeInventoryItem") : t("removeInventorySession")}</h2>
      <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{postId ? t("removeInventoryItemHelp") : t("removeInventorySessionHelp")}</p>
      <p dir="auto" className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-950">{label}</p>
      {mutation.error && <div className="mt-4"><ErrorState message={(mutation.error as Error).message} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button autoFocus type="button" variant="secondary" disabled={mutation.isPending} onClick={() => setOpen(false)}>{t("cancel")}</Button><Button type="button" variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? t("loading") : t("removeLocally")}</Button></div>
    </dialog>}
  </>;
}
