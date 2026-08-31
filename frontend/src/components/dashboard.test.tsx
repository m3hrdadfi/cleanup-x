import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveTimeline } from "./archive-timeline";
import { AppShell } from "./app-shell";
import { BrandLogo } from "./brand-logo";
import { RemoveInventoryButton } from "./remove-inventory-button";
import { ConfigurationSections } from "./configuration-sections";
import { XCredentialsForm, type XSettings } from "./x-credentials-form";
import { InventoryPage } from "../pages/inventory";
import { ScanDetailPage } from "../pages/scan-detail";
import { OverviewPage } from "../pages/overview";
import { SettingsPage } from "../pages/settings";
import { SetupPage } from "../pages/setup";
import { ModelProviderSettings } from "./model-provider-settings";
import { TranslationGuide } from "./translation-guide";
import { XAccountSettings } from "./x-account-settings";
import { ArchiveSettings } from "./archive-settings";
import { NewScanPage } from "../pages/new-scan";
import { DeletionsPage } from "../pages/deletions";
import { DeletionDetailPage } from "../pages/deletion-detail";
import { AuditPage } from "../pages/audit";
import { ErrorState, LoadingState } from "./feedback";
import { Input } from "./ui/input";
import { locales, type LocaleCode } from "../locales";
import { api, postJson } from "../lib/api";
import { initializePreferences, setLocale, setTheme } from "../lib/preferences";

vi.mock("../lib/api", () => ({ api: vi.fn(() => Promise.reject(new Error("Unexpected network request"))), postJson: vi.fn(() => Promise.reject(new Error("Unexpected POST"))) }));

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  initializePreferences();
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(() => Promise.reject(new Error("Unexpected network request")));
  vi.mocked(postJson).mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { this.removeAttribute("open"); } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});

async function render(node: ReactNode, path = "/") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter key={path} initialEntries={[path]}>{node}</MemoryRouter></QueryClientProvider>));
}
function button(label: string) {
  const result = [...host.querySelectorAll("button")].find((element) => element.textContent === label);
  if (!result) throw new Error("Missing button: " + label);
  return result;
}
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

const xSettings: XSettings = { connected: false, client_id_configured: true, client_secret_configured: true, callback_url: "http://127.0.0.1:8787/api/auth/x/callback", sources: { client_id: "environment", client_secret: "environment", callback_url: "environment" } };
async function inputValue(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("redesigned dashboard interactions (isolated, no live APIs)", () => {
  it("imports an archive inside Settings without syncing or leaving the page", async () => {
    client.setQueryData(["x-status"], { configured: false, connected: false });
    client.setQueryData(["setup-coverage"], { coverage: { archive: 0 } });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/api/imports/x-archive") return { report: { imported: 3 } };
      if (path === "/api/posts?page_size=1") return { coverage: { archive: 3 } };
      throw new Error("Unexpected request");
    });
    await render(<ArchiveSettings />);
    expect(button("Sync from X").disabled).toBe(true);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["mock archive"], "archive.zip", { type: "application/zip" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 10)); });
    const request = vi.mocked(api).mock.calls.find(([path]) => path === "/api/imports/x-archive")!;
    expect((request[1]?.body as FormData).get("file")).toBeInstanceOf(File);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(postJson).not.toHaveBeenCalled();
    expect(host.querySelector('a[href="/settings#settings-connections"]')).not.toBeNull();
  });
  it("provides a real inline translation guide and download at the complete folder path", async () => {
    await render(<TranslationGuide />);
    expect(host.textContent).toContain("frontend/src/locales");
    const disclosure = host.querySelector("details")!;
    await click(disclosure.querySelector("summary")!);
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelector("pre")?.textContent).toContain("# Adding a dashboard language");
    expect(disclosure.querySelector("pre")?.getAttribute("lang")).toBe("en");
    expect(host.querySelector("a[download]")?.getAttribute("href")).toContain("README.md");
    expect(api).not.toHaveBeenCalled();
  });

  it.each(["/setup", "/setup#x-connection", "/setup#llm-provider"])("keeps the legacy %s bookmark inside the Settings workspace", async (path) => {
    await render(<Routes><Route path="/setup" element={<SetupPage />} /><Route path="/settings" element={<p>Settings destination</p>} /></Routes>, path);
    expect(host.textContent).toBe("Settings destination");
    expect(api).not.toHaveBeenCalled();
  });

  it("disconnects X and unlocks its credentials in the same subsection", async () => {
    client.setQueryData(["x-status"], { configured: true, connected: true, username: "test-owner" });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/api/auth/x/status") return { configured: true, connected: false };
      throw new Error("Unexpected request");
    });
    vi.mocked(postJson).mockResolvedValue({ disconnected: true });
    await render(<XAccountSettings settings={{ ...xSettings, connected: true }} />);
    expect(host.querySelector<HTMLInputElement>("#x-client_id")?.disabled).toBe(true);
    await click(button("Disconnect"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(postJson).toHaveBeenCalledWith("/api/auth/x/disconnect", {});
    expect(host.querySelector<HTMLInputElement>("#x-client_id")?.disabled).toBe(false);
    expect(button("Connect X")).toBeTruthy();
    expect(host.querySelector("a")).toBeNull();
  });

  it("keeps provider drafts when switching Settings subsections", async () => {
    seedSetup();
    client.setQueryData(["configuration"], { x: xSettings, fields: [], runtime: {}, environment: {}, sources: {} });
    await render(<ConfigurationSections />, "/settings#settings-model");
    await inputValue("#llm-base-url", "http://draft.test/v1");
    await act(async () => {
      host.querySelector<HTMLDetailsElement>("#settings-model")!.open = false;
      const limits = host.querySelector<HTMLDetailsElement>("#settings-limits")!;
      limits.open = true;
      limits.dispatchEvent(new Event("toggle"));
      host.querySelector<HTMLDetailsElement>("#settings-model")!.open = true;
    });
    expect(host.querySelector<HTMLInputElement>("#llm-base-url")?.value).toBe("http://draft.test/v1");
    expect(host.querySelector('a[href^="/setup"]')).toBeNull();
  });

  it("manages model settings and reopens collapsed subsections within Settings", async () => {
    seedSetup();
    client.setQueryData(["app-settings"], { api_budget_usd: 30, audit_retention_days: 0, x_credentials_configured: true, encryption_source: "local_key_file", delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001 });
    client.setQueryData(["configuration"], { x: xSettings, fields: [], runtime: {}, environment: {}, sources: {} });
    await render(<SettingsPage />, "/settings");
    expect(host.querySelector("#llm-model")).toBeNull();
    await click(host.querySelector('nav[aria-label="Settings sections"] a[href="/settings#settings-model"]')!);
    expect(host.querySelector("#llm-model")).not.toBeNull();
    expect(host.querySelector("#settings-interface")).not.toBeNull();
    const section = host.querySelector<HTMLDetailsElement>("#settings-model")!;
    await act(async () => { section.open = false; });
    await click(host.querySelector('nav[aria-label="Settings sections"] a[href="/settings#settings-model"]')!);
    expect(section.open).toBe(true);
    expect(host.querySelector('a[href^="/setup"]')).toBeNull();
    expect(host.textContent).toContain("frontend/src/locales");
  });
  it("keeps local removal in an overflow menu and still requires confirmation", async () => {
    await render(<RemoveInventoryButton compact scanId="scan-one" label="Example session" onRemoved={vi.fn()} />);
    expect(host.textContent).not.toContain("Remove locally");
    await click(host.querySelector('button[aria-label="More actions"]')!);
    const action = [...document.querySelectorAll("button")].find((element) => element.textContent === "Remove locally")!;
    expect(action).toBeTruthy();
    await click(action);
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(api).not.toHaveBeenCalled();
    await click(button("Cancel"));
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("opens grouped settings on demand, saves only changed limits and resets only those controls", async () => {
    const runtime = { max_archive_mb: 2048, max_archive_files: 20000, delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001, post_lookup_unit_cost_usd: .005 };
    const snapshot = { x: xSettings, runtime, environment: { ...runtime }, sources: Object.fromEntries(Object.keys(runtime).map((key) => [key, "environment"])), fields: [{ name: "APP_X_CLIENT_SECRET", group: "x", value: null, secret: true, configured: true }, { name: "APP_DATABASE_URL", group: "deployment", value: "sqlite", secret: false, configured: true }] };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === "/api/settings/configuration") return snapshot;
      if (path === "/api/settings/app" && init?.method === "PUT") return { ...runtime, ...JSON.parse(init.body as string) };
      throw new Error("Unexpected request");
    });
    vi.mocked(postJson).mockResolvedValueOnce(runtime);
    await render(<ConfigurationSections />);
    expect(api).not.toHaveBeenCalled();
    await act(async () => {
      const section = host.querySelector<HTMLDetailsElement>("#settings-limits")!;
      section.open = true;
      section.dispatchEvent(new Event("toggle"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(host.querySelectorAll("#settings-limits input")).toHaveLength(5));
    expect(host.textContent).toContain("APP_MAX_ARCHIVE_MB");
    expect(host.querySelector('a[href^="/setup"]')).toBeNull();
    const input = host.querySelector("#settings-limits input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "256");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { host.querySelector("#settings-limits form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const saved = vi.mocked(api).mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(saved[1]?.body as string)).toEqual({ max_archive_mb: 256 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await click(host.querySelector('#settings-limits button[type="button"]')!);
    expect(postJson).toHaveBeenCalledWith("/api/settings/app/reset", { fields: Object.keys(runtime) });
  });

  it("keeps credentials blank and saves only the replacement without rewriting env", async () => {
    vi.mocked(api).mockResolvedValue({ ...xSettings, sources: { ...xSettings.sources, client_secret: "saved" } });
    await render(<XCredentialsForm settings={xSettings} />);
    expect(host.querySelector<HTMLInputElement>("#x-client_id")?.value).toBe("");
    expect(host.querySelector<HTMLInputElement>("#x-client_secret")?.value).toBe("");
    expect(button("Save").disabled).toBe(true);
    await inputValue("#x-client_secret", "replacement-key");
    expect(button("Save").disabled).toBe(false);
    await click(button("Save"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(api).toHaveBeenCalledWith("/api/settings/x", { method: "PUT", body: JSON.stringify({ client_secret: "replacement-key" }) });
    expect(host.querySelector<HTMLInputElement>("#x-client_secret")?.value).toBe("");
    expect(host.textContent).toContain("Used for the next X connection");
    expect(host.textContent).not.toContain("replacement-key");
  });

  it("opens the credentials subsection directly from the Setup link", async () => {
    client.setQueryData(["configuration"], { x: xSettings, fields: [], runtime: {}, environment: {}, sources: {} });
    client.setQueryData(["x-status"], { configured: true, connected: false });
    await render(<ConfigurationSections />, "/settings#settings-connections");
    expect(host.querySelector<HTMLDetailsElement>("#settings-connections")?.open).toBe(true);
    expect(host.querySelector("#x-client_id")).not.toBeNull();
    expect(host.querySelector("#x-client_secret")).not.toBeNull();
    expect(host.querySelector("#x-callback_url")).not.toBeNull();
  });

  it("blocks credential editing while connected without redirecting elsewhere", async () => {
    await render(<XCredentialsForm settings={{ ...xSettings, connected: true }} />);
    expect([...host.querySelectorAll("input")].every((input) => input.disabled)).toBe(true);
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    expect(host.textContent).toContain("Use Disconnect above");
    expect(host.querySelector('a[href^="/setup"]')).toBeNull();
    expect(api).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("resets one OAuth override without discarding an unrelated draft", async () => {
    vi.mocked(postJson).mockResolvedValue(xSettings);
    await render(<XCredentialsForm settings={{ ...xSettings, sources: { ...xSettings.sources, client_secret: "saved" } }} />);
    await inputValue("#x-client_id", "draft-id");
    await click(host.querySelector('[aria-label="Reset Client secret to env"]')!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(postJson).toHaveBeenCalledWith("/api/settings/x/reset", { fields: ["client_secret"] });
    expect(host.querySelector<HTMLInputElement>("#x-client_id")?.value).toBe("draft-id");
  });

  it("keeps credential edits available after a failed save", async () => {
    vi.mocked(api).mockRejectedValue(new Error("Save failed"));
    await render(<XCredentialsForm settings={xSettings} />);
    await inputValue("#x-client_id", "draft-id");
    await click(button("Save"));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.querySelector<HTMLInputElement>("#x-client_id")?.value).toBe("draft-id");
    expect(button("Save").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it.each([undefined, "post-one"])("confirms local-only removal for session/item %s without X deletion", async (postId) => {
    const onRemoved = vi.fn();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let finish!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(<RemoveInventoryButton scanId="scan-one" postId={postId} label="Original source content" onRemoved={onRemoved} />);
    await click(button("Remove locally"));
    expect(host.querySelector("dialog")?.open).toBe(true);
    expect(host.textContent).toContain("Nothing is deleted from X.");
    expect(api).not.toHaveBeenCalled();
    await click(button("Cancel"));
    expect(host.querySelector("dialog")).toBeNull();
    expect(api).not.toHaveBeenCalled();
    await click(button("Remove locally"));
    await click(host.querySelector("dialog button:last-child")!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const [path, request] = vi.mocked(api).mock.calls[0];
    expect(path).toBe(`/api/inventory/sessions/scan-one${postId ? "/items/post-one" : ""}`);
    expect(request?.method).toBe("DELETE");
    expect(JSON.parse(request?.body as string)).toEqual({ confirmed: true });
    expect(new Headers(request?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(host.querySelector("dialog button:last-child")?.hasAttribute("disabled")).toBe(true);
    expect(postJson).not.toHaveBeenCalled();
    await act(async () => { finish({ removed: true, local_only: true }); });
    await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(host.querySelector("dialog")).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["posts"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["scans"] });
  });

  it("keeps failed local removal open and reuses the idempotency key on retry", async () => {
    const onRemoved = vi.fn();
    vi.mocked(api).mockRejectedValueOnce(new Error("Finish or cancel active jobs before removing inventory"));
    vi.mocked(api).mockResolvedValueOnce({ removed: true, local_only: true });
    await render(<RemoveInventoryButton scanId="scan-one" label="Session" onRemoved={onRemoved} />);
    await click(button("Remove locally"));
    await click(host.querySelector("dialog button:last-child")!);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(host.textContent).toContain(locales.en.translation.inventoryRemovalActive);
    expect(onRemoved).not.toHaveBeenCalled();
    await click(host.querySelector("dialog button:last-child")!);
    await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(new Headers(vi.mocked(api).mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(vi.mocked(api).mock.calls[1][1]?.headers).get("Idempotency-Key"));
  });

  it("uses the supplied logos with theme-aware visibility and compact mobile framing", async () => {
    await render(<><BrandLogo /><BrandLogo compact /></>);
    const logos = host.querySelectorAll('svg[role="img"]');
    expect(logos).toHaveLength(2);
    expect(logos[0].getAttribute("aria-label")).toBe(locales.en.translation.appName);
    expect(logos[0].getAttribute("viewBox")).not.toBe(logos[1].getAttribute("viewBox"));
    expect(host.querySelector('image[href="/branding/light-logo.png"]')?.getAttribute("class")).toBe("dark:hidden");
    expect(host.querySelector('image[href="/branding/dark-logo.png"]')?.getAttribute("class")).toBe("hidden dark:block");
    await act(async () => setTheme("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => setTheme("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  function seedSetup(model = "test-model") {
    client.setQueryData(["x-status"], { configured: false, connected: false });
    client.setQueryData(["setup-coverage"], { coverage: { archive: 0 } });
    client.setQueryData(["llm-settings"], { provider: "openai_compatible", base_url: "http://fake.test/v1", model, api_key: "", timeout_seconds: 120, batch_size: 4, vision_enabled: false });
  }

  it("opens a pending ping dialog, allows reopening without duplicate requests, and shows pong", async () => {
    seedSetup();
    let resolve!: (value: unknown) => void;
    vi.mocked(postJson).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render(<ModelProviderSettings />);
    await click(button("Test connection"));
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(host.textContent).toContain("Ping sent… waiting for pong");
    await click(button("Close"));
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    await click(button("View connection check"));
    expect(postJson).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ ok: true, reply: "pong", structured_output: true, model: "test-model", provider: "openai_compatible", base_url: "http://fake.test/v1", latency_ms: 234, capabilities: [] }); await new Promise((done) => setTimeout(done, 0)); });
    await vi.waitFor(() => expect(host.textContent).toContain("Pong! Connection successful"));
    expect(host.textContent).toContain("234 ms");
    await act(async () => { host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(host.querySelector("dialog")?.hasAttribute("open")).toBe(false);
  });

  it("shows failed checks and retry, and rejects an HTTP-success response without pong", async () => {
    seedSetup();
    vi.mocked(postJson).mockRejectedValueOnce(new Error("Provider returned HTTP 401. Check your API key."));
    await render(<ModelProviderSettings />);
    await click(button("Test connection"));
    await vi.waitFor(() => expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain("HTTP 401"));
    vi.mocked(postJson).mockResolvedValueOnce({ ok: true, structured_output: true });
    await click(button("Send another ping"));
    await vi.waitFor(() => expect(host.querySelector('dialog [role="alert"]')?.textContent).toContain("expected pong"));
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Pong! Connection successful");
    expect(api).not.toHaveBeenCalled();
  });
  it("switches timeline periods and exposes exact data including missing months", async () => {
    await render(<ArchiveTimeline values={[{ month: "2025-12", count: 10 }, { month: "2026-02", count: 7 }]} />);
    expect(button("Monthly").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(host.querySelector('svg[role="slider"]')?.getAttribute("aria-valuetext")).toContain("December 2025: 10");
    expect(host.querySelector('input[type="range"]')).toBeNull();
    await click(button("Yearly"));
    expect(button("Yearly").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.querySelector('svg[role="slider"]')?.getAttribute("aria-valuetext")).toContain("2025: 10");
    expect(host.innerHTML).not.toContain("NaN");
  });

  it("explores the chart directly with keyboard and touch without a separate bar", async () => {
    await render(<ArchiveTimeline values={[{ month: "2026-01", count: 10 }, { month: "2026-03", count: 7 }]} />);
    const chart = host.querySelector('svg[role="slider"]')!;
    const key = async (name: string) => { await act(async () => { chart.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); }); };
    await key("ArrowRight");
    expect(chart.getAttribute("aria-valuetext")).toContain("February 2026: 0");
    await key("End");
    expect(chart.getAttribute("aria-valuenow")).toBe("2");
    await key("ArrowRight");
    expect(chart.getAttribute("aria-valuenow")).toBe("2");
    await key("Home");
    await key("ArrowLeft");
    expect(chart.getAttribute("aria-valuenow")).toBe("0");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 680, bottom: 220, width: 680, height: 220, toJSON: () => ({}) });
    await act(async () => { chart.dispatchEvent(new MouseEvent("pointerdown", { clientX: 650, bubbles: true })); });
    expect(chart.getAttribute("aria-valuetext")).toContain("March 2026: 7");
    expect(host.querySelector('input[type="range"]')).toBeNull();
  });

  it("supports one month, zero counts, and an empty chart", async () => {
    await render(<ArchiveTimeline values={[{ month: "2026-08", count: 0 }]} />);
    expect(host.innerHTML).not.toContain("NaN");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    await render(<ArchiveTimeline values={[]} />);
    expect(host.textContent).toContain("No records yet");
  });

  it("changes direction through the language selector without manual controls", async () => {
    client.setQueryData(["app-settings"], { api_budget_usd: 30, audit_retention_days: 0, x_credentials_configured: true, encryption_source: "local_key_file", delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001 });
    await render(<Routes><Route element={<AppShell />}><Route path="/settings" element={<SettingsPage />} /></Route></Routes>, "/settings");
    for (const locale of ["fa", "en", "fa", "sv"] as const) {
      const select = host.querySelector("select")!;
      await act(async () => { select.value = locale; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(document.documentElement.lang).toBe(locale);
      expect(document.documentElement.dir).toBe(locales[locale].direction);
      expect(host.querySelector(".direction-switch")).toBeNull();
      expect([...host.querySelectorAll("button")].some((element) => ["LTR", "RTL", locales[locale].translation.ltr, locales[locale].translation.rtl].includes(element.textContent || ""))).toBe(false);
    }
    // A locale change from a second tab must also update the current document.
    await act(async () => {
      localStorage.setItem("cleanup-locale", "fa");
      window.dispatchEvent(new StorageEvent("storage", { key: "cleanup-locale", newValue: "fa" }));
    });
    expect(document.documentElement.lang).toBe("fa");
    expect(document.documentElement.dir).toBe("rtl");
    expect(host.querySelector("select")?.value).toBe("fa");
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps Inventory as sessions only, and opens tweets only inside a session", async () => {
    const scan = { id: "scan-one", prompt: "Find technology posts", status: "completed", processed: 3347, total: 3347, created_at: "2026-08-27T12:00:00Z", policy: { target_topic: "Technology" }, counts: { matches: 2687, selected: 2501, failed: 28 } };
    client.setQueryData(["scans", 1], { items: [scan], total: 1, page: 1, page_size: 25 });
    client.setQueryData(["posts", 1, "", "", scan.id, ""], { items: [{ id: "post-one", text: "A full technology post", content_type: "post", language: "en", from_archive: true }], total: 1, page: 1, page_size: 50, scan });
    await render(<Routes><Route path="/inventory" element={<InventoryPage />} /><Route path="/inventory/:scanId" element={<InventoryPage />} /></Routes>, "/inventory");
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.querySelector('button[aria-label="More actions"]')).not.toBeNull();
    expect(host.textContent).toContain("3,347/3,347");
    expect(host.textContent).not.toContain("A full technology post");
    expect(host.querySelector('input[placeholder="Search posts"]')).toBeNull();
    const view = host.querySelector('a[href="/inventory/scan-one"]')!;
    await click(view);
    expect(host.textContent).toContain("A full technology post");
    expect(host.querySelector('button[aria-label="More actions"]')).not.toBeNull();
    expect(host.querySelector('input[placeholder="Search posts"]')).not.toBeNull();
    await click(button("View"));
    expect(host.querySelector('button[aria-expanded="true"]')?.textContent).toContain("Close");
    await click(host.querySelector('a[href="/inventory"]')!);
    expect(host.textContent).not.toContain("A full technology post");
    expect(api).not.toHaveBeenCalled();
  });

  it("opens the same inventory session's deletion review without creating a deletion", async () => {
    const scan = { id: "review-session", prompt: "Find technology posts", status: "completed", processed: 5, total: 5, policy: { target_topic: "Technology" }, counts: { selected: 2, matches: 2 } };
    client.setQueryData(["posts", 1, "", "", scan.id, ""], { items: [], total: 0, page: 1, page_size: 50, scan });
    client.setQueryData(["scan", scan.id], scan);
    client.setQueryData(["scan-results", scan.id], { items: [], total: 0 });
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
    await render(<Routes><Route path="/inventory/:scanId" element={<InventoryPage />} /><Route path="/scans/:id" element={<ScanDetailPage />} /></Routes>, "/inventory/review-session");
    const link = host.querySelector('a[href="/scans/review-session?review=deletion"]')!;
    expect(link.textContent).toContain("Review deletion");
    expect(host.textContent).toContain("Table filters do not change the saved selection");
    await click(link);
    const review = host.querySelector('aside[aria-label="Prepare deletion"]');
    expect(document.activeElement).toBe(review);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(review?.textContent).toContain("2");
    expect(review?.querySelector("input")?.value).toBe("");
    expect(button("Start deletion").disabled).toBe(true);
    expect(postJson).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it.each(["running", "failed", "cancelled"])("does not offer deletion navigation for a %s scan", async (status) => {
    client.setQueryData(["posts", 1, "", "", "not-ready", ""], { items: [], total: 0, page: 1, page_size: 50, scan: { id: "not-ready", status, processed: 0, total: 10, prompt: "A scan", policy: { target_topic: "Topic" } } });
    await render(<Routes><Route path="/inventory/:scanId" element={<InventoryPage />} /></Routes>, "/inventory/not-ready");
    expect(button("Review deletion").disabled).toBe(true);
    expect(host.querySelector('a[href*="review=deletion"]')).toBeNull();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("does not show a session deletion action in the unfiltered archive", async () => {
    client.setQueryData(["posts", 1, "", "", "all", ""], { items: [], total: 0, page: 1, page_size: 50, coverage: {}, complete_history: false });
    await render(<Routes><Route path="/inventory/:scanId" element={<InventoryPage />} /></Routes>, "/inventory/all");
    expect(host.textContent).not.toContain("Review deletion");
    expect(postJson).not.toHaveBeenCalled();
  });

  it("renders the overview with sparse analytics without guessing peak activity", async () => {
    client.setQueryData(["overview"], { summary: { total: 1, remaining: 1, deleted: 0, span_days: 0, active_days: 0, average_per_active_day: 0, average_characters: 0, media_posts: 0 }, coverage: { archive_only: 1, archive_and_api: 0 }, content_types: [{ key: "post", count: 1 }], languages: [], timeline: [], weekdays: [], hours: [], hashtags: [], mentions: [], cleanup: { deletion_jobs: 0, unresolved_reposts: 0 } });
    await render(<OverviewPage />);
    expect(host.textContent).toContain("Your archive, at a glance");
    expect(host.innerHTML).not.toContain("NaN");
    expect(host.textContent).toContain("not a live count on X");
    expect(api).not.toHaveBeenCalled();
  });

  it("retains six languages, Persian RTL and independent appearance controls", async () => {
    client.setQueryData(["app-settings"], { api_budget_usd: 30, audit_retention_days: 0, x_credentials_configured: true, encryption_source: "local_key_file", delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001 });
    await render(<SettingsPage />);
    expect(host.querySelectorAll("select option")).toHaveLength(Object.keys(locales).length);
    await click(button("Dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => setLocale("fa"));
    expect(document.documentElement.dir).toBe("rtl");
    expect(host.querySelector("select")?.value).toBe("fa");
    expect(api).not.toHaveBeenCalled();
  });

  it.each(Object.keys(locales) as LocaleCode[])("renders settings, analytics, setup and scan controls in %s", async (code) => {
    await act(async () => setLocale(code));
    const copy = locales[code].translation;
    client.setQueryData(["app-settings"], { api_budget_usd: 30, audit_retention_days: 0, x_credentials_configured: true, encryption_source: "local_key_file", delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001 });
    await render(<SettingsPage />);
    for (const key of ["protectedLocal", "themeHelp", "costStorage", "budgetTitle", "retentionTitle", "securityStatus", "localKeyFile"] as const) expect(host.textContent).toContain(copy[key]);
    expect(document.documentElement.dir).toBe(locales[code].direction);
    expect(host.querySelector("select")?.value).toBe(code);

    await render(<XCredentialsForm settings={{ ...xSettings, connected: true }} />);
    for (const key of ["xCredentialsTitle", "xClientId", "xClientSecret", "xCallbackUrl", "xDisconnectToEdit"] as const) expect(host.textContent).toContain(copy[key]);

    client.setQueryData(["overview"], { summary: { total: 3450, remaining: 3440, deleted: 10, span_days: 0, active_days: 0, average_per_active_day: 0, average_characters: 123, media_posts: 490 }, coverage: { archive_only: 3450 }, content_types: [{ key: "repost", count: 3450 }], languages: [{ key: "fa", count: 3450 }], timeline: [{ month: "2026-01", count: 3450 }], weekdays: [], hours: [], hashtags: [], mentions: [], cleanup: { deletion_jobs: 1, unresolved_reposts: 0 } });
    await render(<OverviewPage />);
    for (const key of ["archivePosts", "historySpan", "archiveTimeline", "postingFingerprint", "contentMix", "languageMix", "activityRhythm", "reposts"] as const) expect(host.textContent).toContain(copy[key]);
    expect(host.textContent).toContain(new Intl.NumberFormat(code).format(3450));
    expect(host.innerHTML).not.toContain("NaN");

    seedSetup("");
    await render(<ModelProviderSettings />);
    for (const key of ["nativeOllama", "resetEnv", "selectModel", "loadModels"] as const) expect(host.textContent).toContain(copy[key]);
    expect(host.querySelector("#llm-api-key")?.getAttribute("placeholder")).toBe(copy.enterKeyFirst);
    client.setQueryData(["scans"], { items: [] });
    await render(<NewScanPage />);
    for (const key of ["postsToScan", "allEligiblePosts", "trialScanHelp", "compilePolicy"] as const) expect(host.textContent).toContain(copy[key]);
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(host.querySelector("textarea")?.placeholder).toBe(copy.promptExample);
    expect(button(copy.compilePolicy).hasAttribute("disabled")).toBe(true);
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(postJson).not.toHaveBeenCalled();

    const scan = { id: "localized", status: "completed", created_at: "2026-08-27T12:00:00Z", prompt: "Keep this original prompt", policy: { target_topic: "Original topic" }, processed: 2, total: 2, counts: { selected: 1, matches: 1, non_matches: 1, failed: 0 } };
    client.setQueryData(["scans", 1], { items: [scan], total: 1, page: 1, page_size: 25 });
    await render(<InventoryPage />, "/inventory");
    expect(host.textContent).toContain(copy.status_completed);
    expect(host.textContent).toContain(scan.prompt);
    client.setQueryData(["scan", scan.id], scan);
    client.setQueryData(["scan-results", scan.id], { items: [{ post_id: "untouched-id", text: "Original tweet متن اصلی", content_type: "repost", detected_language: "fa", matches: true, selected: true, confidence: .95, reason_en: "Original model explanation", status: "classified" }] });
    await render(<Routes><Route path="/scans/:id" element={<ScanDetailPage />} /></Routes>, "/scans/localized");
    expect(host.textContent).toContain(copy.reposts);
    expect(host.textContent).toContain("Original tweet متن اصلی");
    expect(host.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toContain("untouched-id");
    expect(button(copy.confirmDelete).disabled).toBe(true);

    const job = { id: "job-localized", status: "completed", created_at: "2026-08-27T12:00:00Z", total: 2, processed: 2, succeeded: 2, failed: 0, retryable: 0, estimated_cost_usd: .02, manifest_sha256: "original-hash", failures: [] };
    client.setQueryData(["deletions", 1], { items: [job], total: 1, page: 1, page_size: 25 });
    await render(<DeletionsPage />);
    expect(host.textContent).toContain(copy.status_completed);
    client.setQueryData(["deletion", job.id], job);
    await render(<Routes><Route path="/deletions/:id" element={<DeletionDetailPage />} /></Routes>, "/deletions/job-localized");
    expect(host.textContent).toContain(copy.jobControls);
    expect(host.textContent).toContain(copy.manifest);
    client.setQueryData(["audit"], { items: [{ id: "event", created_at: job.created_at, event_type: "deletion.item.deleted", entity_type: "post", entity_id: "original-id", details: {} }] });
    await render(<AuditPage />);
    expect(host.textContent).toContain(copy.event_deleted);
    expect(host.textContent).toContain(copy.entity_post);
    expect(api).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("localizes shared feedback while preserving original diagnostics", async () => {
    await act(async () => setLocale("fa"));
    await render(<><LoadingState /><ErrorState message="Deletion estimate exceeds the configured API budget" /><ErrorState message="Provider-specific diagnostic 123" /></>);
    expect(host.textContent).toContain(locales.fa.translation.loading);
    expect(host.textContent).toContain(locales.fa.translation.budgetExceeded);
    expect(host.querySelector("summary")?.textContent).toBe(locales.fa.translation.technicalDetails);
    expect(host.textContent).toContain("Provider-specific diagnostic 123");
  });

  it("localizes native input validation and clears it after editing", async () => {
    await act(async () => setLocale("fa"));
    await render(<Input type="number" min="1" defaultValue="0" />);
    const input = host.querySelector("input")!;
    await act(async () => { expect(input.checkValidity()).toBe(false); });
    expect(input.validationMessage).toBe(locales.fa.translation.invalidRequest);
    await act(async () => { input.value = "2"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(input.checkValidity()).toBe(true);
  });
});
