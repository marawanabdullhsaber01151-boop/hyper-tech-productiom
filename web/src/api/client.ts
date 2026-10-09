import type { SessionStore } from "../auth/session";
import { t } from "../copy";

export type ApiErrorKind = "network" | "unauthorized" | "forbidden" | "notFound" | "validation" | "conflict" | "server" | "other";

/** كل الأخطاء بتطلع بالشكل ده، والرسالة جاهزة للعرض بالعربي. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly correlationId?: string;
  constructor(init: { kind: ApiErrorKind; status: number; code: string; message: string; details?: unknown; correlationId?: string }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.correlationId = init.correlationId;
  }
  /** أخطاء الحقول: { fieldName: message } لو السيرفر بعتها. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as Array<{ path?: unknown[]; message?: string }>) {
        const k = d?.path?.join(".");
        if (k && d.message && !(k in out)) out[k] = d.message;
      }
    }
    return out;
  }
}

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "other";
}

export interface ClientOptions {
  base?: string;
  session?: SessionStore;
  fetchImpl?: typeof fetch;
  /** تتنادى لما السيرفر يرجّع 401 على جلسة كانت موجودة. */
  onUnauthorized?: () => void;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** مفيش توكن (دخول/تسجيل). */
  anonymous?: boolean;
}

export interface ApiClient {
  get<T>(path: string, o?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  delete<T>(path: string, o?: RequestOptions): Promise<T>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApiClient(opts: ClientOptions = {}): ApiClient {
  const base = opts.base ?? "/api/v1";
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function once<T>(method: string, path: string, o: RequestOptions): Promise<T> {
    const url = new URL(base + path, window.location.origin);
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    const token = o.anonymous ? undefined : opts.session?.get()?.token;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await doFetch(url.pathname + url.search, {
        method,
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: o.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new ApiError({ kind: "network", status: 0, code: "NETWORK", message: t("error.network") });
    }

    let json: any = null;
    const text = await res.text().catch(() => "");
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!res.ok) {
      const kind = kindOf(res.status);
      if (res.status === 401 && token) {
        opts.session?.clear();
        opts.onUnauthorized?.();
      }
      const serverMsg: string | undefined = json?.error?.message;
      const fallback = kind === "server" ? t("error.server") : kind === "forbidden" ? t("error.forbidden") : kind === "notFound" ? t("error.notFound") : kind === "unauthorized" ? t("error.session") : t("error.generic");
      throw new ApiError({
        kind,
        status: res.status,
        code: json?.error?.code ?? "HTTP_ERROR",
        // رسائل السيرفر للأخطاء 4xx بتتعرض زي ما هي (مكتوبة للعميل). أخطاء 5xx بنستبدلها برسالة آمنة.
        message: kind === "server" ? fallback : serverMsg || fallback,
        details: json?.error?.details,
        correlationId: json?.meta?.correlationId,
      });
    }

    if (res.status === 204 || json === null) return undefined as T;
    return (json && typeof json === "object" && "data" in json ? json.data : json) as T;
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    try {
      return await once<T>(method, path, o);
    } catch (e) {
      // GET بس بيتعاد مرة واحدة، ولأخطاء الشبكة/السيرفر بس.
      if (method === "GET" && e instanceof ApiError && (e.kind === "network" || (e.kind === "server" && e.status !== 500))) {
        await wait(400);
        return once<T>(method, path, o);
      }
      throw e;
    }
  }

  return {
    get: (p, o) => request("GET", p, o),
    post: (p, body, o) => request("POST", p, { ...o, body }),
    put: (p, body, o) => request("PUT", p, { ...o, body }),
    patch: (p, body, o) => request("PATCH", p, { ...o, body }),
    delete: (p, o) => request("DELETE", p, o),
  };
}
