export type InternalEdgeJsonResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  raw: string;
};

type PostInternalEdgeJsonOptions = {
  functionsBase: string;
  path: string;
  serviceToken: string;
  body: unknown;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export async function postInternalEdgeJson<T = unknown>(
  opts: PostInternalEdgeJsonOptions,
): Promise<InternalEdgeJsonResult<T>> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  const fetcher = opts.fetch ?? fetch;

  try {
    const res = await fetcher(`${opts.functionsBase}${opts.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${opts.serviceToken}`,
        // Transitional compatibility while every internal consumer migrates.
        "x-service-token": opts.serviceToken,
      },
      body: JSON.stringify(opts.body),
      signal: ctrl.signal,
    });

    const raw = await res.text().catch(() => "");

    let data: T | null = null;

    try {
      data = raw ? (JSON.parse(raw) as T) : null;
    } catch {
      data = { raw: raw.slice(0, 300) } as T;
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}
