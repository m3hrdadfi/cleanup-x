import type { TranslationResource } from "./types";

// Missing strings must be fixed in the locale, never silently copied from English.
export function createLocale(translation: TranslationResource): TranslationResource {
  return translation;
}
