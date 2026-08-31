import { describe, expect, it } from "vitest";
import i18n, { DEFAULT_LOCALE } from "./i18n";
import { locales } from "./locales";

describe("localization registry", () => {
  it("bundles the supported interface languages with English as default", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(Object.keys(locales)).toEqual(expect.arrayContaining(["en", "fa", "sv", "nb", "da", "fi"]));
    expect(i18n.getFixedT("en")("inventoryTitle")).toBe("Content inventory");
  });

  it("records a natural direction for every locale", () => {
    expect(Object.values(locales).every((locale) => ["ltr", "rtl"].includes(locale.direction))).toBe(true);
  });

  it("uses RTL for Persian and LTR for Nordic languages", () => {
    expect(locales.fa.direction).toBe("rtl");
    expect([locales.sv, locales.nb, locales.da, locales.fi].every((locale) => locale.direction === "ltr")).toBe(true);
  });
});
