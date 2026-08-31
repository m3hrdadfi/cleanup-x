import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, postJson } from "../lib/api";
import i18n from "../i18n";
import { EmbeddingSettingsPanel } from "./embedding-settings";
import { ModelCombobox } from "./model-combobox";
import { SearchPage } from "../pages/search";
import { SemanticResults, type SearchResult } from "./semantic-results";

vi.mock("../lib/api", () => ({ api: vi.fn(), postJson: vi.fn() }));
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
const config = { provider: "ollama", base_url: "http://embedding.test", model: "multilingual-embed", api_key_configured: true, batch_size: 16, timeout_seconds: 120, query_prefix: "", document_prefix: "", tested: true, dimensions: 2, sources: {} };
const status = { eligible: 3, indexed: 2, pending: 1, ready: true, model: "multilingual-embed", base_url: "http://embedding.test", job: null };

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("en");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  vi.mocked(api).mockReset(); vi.mocked(postJson).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/api/settings/embedding") return config;
    if (path === "/api/search/index") return status;
    throw new Error("Unexpected request");
  });
  vi.mocked(postJson).mockImplementation(async () => { throw new Error("Unexpected POST"); });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
async function render(node: ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>));
  await settle();
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((element) => element.textContent === label);
  if (!found) throw new Error("Missing button: " + label);
  return found;
}
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); await settle(); }
async function input(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}

it("keeps the API key before model selection and discovers models with the current draft only on request", async () => {
  vi.mocked(postJson).mockResolvedValue({ models: ["embed-one"] });
  await render(<EmbeddingSettingsPanel />);
  expect(postJson).not.toHaveBeenCalled();
  const key = host.querySelector('input[type="password"]')!;
  const model = host.querySelector('#embedding-model')!;
  expect(key.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect((key as HTMLInputElement).value).toBe("");
  await input('input[type="password"]', "draft-secret");
  await click(button("Load models"));
  expect(postJson).toHaveBeenCalledWith("/api/settings/embedding/models", { api_key: "draft-secret" });
  expect(host.textContent).not.toContain("draft-secret");
});

it("shows dimensions, latency and the save-first warning when a draft test passes", async () => {
  vi.mocked(postJson).mockResolvedValue({ ok: true, dimensions: 768, latency_ms: 45, saved_settings_tested: false });
  await render(<EmbeddingSettingsPanel />);
  await click(button("Test connection"));
  expect(host.textContent).toContain("768 dimensions");
  expect(host.textContent).toContain("45 ms");
  expect(host.textContent).toContain("Save your embedding settings");
  expect(host.textContent).toContain("not search quality");
  expect(host.querySelector("dialog[open]")).not.toBeNull();
  expect(host.querySelector("dialog")?.textContent).not.toContain("pong");
});

it("matches the LLM form width, field order, individual resets and action order", async () => {
  await render(<EmbeddingSettingsPanel />);
  expect(host.querySelector(".max-w-3xl")).not.toBeNull();
  const fieldset = host.querySelector("fieldset")!;
  expect(fieldset.className).not.toContain("grid-cols-2");
  const fields = ["embedding-base-url", "embedding-api-key", "embedding-model"].map((id) => host.querySelector(`#${id}`)!);
  expect(fields[0].compareDocumentPosition(fields[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fields[1].compareDocumentPosition(fields[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.querySelectorAll('button[aria-label^="Reset "]').length).toBe(3);
  expect(host.textContent).toContain("APP_EMBEDDING_API_KEY");
  expect(host.querySelector("details")?.open).toBe(false);
  const actions = [...host.querySelectorAll("form > div:last-child button")].map((element) => element.textContent);
  expect(actions).toEqual(["Save", "Test connection", "Reset all to env"]);
});

it("resets only the requested field and retains unrelated unsaved input", async () => {
  vi.mocked(postJson).mockResolvedValue({ ...config, base_url: "http://env.test", sources: { base_url: "environment" } });
  await render(<EmbeddingSettingsPanel />);
  await input("#embedding-api-key", "unsaved-key");
  await click(host.querySelector('button[aria-label="Reset Base URL to env"]')!);
  expect(postJson).toHaveBeenCalledWith("/api/settings/embedding/reset", { fields: ["base_url"] });
  expect(host.querySelector<HTMLInputElement>("#embedding-base-url")?.value).toBe("http://env.test");
  expect(host.querySelector<HTMLInputElement>("#embedding-api-key")?.value).toBe("unsaved-key");
  expect(button("Save").disabled).toBe(false);
});

it("shows authentication failure in the dialog and retries the embedding endpoint only", async () => {
  vi.mocked(postJson).mockRejectedValue(new Error("Embedding provider returned HTTP 401"));
  await render(<EmbeddingSettingsPanel />);
  await click(button("Test connection"));
  expect(host.querySelector("dialog[open]")?.textContent).toContain("HTTP 401");
  expect(host.querySelector("dialog")?.textContent).toContain("Connection check unsuccessful");
  await click(button("Test again"));
  expect(vi.mocked(postJson).mock.calls.map(([path]) => path)).toEqual(["/api/settings/embedding/test", "/api/settings/embedding/test"]);
  await click(button("Close"));
  expect(host.querySelector("dialog[open]")).toBeNull();
});

it("allows closing and reopening a pending check without sending it twice", async () => {
  let finish!: (result: unknown) => void;
  vi.mocked(postJson).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await render(<EmbeddingSettingsPanel />);
  await click(button("Test connection"));
  expect(host.querySelector("dialog[open]")?.textContent).toContain("Waiting for embedding vectors");
  await click(button("Close"));
  await click(button("View connection check"));
  expect(postJson).toHaveBeenCalledTimes(1);
  expect(host.querySelector("dialog[open]")).not.toBeNull();
  await act(async () => finish({ ok: true, dimensions: 2, latency_ms: 4, saved_settings_tested: true }));
  await settle();
});

it("requires explicit consent before indexing and never starts search on mount", async () => {
  vi.mocked(postJson).mockResolvedValue({ id: "index-1" });
  await render(<SearchPage />);
  expect(postJson).not.toHaveBeenCalled();
  expect(button("Index 1 posts").disabled).toBe(true);
  expect(host.querySelector('a[href="/settings#settings-embedding"]')).not.toBeNull();
  await click(host.querySelector('input[type="checkbox"]')!);
  expect(button("Index 1 posts").disabled).toBe(false);
  await click(button("Index 1 posts"));
  expect(postJson).toHaveBeenCalledWith("/api/search/index", { confirmed: true }, true);
  expect(button("Index 1 posts").disabled).toBe(true);
});

it("renders complete result context and similarity without deletion controls", async () => {
  const content = "A long post about learning new skills.\n\nQuoted context in full.";
  vi.mocked(postJson).mockResolvedValue({ mode: "hybrid", candidates: 3, indexed_candidates: 2, total: 1, items: [{ id: "post-1", text: "A long post", context: content, language: "en", content_type: "post", posted_at: "2025-01-01T00:00:00Z", similarity: .82 }] });
  await render(<SearchPage />);
  await input('input[maxlength="2000"]', "learning a skill");
  await click(button("Search posts"));
  expect(postJson).toHaveBeenCalledWith("/api/search", expect.objectContaining({ query: "learning a skill", mode: "hybrid", limit: 25 }));
  expect(host.textContent).toContain(content);
  expect(host.textContent).toContain("Cosine similarity 0.82");
  expect(host.textContent).toContain("2 compared semantically");
  expect([...host.querySelectorAll("button")].some((element) => /delet/i.test(element.textContent || ""))).toBe(false);
});

it("keeps keyword search available before an embedding provider is ready", async () => {
  client.setQueryData(["semantic-index"], { ...status, ready: false });
  await render(<SearchPage />);
  await input('input[maxlength="2000"]', "hello");
  expect(button("Search posts").disabled).toBe(true);
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "keyword"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(button("Search posts").disabled).toBe(false);
});

it("renders paused indexing errors with resume and cancel controls", async () => {
  client.setQueryData(["semantic-index"], { ...status, job: { id: "paused-job", status: "paused", total: 3, processed: 1, indexed: 1, skipped: 0, error: "Embedding provider returned HTTP 429" } });
  vi.mocked(postJson).mockResolvedValue({});
  await render(<SearchPage />);
  expect(button("Resume")).toBeTruthy();
  expect(button("Cancel")).toBeTruthy();
  await click(button("Resume"));
  expect(postJson).toHaveBeenCalledWith("/api/search/index/paused-job/resume", {});
});

it("renders Persian search labels and independent combobox IDs", async () => {
  await i18n.changeLanguage("fa");
  await render(<><SearchPage /><ModelCombobox id="chat" models={[]} value="" onChange={() => {}} /><ModelCombobox id="embed" models={[]} value="" onChange={() => {}} /></>);
  expect(host.textContent).toContain("جستجوی آرشیو");
  const ids = [...host.querySelectorAll('[role="combobox"]')].map((element) => element.getAttribute("aria-controls"));
  expect(new Set(ids).size).toBe(2);
  expect(host.querySelector('input[maxlength="2000"]')?.getAttribute("dir")).toBe("auto");
});

const searchResults: SearchResult = {
  mode: "hybrid", candidates: 3440, indexed_candidates: 3440, total: 3440,
  items: [
    { id: "1305142745837850626", text: "First", context: "First ParsBERT result.\n\nComplete original context.", language: "en", content_type: "post", posted_at: "2020-09-13T00:00:00Z", similarity: .662 },
    { id: "1266316957063819264", text: "Second", context: "Second ParsBERT result has higher similarity.", language: "en", content_type: "repost", posted_at: "2020-05-29T00:00:00Z", similarity: .788 },
    { id: "third", text: "Third", context: "Third keyword-only result.", language: "en", content_type: "reply", posted_at: null, similarity: null },
  ],
};

it("keeps hybrid order distinct from similarity and sorts only returned results", async () => {
  await render(<SemanticResults data={searchResults} query="ParsBERT" />);
  const firstRow = () => host.querySelector('ol li button')!;
  expect(firstRow().textContent).toContain("First ParsBERT");
  expect(host.textContent).toContain("highest cosine score may not appear first");
  expect(host.querySelector("article")?.textContent).toContain("Complete original context.");
  const select = host.querySelector("select")!;
  await act(async () => { select.value = "similarity"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(firstRow().textContent).toContain("Second ParsBERT");
  expect(host.querySelector("article")?.textContent).toContain("Second ParsBERT");
  expect([...host.querySelectorAll("ol li")].at(-1)?.textContent).toContain("keyword-only");
  await act(async () => { select.value = "newest"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(firstRow().textContent).toContain("First ParsBERT");
  expect(api).not.toHaveBeenCalled(); expect(postJson).not.toHaveBeenCalled();
});

it("navigates the reader without changing the archive and exposes a safe X link", async () => {
  await render(<SemanticResults data={searchResults} query="ParsBERT" />);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Previous"]')?.disabled).toBe(true);
  await click(host.querySelector('button[aria-label="Next"]')!);
  expect(host.querySelector("article")?.textContent).toContain("Second ParsBERT");
  expect(host.querySelector('ol button[aria-pressed="true"]')?.textContent).toContain("Second ParsBERT");
  const link = host.querySelector<HTMLAnchorElement>("article a")!;
  expect(link.href).toBe("https://x.com/i/status/1266316957063819264");
  expect(link.rel).toContain("noopener"); expect(link.target).toBe("_blank");
  await click(host.querySelector('button[aria-label="Next"]')!);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.disabled).toBe(true);
  expect(host.querySelector("article a")).toBeNull();
  expect(postJson).not.toHaveBeenCalled();
});

it("highlights literal words safely without interpreting post markup", async () => {
  const context = '<script>alert("ParsBERT")</script>\nActual ParsBERT text.';
  await render(<SemanticResults data={{ ...searchResults, items: [{ ...searchResults.items[0], context }] }} query="ParsBERT" />);
  expect(host.querySelector("article p[dir=auto]")?.textContent).toBe(context);
  expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector("article mark")?.textContent).toBe("ParsBERT");
  await click(host.querySelector('article input[type="checkbox"]')!);
  expect(host.querySelector("mark")).toBeNull();
  expect(host.querySelector("article p[dir=auto]")?.textContent).toBe(context);
});

it("copies original full text rather than highlighted markup and handles clipboard failure", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await render(<SemanticResults data={searchResults} query="ParsBERT" />);
  await click(button("Copy text"));
  expect(writeText).toHaveBeenCalledWith(searchResults.items[0].context);
  expect(host.querySelector('article [role="status"]')?.textContent).toBe("Text copied");
  await click(host.querySelector('button[aria-label="Next"]')!);
  writeText.mockRejectedValue(new Error("denied"));
  await click(button("Copy text"));
  expect(host.querySelector('article [role="status"]')?.textContent).toContain("copy it manually");
});

it("renders empty results and Persian content without a fabricated score", async () => {
  await render(<SemanticResults data={{ ...searchResults, items: [] }} query="none" />);
  expect(host.textContent).toContain("No results in this scope");
  expect(host.querySelector("article")).toBeNull();
  await act(async () => { await i18n.changeLanguage("fa"); });
  await render(<SemanticResults data={{ ...searchResults, items: [{ ...searchResults.items[2], language: "fa", context: "مدل فارسی پارس‌برت" }] }} query="فارسی" />);
  expect(host.querySelector("article p[dir=auto]")?.textContent).toBe("مدل فارسی پارس‌برت");
  expect(host.textContent).toContain("تطابق واژه");
  expect(host.textContent).not.toContain("Cosine similarity");
  expect(host.querySelector("article mark")?.textContent).toBe("فارسی");
});

it("shows the completed index without an unnecessary consent checkbox or zero-item action", async () => {
  client.setQueryData(["semantic-index"], { ...status, indexed: 3, pending: 0 });
  await render(<SearchPage />);
  expect(host.textContent).toContain("Local index is up to date");
  expect(host.textContent).not.toContain("Index 0 posts");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(host.querySelector("details")?.textContent).toContain("Index details and privacy");
  expect(postJson).not.toHaveBeenCalled();
});
