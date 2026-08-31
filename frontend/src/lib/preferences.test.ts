import { beforeEach, describe, expect, it } from "vitest";
import { getDirection, getLocale, initializePreferences, setLocale } from "./preferences";
import { locales, type LocaleCode } from "../locales";

describe("layout direction preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to LTR and keeps the document language English", () => {
    initializePreferences();
    expect(getDirection()).toBe("ltr");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it.each(Object.keys(locales) as LocaleCode[])("derives direction from %s and restores it after reload", (locale) => {
    setLocale(locale);
    expect(getLocale()).toBe(locale);
    expect(getDirection()).toBe(locales[locale].direction);
    expect(document.documentElement.lang).toBe(locale);
    expect(document.documentElement.dir).toBe(locales[locale].direction);
    // Old overrides must not win over the selected language, even on reload.
    localStorage.setItem("cleanup-direction", locales[locale].direction === "ltr" ? "rtl" : "ltr");
    initializePreferences();
    expect(document.documentElement.dir).toBe(locales[locale].direction);
    expect(document.documentElement.dataset.direction).toBe(locales[locale].direction);
    expect(localStorage.getItem("cleanup-direction")).toBeNull();
  });

  it("falls back to English LTR for an unsupported stored locale", () => {
    localStorage.setItem("cleanup-locale", "unsupported");
    localStorage.setItem("cleanup-direction", "rtl");
    initializePreferences();
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
