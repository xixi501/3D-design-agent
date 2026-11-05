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
  const response = await fetch(`/api${url}`, {
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "content-type": "application/json", ...options.headers },
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
