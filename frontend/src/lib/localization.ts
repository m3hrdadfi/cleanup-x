import i18n from "../i18n";
import { en } from "../locales/en";
import { locales } from "../locales";
import type { TranslationKey } from "../locales";

export function number(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, options).format(value);
}

export function currency(value: number, digits = 2) {
  return number(value, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function percentage(value: number) {
  return number(value, { style: "percent", maximumFractionDigits: 0 });
}

function label(prefix: string, value: string, fallback: TranslationKey) {
  const key = `${prefix}${value}`;
  return i18n.t(Object.hasOwn(en, key) ? key as TranslationKey : fallback);
}

export function statusLabel(value: string) { return label("status_", value, "unknownStatus"); }
export function entityLabel(value: string) {
  if (value === "repost_resolution_job") return i18n.t("event_resolution");
  return label("entity_", value, "entity_unknown");
}
export function eventLabel(value: string) {
  const aliases: Record<string, string> = { repost_resolution: "resolution", retry: "retried", absent: "already_absent" };
  return value.split(".").map((part) => label("event_", aliases[part] || part, "event_unknown")).join(" / ");
}
export function contentTypeLabel(value: string) {
  const keys: Record<string, TranslationKey> = { post: "posts", reply: "replies", quote: "quotes", repost: "reposts" };
  const key = Object.hasOwn(keys, value) ? keys[value] : undefined;
  return i18n.t(key || "unknownValue");
}

export function languageName(value: string) {
  try {
    const name = new Intl.DisplayNames([i18n.resolvedLanguage || i18n.language], { type: "language", fallback: "none" }).of(value);
    return name || value;
  } catch { return value; }
}

// Provider output and persisted diagnostics remain original evidence. Only UI copy is translated.
export function errorLabel(message: string) {
  const known = Object.values(locales).flatMap((locale) => Object.entries(locale.translation)).find(([, value]) => value === message);
  if (known) return i18n.t(known[0] as TranslationKey);
  if (/configured API budget|maximum sync estimate/.test(message)) return i18n.t("budgetExceeded");
  if (/provider timed out/i.test(message)) return i18n.t("providerTimeout");
  if (/Could not reach the provider/.test(message)) return i18n.t("providerUnreachable");
  if (message === "No posts are selected") return i18n.t("noSelection");
  if (message === "Finish or cancel active jobs before removing inventory") return i18n.t("inventoryRemovalActive");
  if (message === "The scan must be complete before deletion") return i18n.t("scanMustComplete");
  if (/Failed to fetch|NetworkError|Load failed/.test(message)) return i18n.t("networkError");
  return i18n.t("requestFailed");
}
