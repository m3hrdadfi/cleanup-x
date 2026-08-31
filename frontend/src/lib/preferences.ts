import { useSyncExternalStore } from "react";
import i18n from "../i18n";
import { locales, type LocaleCode, type TextDirection } from "../locales";

export type ThemePreference = "system" | "light" | "dark";

const LOCALE_KEY = "cleanup-locale";
const THEME_KEY = "cleanup-theme";
const PREFERENCE_EVENT = "cleanup-preference-change";

function preferenceChanged() { window.dispatchEvent(new Event(PREFERENCE_EVENT)); }

export function getDirection(): TextDirection { return locales[getLocale()].direction; }

export function getLocale(): LocaleCode {
  const saved = localStorage.getItem(LOCALE_KEY);
  return saved && Object.hasOwn(locales, saved) ? saved as LocaleCode : "en";
}
export function applyLocale(locale: LocaleCode) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locales[locale].direction;
  document.documentElement.dataset.direction = locales[locale].direction;
  void i18n.changeLanguage(locale);
}
export function setLocale(locale: LocaleCode) {
  localStorage.setItem(LOCALE_KEY, locale);
  applyLocale(locale);
  preferenceChanged();
}

export function getTheme(): ThemePreference {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}
export function applyTheme(theme: ThemePreference) {
  const prefersDark = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = theme;
}
export function setTheme(theme: ThemePreference) { localStorage.setItem(THEME_KEY, theme); applyTheme(theme); preferenceChanged(); }

export function initializePreferences() {
  // Migrate the obsolete manual override; language is the single source of direction.
  localStorage.removeItem("cleanup-direction");
  applyLocale(getLocale());
  applyTheme(getTheme());
}

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === LOCALE_KEY || event.key === null) applyLocale(getLocale());
    if (event.key === THEME_KEY || event.key === null) applyTheme(getTheme());
    callback();
  };
  window.addEventListener(PREFERENCE_EVENT, callback); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(PREFERENCE_EVENT, callback); window.removeEventListener("storage", onStorage); };
}
export function useTheme() { return useSyncExternalStore(subscribe, getTheme, () => "system"); }
export function useLocale() { return useSyncExternalStore(subscribe, getLocale, () => "en"); }
