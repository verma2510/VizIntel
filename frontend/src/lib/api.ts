export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const authHeaders = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/** Error carrying the API's `{ msg, code }` payload and HTTP status (0 = network failure). */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** The auth provider registers how to react to an expired session (log out + redirect). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

const readToken = (): string | null => {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
};

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** false for public endpoints: no token is sent and a 401 never logs the user out. */
  auth?: boolean;
}

const messageFrom = (data: unknown, status: number): { msg: string; code?: string } => {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const details = Array.isArray(record.details) ? (record.details as { message?: string }[]) : [];
    const detail = details.find((d) => typeof d?.message === "string")?.message;
    const msg = typeof record.msg === "string" ? record.msg : undefined;
    return { msg: detail && msg === "Invalid request" ? detail : msg || `Request failed (${status})`, code: record.code as string | undefined };
  }
  if (typeof data === "string" && data.trim() && data.length < 200) return { msg: data };
  return { msg: status >= 500 ? "The server had a problem handling this request." : `Request failed (${status})` };
};

/** JSON fetch wrapper: auth header, typed errors, and central handling of expired sessions. */
export async function api<T>(path: string, { method = "GET", body, signal, auth = true }: RequestOptions = {}): Promise<T> {
  const token = auth ? readToken() : null;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers: Record<string, string> = { ...authHeaders(token) };
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  let resp: Response;
  try {
    resp = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the VizIntel server. Check your connection and try again.", 0, "NETWORK");
  }

  if (resp.status === 401 && auth && token) {
    unauthorizedHandler?.();
    throw new ApiError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED");
  }
  if (resp.status === 204) return undefined as T;

  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!resp.ok) {
    const { msg, code } = messageFrom(data, resp.status);
    throw new ApiError(msg, resp.status, code);
  }
  return data as T;
}

/** multipart upload with progress reporting (fetch cannot observe upload progress). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (fraction: number) => void): Promise<T> {
  const token = readToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError("Upload failed — the server could not be reached.", 0, "NETWORK"));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status === 401 && token) {
        unauthorizedHandler?.();
        reject(new ApiError("Your session has expired. Please sign in again.", 401, "UNAUTHORIZED"));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
      } else {
        const { msg, code } = messageFrom(data, xhr.status);
        reject(new ApiError(msg, xhr.status, code));
      }
    };
    xhr.send(form);
  });
}

export const errorMessage = (err: unknown, fallback = "Something went wrong."): string =>
  err instanceof Error && err.message ? err.message : fallback;
