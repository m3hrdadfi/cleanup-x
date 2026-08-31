import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { locales } from "./locales";

export const DEFAULT_LOCALE = "en";

const resources = Object.fromEntries(
  Object.entries(locales).map(([code, locale]) => [code, { translation: locale.translation }]),
);

i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: Object.keys(locales),
  interpolation: { escapeValue: false },
});

export default i18n;
