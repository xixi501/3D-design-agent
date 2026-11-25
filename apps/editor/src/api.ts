export interface EditBase {
  projectId: string;
  revision: number;
}
const TOOL_TOKEN_KEY = "actiscape-tool-token";

function isValidTokenCandidate(val: string | null | undefined): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed || trimmed === "..." || trimmed === "…" || trimmed.includes("...")) return false;
  return trimmed.length >= 8;
}

export function toolToken(): string {
  try {
    const saved = localStorage.getItem(TOOL_TOKEN_KEY) || "";
    if (saved && !isValidTokenCandidate(saved)) {
      localStorage.removeItem(TOOL_TOKEN_KEY);
      return "";
    }
    return saved;
  } catch {
    return "";
  }
}

function rememberQueryToken() {
  try {
    const url = new URL(window.location.href);
    const query = url.searchParams.get("token");
    if (isValidTokenCandidate(query)) {
      localStorage.setItem(TOOL_TOKEN_KEY, query.trim());
    } else if (query !== null) {
      // Clean corrupted placeholder ?token=... from URL bar
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
    }
  } catch {
    // localStorage may be unavailable in restricted browser contexts.
  }
}

rememberQueryToken();
const WORKSPACE_KEY = "actiscape-workspace-id";
const WORKSPACE_RE = /^[a-zA-Z0-9_-]{4,64}$/;

function randomWorkspaceId(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return (
      "ws-" +
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
    );
  } catch {
    return (
      "ws-" +
      Math.random().toString(16).slice(2, 10) +
      Date.now().toString(16).slice(-6)
    );
  }
}

export function workspaceId(): string {
  try {
    const url = new URL(window.location.href);
    const q = (url.searchParams.get("workspace") || "").trim();
    if (q === "all" || q === "__admin__") return "";
    if (q && WORKSPACE_RE.test(q)) {
      localStorage.setItem(WORKSPACE_KEY, q);
      return q;
    }
    const saved = (localStorage.getItem(WORKSPACE_KEY) || "").trim();
    if (saved && WORKSPACE_RE.test(saved)) return saved;
    const fresh = randomWorkspaceId();
    localStorage.setItem(WORKSPACE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}


export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any,
    public status?: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = toolToken();
  const ws = workspaceId();
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? options.headers
        : { "content-type": "application/json", ...options.headers }),
      ...(token ? { "x-actiscape-token": token } : {}),
      ...(ws ? { "x-actiscape-workspace": ws } : {}),
    },
  });
  const raw = await response.text();
  let result: any = undefined;
  if (raw.trim()) {
    try {
      result = JSON.parse(raw);
    } catch {
      if (!response.ok) {
        throw new ApiError(
          `HTTP_${response.status}`,
          response.status === 502 || response.status === 504
            ? `服务响应超时或连接中断（HTTP ${response.status}），请稍后重试`
            : `服务返回非 JSON 响应（HTTP ${response.status}）`,
          raw.slice(0, 200),
          response.status,
        );
      }
      throw new ApiError(
        "INVALID_JSON",
        "服务返回内容为空或格式异常，请稍后重试",
        raw.slice(0, 200),
        response.status,
      );
    }
  }
  if (!response.ok) {
    throw new ApiError(
      result?.error || `HTTP_${response.status}`,
      result?.message ||
        (response.status === 502 || response.status === 504
          ? `服务响应超时或连接中断（HTTP ${response.status}），请重试`
          : `请求失败（HTTP ${response.status}）`),
      result?.details,
      response.status,
    );
  }
  return result as T;
}
export const post = <T = any>(url: string, body: any) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
