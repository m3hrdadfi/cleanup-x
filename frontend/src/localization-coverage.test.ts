import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "./i18n";
import { locales } from "./locales";
import { en } from "./locales/en";
import { contentTypeLabel, currency, entityLabel, errorLabel, eventLabel, number, statusLabel } from "./lib/localization";

afterEach(async () => { await i18n.changeLanguage("en"); });
const parameters = (text: string) => [...text.matchAll(/{{\s*([\w]+)(?:\s*,[^}]*)?\s*}}/g)].map((match) => match[1]).sort();

describe("translation completeness", () => {
  it.each(Object.entries(locales))("%s explicitly supplies every key and preserves interpolation parameters", (code, locale) => {
    const keys = Object.keys(en) as (keyof typeof en)[];
    for (const key of keys) {
      expect(locale.translation[key], `${code}.${key}`).toBeTruthy();
      expect(parameters(locale.translation[key]), `${code}.${key}`).toEqual(parameters(en[key]));
    }
    const source = readFileSync(join(process.cwd(), "src/locales", `${code}.ts`), "utf8");
    const file = ts.createSourceFile(`${code}.ts`, source, ts.ScriptTarget.Latest, true);
    const explicit: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) explicit.push(node.name.text);
      if (ts.isSpreadAssignment(node)) throw new Error(`${code}: use explicit translations, not English spreads`);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(keys.filter((key) => !explicit.includes(key))).toEqual([]);
  });

  it("translates statuses, content types, diagnostics and units without changing protocol values", async () => {
    await i18n.changeLanguage("fa");
    expect(statusLabel("completed")).toBe(locales.fa.translation.status_completed);
    expect(statusLabel("future_status")).toBe(locales.fa.translation.unknownStatus);
    expect(contentTypeLabel("repost")).toBe(locales.fa.translation.reposts);
    expect(contentTypeLabel("toString")).toBe(locales.fa.translation.unknownValue);
    expect(eventLabel("deletion.item.deleted")).toContain(locales.fa.translation.status_deleted);
    expect(entityLabel("repost_resolution_job")).toBe(locales.fa.translation.event_resolution);
    expect(errorLabel("Deletion estimate exceeds the configured API budget")).toBe(locales.fa.translation.budgetExceeded);
    expect(errorLabel("An unexpected provider diagnostic")).toBe(locales.fa.translation.requestFailed);
    expect(number(3450)).toBe(new Intl.NumberFormat("fa").format(3450));
    expect(currency(.01)).toBe(new Intl.NumberFormat("fa", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(.01));
  });
});

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(folder, entry.name)) : /\.tsx$/.test(entry.name) && !entry.name.includes(".test.") ? [join(folder, entry.name)] : []);
}

// Only protocol names, file formats, and the contributor-file path stay literal.
const technicalLiterals = new Set(["X", "API", "ZIP", "JSON", "CSV", "SHA-256", "ping", "pong", "locales/README.md"]);
function userFacingLiteral(text: string) {
  const value = text.replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(value) && !technicalLiterals.has(value);
}

it("keeps JSX text, accessible names and translation keys in the catalog", () => {
  const issues: string[] = [];
  for (const path of sourceFiles(join(process.cwd(), "src"))) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node, value: string) => {
      if (userFacingLiteral(value)) issues.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${value.trim()}`);
    };
    const checkExpression = (node: ts.Expression) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text);
      if (ts.isConditionalExpression(node)) { checkExpression(node.whenTrue); checkExpression(node.whenFalse); }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) checkExpression(node.right);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) report(node, node.text);
      if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) checkExpression(node.expression);
      if (ts.isJsxAttribute(node) && ["aria-label", "placeholder", "title", "alt", "description", "label"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) report(node, node.initializer.text);
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!Object.hasOwn(en, key)) issues.push(`${path}: unknown translation key ${key}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(issues).toEqual([]);
});
