import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/api/health")) return route.fulfill({ json: { ok: true } });
    if (url.endsWith("/api/auth/x/status")) return route.fulfill({ json: { configured: true, connected: true, username: "owner" } });
    if (url.endsWith("/api/settings/llm")) return route.fulfill({ json: { provider: "ollama", base_url: "http://127.0.0.1:11434", model: "qwen2.5:7b", api_key: "", timeout_seconds: 120, batch_size: 10, vision_enabled: false } });
    if (url.endsWith("/api/settings/app")) return route.fulfill({ json: { api_budget_usd: 30, audit_retention_days: 0, x_credentials_configured: true, encryption_source: "local_key_file", delete_unit_cost_usd: .01, owned_read_unit_cost_usd: .001 } });
    if (url.endsWith("/api/settings/llm/models")) return route.fulfill({ json: { provider: "ollama", models: ["qwen2.5:7b", "gemma3:12b"] } });
    if (url.endsWith("/api/overview")) return route.fulfill({ json: { summary: { total: 3450, remaining: 3440, deleted: 10, first_post: "2011-12-23T09:04:32Z", last_post: "2026-03-20T16:50:12Z", span_days: 5203, active_days: 1900, average_per_active_day: 1.8, average_characters: 96, media_posts: 420 }, coverage: { archive_only: 3100, archive_and_api: 350 }, content_types: [{ key: "repost", count: 2954 }, { key: "post", count: 375 }, { key: "reply", count: 121 }], languages: [{ key: "fa", count: 2650 }, { key: "en", count: 697 }], timeline: [{ month: "2011-12", count: 2 }, { month: "2012-01", count: 20 }, { month: "2026-03", count: 8 }], years: [{ year: "2011", count: 2 }, { year: "2026", count: 8 }], weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day, index) => ({ day, count: 80 + index * 10 })), hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 20 + hour })), top_dates: [{ date: "2020-01-01", count: 12 }], hashtags: [{ name: "iran", count: 90 }], mentions: [{ name: "x", count: 30 }], latest_scan: { id: "scan-1", prompt: "Delete political posts", threshold: .85, classified: 3347, selected: 2501, selection_rate: .747, failed: 0, confidence: [{ key: "low", count: 500 }, { key: "uncertain", count: 346 }, { key: "high", count: 2501 }], topics: [{ key: "politics", count: 2501 }] }, cleanup: { deletion_jobs: 1, unresolved_reposts: 2954 } } });
    if (url.includes("/api/deletion-jobs?page=")) return route.fulfill({ json: { items: [{ id: "7dea6283-1895-4084-8544-6d0ed2c5fa1b", status: "completed", total: 2501, processed: 2501, succeeded: 2498, failed: 3, retryable: 3, estimated_cost_usd: 25.01, created_at: "2026-08-24T19:23:39Z", updated_at: "2026-08-25T14:00:00Z" }], total: 1, page: 1, page_size: 25 } });
    return route.fulfill({ json: { items: [], total: 0, coverage: { live_api: 0, archive: 0, archive_only: 0, unresolved_reposts: 0 }, complete_history: false } });
  });
});

test("settings switch interface language and natural reading direction", async ({ page }) => {
  await page.goto("/settings");
  const language = page.locator(".preferences-grid select");
  await language.selectOption("fa");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "تنظیمات" })).toBeVisible();
  await language.selectOption("sv");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("heading", { name: "Inställningar" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".direction-switch")).toHaveCount(0);
});

test("provider test reports endpoint, model, latency, and structured output", async ({ page }) => {
  await page.route("**/api/settings/llm/test", async (route) => route.fulfill({ json: { ok: true, reply: "pong", provider: "ollama", base_url: "http://127.0.0.1:11434", model: "qwen2.5:7b", latency_ms: 842, structured_output: true, capabilities: ["completion"], sample: { matches: false, confidence: .99, detected_language: "en" } } }));
  await page.goto("/settings#settings-model");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("dialog", { name: "Connection check" })).toBeVisible();
  await expect(page.getByText("Pong! Connection successful and structured output verified.")).toBeVisible();
  await expect(page.getByText("842 ms", { exact: true })).toBeVisible();
  await expect(page.getByText("http://127.0.0.1:11434", { exact: true })).toBeVisible();
  await expect(page.getByText("No vision capability reported", { exact: true })).toBeVisible();
});

test("completed scans distinguish confident non-matches from failures", async ({ page }) => {
  await page.route("**/api/scans/scan-zero", async (route) => route.fulfill({ json: { id: "scan-zero", prompt: "Show me posts about AI", status: "completed", processed: 1, total: 1, threshold: .85, max_posts: 1, policy: { target_topic: "AI technologies" }, counts: { selected: 0, matches: 0, non_matches: 1, classified: 1 } } }));
  await page.route("**/api/scans/scan-zero/results?*", async (route) => route.fulfill({ json: { total: 1, items: [{ post_id: "post-1", text: "A geopolitical post", content_type: "repost", matches: false, confidence: .97, detected_language: "en", reason_en: "This does not discuss AI technologies.", reason_fa: "", selected: false, status: "classified" }] } }));
  await page.goto("/scans/scan-zero");
  await expect(page.getByText("Not a match", { exact: true })).toBeVisible();
  await expect(page.getByText("Classification confidence: 97%", { exact: true })).toBeVisible();
  await expect(page.getByText(/scan completed correctly/i)).toBeVisible();
});

test("English model picker keeps the language's natural direction", async ({ page }) => {
  await page.goto("/settings#settings-model");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.locator("#llm-model").click();
  await expect(page.getByText("Available models: 2", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search models or enter a custom name").fill("gemma");
  await expect(page.getByText("gemma3:12b", { exact: true })).toBeVisible();
  await expect(page.locator("[cmdk-item]").filter({ hasText: "qwen2.5:7b" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".direction-switch")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("API credentials are entered before OpenAI-compatible model discovery", async ({ page }) => {
  let discoveryPayload: Record<string, string> | undefined;
  let resetFields: string[] | undefined;
  await page.route("**/api/settings/llm/models", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, string>;
    if (payload.provider === "openai_compatible") discoveryPayload = payload;
    await route.fulfill({ json: { provider: payload.provider, models: ["private-model"] } });
  });
  await page.route("**/api/settings/llm/reset", async (route) => {
    resetFields = (route.request().postDataJSON() as { fields: string[] }).fields;
    await route.fulfill({ json: { provider: "openai_compatible", base_url: "http://env-gateway.test/v1", model: "env-model", api_key: "********", timeout_seconds: 120, batch_size: 10, vision_enabled: false, sources: { base_url: "environment", api_key: "environment" }, environment: { provider: "openai_compatible", base_url: "http://env-gateway.test/v1", model: "env-model", api_key_configured: true, timeout_seconds: 120, batch_size: 10, vision_enabled: false } } });
  });
  await page.goto("/settings#settings-model");
  await page.locator("form select").selectOption("openai_compatible");
  await page.locator("form input").nth(0).fill("http://gateway.test/v1");

  const apiKey = page.locator('form input[type="password"]');
  const model = page.locator("#llm-model");
  const [apiKeyBox, modelBox] = await Promise.all([apiKey.boundingBox(), model.boundingBox()]);
  expect(apiKeyBox?.y).toBeLessThan(modelBox?.y ?? 0);

  await apiKey.fill("secret-key");
  await expect.poll(() => discoveryPayload?.api_key).toBe("secret-key");
  await model.click();
  await expect(page.getByText("private-model", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(discoveryPayload?.base_url).toBe("http://gateway.test/v1");

  await page.getByRole("button", { name: "Reset to env" }).first().click();
  await expect(page.locator("#llm-base-url")).toHaveValue("http://env-gateway.test/v1");
  expect(resetFields).toEqual(["base_url"]);
});

test("mobile navigation exposes all primary routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings#settings-model");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Deletion history" })).toBeVisible();
});

test("deletion history keeps completed jobs reachable", async ({ page }) => {
  await page.goto("/deletions");
  await expect(page.getByRole("heading", { name: "Deletion history" })).toBeVisible();
  await expect(page.getByText(/2,?501\/2,?501/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View", exact: true })).toHaveAttribute("href", "/deletions/7dea6283-1895-4084-8544-6d0ed2c5fa1b");
});

test("archive overview presents history and scan insight", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Your archive, at a glance" })).toBeVisible();
  await expect(page.getByText("3,450", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("slider", { name: "Archive posts by month" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Latest scan insight" })).toBeVisible();
});

test("inventory rows can reveal the complete post text", async ({ page }) => {
  const fullText = "A complete archived post with enough content to require expansion. ".repeat(5);
  await page.route("**/api/posts?*", async (route) => route.fulfill({ json: { items: [{ id: "post-1", text: fullText, source_text: null, language: "en", posted_at: "2026-01-01T00:00:00Z", content_type: "post", from_api: false, from_archive: true }], total: 1, page: 1, page_size: 50, coverage: { live_api: 0, archive: 1, archive_only: 1, unresolved_reposts: 0 }, complete_history: true } }));
  await page.goto("/inventory/all");
  const content = page.getByText(fullText, { exact: true });
  await expect(content).toHaveClass(/line-clamp-2/);
  await page.getByRole("button", { name: "View" }).last().click();
  await expect(content).not.toHaveClass(/line-clamp-2/);
  await expect(page.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
});

test("inventory shows one scan request at a time instead of stacking results", async ({ page }) => {
  const scans = [
    { id: "scan-new", prompt: "Find AI posts", status: "completed", processed: 1, total: 1, created_at: "2026-08-27T12:00:00Z", policy: { target_topic: "AI" }, counts: { classified: 1, matches: 1, selected: 1, failed: 0 } },
    { id: "scan-old", prompt: "Find political posts", status: "completed", processed: 1, total: 1, created_at: "2026-08-26T12:00:00Z", policy: { target_topic: "Politics" }, counts: { classified: 1, matches: 1, selected: 1, failed: 0 } },
  ];
  await page.route("**/api/scans?page=1&page_size=25", async (route) => route.fulfill({ json: { items: scans, total: 2, page: 1, page_size: 25 } }));
  await page.route("**/api/posts?*", async (route) => {
    const scanId = new URL(route.request().url()).searchParams.get("scan_id");
    const isNew = scanId === "scan-new";
    const scan = scans.find((item) => item.id === scanId);
    await route.fulfill({ json: { items: [{ id: isNew ? "ai-post" : "political-post", text: isNew ? "A post about local AI models" : "A post about an election", source_text: null, language: "en", posted_at: "2026-01-01T00:00:00Z", content_type: "post", from_api: false, from_archive: true, classification: { matches: true, confidence: .96, detected_language: "en", reason_en: "Matches this request.", selected: true, status: "classified" } }], total: 1, page: 1, page_size: 50, coverage: { live_api: 0, archive: 2, archive_only: 2, unresolved_reposts: 0 }, complete_history: true, scan } });
  });
  await page.goto("/inventory");
  await expect(page.getByText("Scan sessions: 2", { exact: true })).toBeVisible();
  await page.locator("article").filter({ hasText: "Find AI posts" }).getByRole("link", { name: "View" }).click();
  await expect(page).toHaveURL(/\/inventory\/scan-new$/);
  await expect(page.getByText("A post about local AI models", { exact: true })).toBeVisible();
  await expect(page.getByText("Find AI posts", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("A post about an election", { exact: true })).toHaveCount(0);
  await page.goto("/inventory/scan-old");
  await expect(page.getByText("A post about an election", { exact: true })).toBeVisible();
  await expect(page.getByText("A post about local AI models", { exact: true })).toHaveCount(0);
});

test("new scans accept a newest-post limit and zero means all", async ({ page }) => {
  let scanPayload: Record<string, unknown> | undefined;
  await page.route("**/api/scans/compile", async (route) => route.fulfill({ json: { target_topic: "political content", languages: ["en", "fa"], content_types: ["post", "reply", "quote", "repost"], positive_indicators: ["Political discussion"], positive_indicators_fa: [], exclusions: ["Unrelated content"], exclusions_fa: [], ambiguity_guidance: "Exclude ambiguity.", ambiguity_guidance_fa: "" } }));
  await page.route("**/api/scans", async (route) => {
    scanPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { id: "scan-limited" } });
  });
  await page.goto("/scans/new");
  const limit = page.getByLabel("Posts to scan");
  await expect(page.getByText("All eligible posts", { exact: true })).toBeVisible();
  await limit.fill("3");
  await expect(page.getByText("Newest eligible posts: 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Cleanup instruction")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Review policy" })).toBeDisabled();
  await page.getByLabel("Cleanup instruction").fill("Find posts about technology");
  await page.getByRole("button", { name: "Review policy" }).click();
  await page.getByRole("button", { name: "Start scan" }).click();
  await expect.poll(() => scanPayload?.max_posts).toBe(3);
});
