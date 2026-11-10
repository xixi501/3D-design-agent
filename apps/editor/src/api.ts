export interface EditBase {
  projectId: string;
  revision: number;
}
const TOOL_TOKEN_KEY = "actiscape-tool-token";

function toolToken(): string {
  try {
    return localStorage.getItem(TOOL_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function rememberQueryToken() {
  try {
    const query = new URL(window.location.href).searchParams.get("token");
    if (query) localStorage.setItem(TOOL_TOKEN_KEY, query);
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
