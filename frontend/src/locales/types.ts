import type { en } from "./en";

export type TranslationKey = keyof typeof en;
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";
export type TranslationResource = Record<TranslationKey, string> &
  Partial<Record<`${TranslationKey}_${PluralCategory}`, string>>;
export type TextDirection = "ltr" | "rtl";

export type LocaleDefinition = {
  label: string;
  nativeLabel: string;
  direction: TextDirection;
  translation: TranslationResource;
};
