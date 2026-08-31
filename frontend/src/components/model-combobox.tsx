import { useTranslation } from "react-i18next";
import { CaretDown, Check } from "@phosphor-icons/react";
import { useId, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type Props = {
  id?: string;
  models: string[];
  value: string;
  onChange: (model: string) => void;
};

export function ModelCombobox({ id, models, value, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const optionsId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => models.filter((model) => model.toLocaleLowerCase().includes(normalized)),
    [models, normalized],
  );
  const exactMatch = models.some((model) => model.toLocaleLowerCase() === normalized);

  const choose = (model: string) => {
    onChange(model);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={optionsId}
          className="flex h-10 w-full items-center justify-between gap-3 rounded-lg border border-zinc-300 bg-white px-3 text-start text-sm font-normal shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <span className={cn("min-w-0 truncate", !value && "text-zinc-500")}>{value || t("selectModel")}</span>
          <CaretDown className="shrink-0 text-zinc-500" size={16} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Command shouldFilter={false} label={t("searchModels")}>
          <CommandInput autoFocus placeholder={t("searchModels")} aria-label={t("searchModels")} value={query} onValueChange={setQuery} />
          <CommandList id={optionsId} label={t("model")}>
            {!filtered.length && !normalized && <CommandEmpty>{t("noModels")}</CommandEmpty>}
            {normalized && !exactMatch && (
              <CommandItem value={`custom:${query}`} onSelect={() => choose(query.trim())}>
                <span className="font-medium">{t("customModel")}</span>
                <span className="min-w-0 truncate font-mono text-xs text-zinc-500">{query.trim()}</span>
              </CommandItem>
            )}
            {filtered.map((model) => (
              <CommandItem key={model} value={model} onSelect={() => choose(model)}>
                <Check className={cn("shrink-0", value === model ? "opacity-100" : "opacity-0")} size={16} aria-hidden />
                <span className="min-w-0 truncate font-mono text-xs">{model}</span>
              </CommandItem>
            ))}
          </CommandList>
          <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-700">
            {normalized
              ? t("matchingModels", { value: filtered.length.toLocaleString(i18n.language) })
              : t("availableModels", { value: models.length.toLocaleString(i18n.language) })}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
