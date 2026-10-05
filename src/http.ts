import { ApiError, NetworkError } from "./errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** Base URL of the API, without a trailing slash. */
  baseUrl: string;
  /** Custom fetch (tests, React Native, older runtimes). Defaults to the global one. */
  fetch?: FetchLike;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Session token, sent as `Authorization: Bearer`. */
  token?: string | undefined;
}

/** Minimal JSON-over-HTTP client shared by the API clients. */
export class Http {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: HttpOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (!fetchFn) {
      throw new Error("No fetch implementation available; pass one in the client options.");
    }
    // Unbound global fetch throws "Illegal invocation" in browsers.
    this.fetchFn = options.fetch ?? fetchFn.bind(globalThis);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.token) headers["authorization"] = `Bearer ${options.token}`;

    const init: RequestInit = { method: options.method ?? "GET", headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), init);
    } catch (cause) {
      throw new NetworkError(`Request to ${url.origin}${url.pathname} failed`, { cause });
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      const error = (payload ?? {}) as { code?: unknown; message?: unknown };
      throw new ApiError(
        response.status,
        typeof error.code === "string" ? error.code : `HTTP_${response.status}`,
        typeof error.message === "string" ? error.message : text || response.statusText,
        response.status === 429 || response.status >= 500,
      );
    }

    return payload as T;
  }
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
