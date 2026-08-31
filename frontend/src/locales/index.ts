import { en } from "./en";
import { da } from "./da";
import { fa } from "./fa";
import { fi } from "./fi";
import { nb } from "./nb";
import { sv } from "./sv";
import type { LocaleDefinition } from "./types";

export const locales = {
  en: {
    label: "English",
    nativeLabel: "English",
    direction: "ltr",
    translation: en,
  },
  fa: { label: "Persian", nativeLabel: "فارسی", direction: "rtl", translation: fa },
  sv: { label: "Swedish", nativeLabel: "Svenska", direction: "ltr", translation: sv },
  nb: { label: "Norwegian", nativeLabel: "Norsk", direction: "ltr", translation: nb },
  da: { label: "Danish", nativeLabel: "Dansk", direction: "ltr", translation: da },
  fi: { label: "Finnish", nativeLabel: "Suomi", direction: "ltr", translation: fi },
} satisfies Record<string, LocaleDefinition>;

export type LocaleCode = keyof typeof locales;
export type { LocaleDefinition, TextDirection, TranslationKey, TranslationResource } from "./types";
