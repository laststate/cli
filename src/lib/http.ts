export async function fetchWithTimeout(url: string, opts: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 6000, ...rest } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function checkHttp(url: string, timeoutMs = 4000): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  try {
    const res = await fetchWithTimeout(url, { timeoutMs });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: body.slice(0, 2000) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function waitForHttp(url: string, opts: { timeoutMs?: number; intervalMs?: number; expectOk?: boolean } = {}): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await checkHttp(url, 4000);
    if (opts.expectOk === false ? r.status !== undefined : r.ok) return true;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return false;
}
