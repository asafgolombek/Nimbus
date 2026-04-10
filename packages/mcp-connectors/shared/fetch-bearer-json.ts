export type BearerJsonFetchResult = {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
};

export function resolveUrlWithBase(baseUrl: string, pathOrUrl: string): string {
  return pathOrUrl.startsWith("http") ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
}

export async function fetchBearerAuthorizedJson(
  url: string,
  token: string,
  init?: RequestInit,
  defaultHeaders?: Record<string, string>,
): Promise<BearerJsonFetchResult> {
  const mergedHeaders = new Headers({
    Authorization: `Bearer ${token}`,
    ...defaultHeaders,
  });
  if (init?.headers !== undefined) {
    const extra = new Headers(init.headers);
    for (const [k, v] of extra) {
      mergedHeaders.set(k, v);
    }
  }
  const res = await fetch(url, {
    ...init,
    headers: mergedHeaders,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}
