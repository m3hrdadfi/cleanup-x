export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function csrfToken() {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith("cleanup_csrf="))
    ?.split("=")[1];
}

async function ensureCsrf() {
  if (!csrfToken()) await fetch("/api/health", { credentials: "include" });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (mutating) await ensureCsrf();
  const headers = new Headers(init.headers);
  if (mutating) headers.set("X-CSRF-Token", decodeURIComponent(csrfToken() || ""));
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    const detail = body.detail || response.statusText;
    // FastAPI validation errors are arrays, not displayable message strings.
    throw new ApiError(response.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return response.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown, idempotent = false) {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: idempotent ? { "Idempotency-Key": crypto.randomUUID() } : undefined,
  });
}
