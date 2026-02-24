// ----------------------------------------------------------------
// Typed API client for the local ShipPage server.
//
// CSRF: All mutation requests (POST/PATCH/DELETE) include the
// X-CSRF-Token header. The token is injected into window by the
// server when it serves index.html.
// ----------------------------------------------------------------

declare global {
  interface Window {
    __SHIPPAGE_CSRF__?: string;
  }
}

function getCsrfToken(): string {
  // Injected by server into index.html as window.__SHIPPAGE_CSRF__
  if (typeof window !== "undefined" && window.__SHIPPAGE_CSRF__) {
    return window.__SHIPPAGE_CSRF__;
  }
  // Fallback: fetch from the server (for dev mode where index.html isn't server-rendered)
  return "";
}

// Load the CSRF token once on startup if not already injected
let _csrfToken: string | null = null;

async function ensureCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;
  const injected = getCsrfToken();
  if (injected) {
    _csrfToken = injected;
    return _csrfToken;
  }
  // Fetch from the CSRF endpoint (dev mode)
  const res = await fetch("/api/csrf-token");
  const data = (await res.json()) as { token: string };
  _csrfToken = data.token;
  return _csrfToken;
}

async function request<T>(
  path: string,
  options?: RequestInit & { json?: unknown }
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const method = options?.method?.toUpperCase() ?? "GET";
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method);

  if (isMutation) {
    headers["X-CSRF-Token"] = await ensureCsrfToken();
  }

  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...((options?.headers as Record<string, string>) ?? {}) },
    body: options?.json !== undefined ? JSON.stringify(options.json) : options?.body,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: "Unknown error" }))) as {
      error: string;
    };
    throw new ApiError(error.error ?? `HTTP ${response.status}`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ----------------------------------------------------------------
// Config API
// ----------------------------------------------------------------
export const configApi = {
  get: () => request<{ config: unknown }>("/api/config"),
  update: (data: unknown) => request<{ ok: boolean }>("/api/config", { method: "PATCH", json: data }),
  saveSecret: (key: string, value: string) =>
    request<{ ok: boolean }>("/api/config/secrets", { method: "POST", json: { key, value } }),
};

// ----------------------------------------------------------------
// Integrations API
// ----------------------------------------------------------------
export const integrationsApi = {
  status: () => request<unknown>("/api/integrations/status"),
  test: (source: string) =>
    request<{ ok: boolean; error?: string }>("/api/integrations/test", {
      method: "POST",
      json: { source },
    }),
  projects: (source: string) =>
    request<{ projects: Array<{ id: string; name: string }> }>(
      `/api/integrations/projects?source=${source}`
    ),
  tickets: (params: {
    source: string;
    projectId?: string;
    since?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("source", params.source);
    if (params.projectId) qs.set("projectId", params.projectId);
    if (params.since) qs.set("since", params.since);
    if (params.limit) qs.set("limit", String(params.limit));
    return request<{ tickets: unknown[]; count: number }>(`/api/integrations/tickets?${qs}`);
  },
};

// ----------------------------------------------------------------
// Generate API
// ----------------------------------------------------------------
export const generateApi = {
  generate: (data: unknown) =>
    request<unknown>("/api/generate", { method: "POST", json: data }),
  rerender: (releaseId: string, template: string) =>
    request<{ html: string; release: unknown }>(`/api/generate/${releaseId}/rerender`, {
      method: "POST",
      json: { template },
    }),
  regenerate: (releaseId: string, opts?: { customInstructions?: string }) =>
    request<{ content: unknown; html: string; release: unknown }>(
      `/api/generate/${releaseId}/regenerate`,
      { method: "POST", json: opts ?? {} }
    ),
};

// ----------------------------------------------------------------
// Releases API
// ----------------------------------------------------------------
export const releasesApi = {
  list: (params?: { project?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.project) qs.set("project", params.project);
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    return request<{ releases: unknown[]; count: number }>(`/api/releases?${qs}`);
  },
  get: (id: string) => request<{ release: unknown }>(`/api/releases/${id}`),
  update: (id: string, data: unknown) =>
    request<{ release: unknown }>(`/api/releases/${id}`, { method: "PATCH", json: data }),
  delete: (id: string) =>
    request<void>(`/api/releases/${id}`, { method: "DELETE" }),
  tickets: (id: string) => request<{ tickets: unknown[] }>(`/api/releases/${id}/tickets`),
  history: (id: string) => request<{ history: unknown[] }>(`/api/releases/${id}/history`),
};

// ----------------------------------------------------------------
// Export API
// ----------------------------------------------------------------
export const exportApi = {
  export: (releaseId: string, mode: "single-file" | "folder") =>
    request<{ path: string; filename: string; sizeBytes: number }>("/api/export", {
      method: "POST",
      json: { releaseId, mode },
    }),
  getHtml: (releaseId: string) => fetch(`/api/export/${releaseId}/html`).then((r) => r.text()),
  templates: () =>
    request<{ templates: Array<{ name: string; source: string }> }>("/api/export/templates"),
  publishToNotion: (releaseId: string, parentPageId: string) =>
    request<{ url: string }>("/api/export/notion", {
      method: "POST",
      json: { releaseId, parentPageId },
    }),
};
