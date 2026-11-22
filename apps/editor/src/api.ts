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
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? options.headers
        : { "content-type": "application/json", ...options.headers }),
      ...(token ? { "x-actiscape-token": token } : {}),
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(
      result.error,
      result.message,
      result.details,
      response.status,
    );
  return result;
}
export const post = <T = any>(url: string, body: any) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
