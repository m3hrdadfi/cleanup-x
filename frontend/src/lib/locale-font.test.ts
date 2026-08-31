import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locales, type LocaleCode } from "../locales";
import { initializePreferences, setLocale } from "./preferences";

const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
let styles: HTMLStyleElement;

beforeEach(() => {
  localStorage.clear();
  initializePreferences();
  styles = document.createElement("style");
  // Test the actual font rules without injecting Tailwind's build-time directives.
  styles.textContent = [...css.matchAll(/(?:^|\n)([^{}]+)\{([^{}]+)\}/g)]
    .filter((match) => match[2].includes("font-family:"))
    .map((match) => match[0]).join("\n");
  document.head.appendChild(styles);
});
afterEach(() => {
  styles.remove();
  localStorage.clear();
  initializePreferences();
});

describe("language-scoped interface fonts", () => {
  it.each(Object.keys(locales) as LocaleCode[])("uses the right font for %s, independently of direction", (locale) => {
    setLocale(locale);
    for (const direction of ["ltr", "rtl"] as const) {
      // Simulate CSS direction independently; the app itself always uses locale direction.
      document.documentElement.dir = direction;
      const family = getComputedStyle(document.documentElement).fontFamily;
      expect(family.startsWith(locale === "fa" ? '"Vazirmatn Variable"' : '"Geist Variable"')).toBe(true);
      if (locale !== "fa") expect(family).not.toContain("Vazirmatn");
    }
    setLocale("en");
    expect(getComputedStyle(document.documentElement).fontFamily).not.toContain("Vazirmatn");
  });

  it("self-hosts Vazirmatn and preserves monospace identifiers with Persian glyph fallback", () => {
    expect(css).toContain('@import "@fontsource-variable/vazirmatn"');
    setLocale("fa");
    const code = document.createElement("code");
    document.body.appendChild(code);
    const family = getComputedStyle(code).fontFamily;
    expect(family.startsWith('"Geist Mono Variable"')).toBe(true);
    expect(family).toContain("Vazirmatn Variable");
    code.remove();
  });
});
