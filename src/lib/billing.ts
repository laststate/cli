import { fetchWithTimeout } from "./http.js";

export interface BillingConfig {
  url: string;
  apiKey: string;
  orgId: string;
}

export function billingConfig(): BillingConfig {
  return {
    url: (process.env.BILLING_URL ?? "http://localhost:8081").replace(/\/+$/, ""),
    apiKey: process.env.BILLING_API_KEY ?? "",
    orgId: process.env.BILLING_ORG_ID ?? "",
  };
}

function authHeaders(cfg: BillingConfig): Record<string, string> {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

export async function billingStatus(cfg = billingConfig()) {
  if (!cfg.orgId) throw new Error("set BILLING_ORG_ID to your organization uuid");
  const [sub, usage, entitlement] = await Promise.all([
    fetchWithTimeout(`${cfg.url}/v1/entitlements/${cfg.orgId}`, { headers: authHeaders(cfg) }).then(async (r) => ({
      ok: r.ok,
      status: r.status,
      body: await r.text().catch(() => ""),
    })),
    fetchWithTimeout(`${cfg.url}/v1/usage?organization_id=${cfg.orgId}`, { headers: authHeaders(cfg) }).then(async (r) => ({
      ok: r.ok,
      status: r.status,
      body: await r.text().catch(() => ""),
    })),
    fetchWithTimeout(`${cfg.url}/health`).then(async (r) => ({ ok: r.ok, status: r.status })).catch(() => ({ ok: false as boolean, status: 0 })),
  ]);
  return { billing: cfg.url, org: cfg.orgId, entitlement: sub, usage, health: entitlement };
}

export async function billingCheckout(plan: string, cfg = billingConfig()): Promise<string> {
  if (!cfg.orgId) throw new Error("set BILLING_ORG_ID to your organization uuid");
  const res = await fetchWithTimeout(`${cfg.url}/v1/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg) },
    body: JSON.stringify({ organization_id: cfg.orgId, plan, provider: "stripe", currency: "usd" }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`checkout failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as { checkout_url?: string };
  if (!parsed.checkout_url) throw new Error("checkout unavailable — contact the team");
  return parsed.checkout_url;
}

export async function billingPortal(returnUrl: string, cfg = billingConfig()): Promise<string> {
  if (!cfg.orgId) throw new Error("set BILLING_ORG_ID to your organization uuid");
  const res = await fetchWithTimeout(`${cfg.url}/v1/portal/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(cfg) },
    body: JSON.stringify({ organization_id: cfg.orgId, return_url: returnUrl }),
  });
  const body = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`portal failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body) as { url?: string };
  if (!parsed.url) throw new Error("portal unavailable");
  return parsed.url;
}

/** Tail the SSE realtime stream; invokes onEvent per billing event until aborted. */
export async function billingWatch(onEvent: (type: string, data: string) => void, opts: { events?: string; signal?: AbortSignal } = {}, cfg = billingConfig()): Promise<void> {
  const q = new URLSearchParams();
  if (cfg.orgId) q.set("organization_id", cfg.orgId);
  if (opts.events) q.set("events", opts.events);
  const res = await fetch(`${cfg.url}/v1/billing/events/stream?${q.toString()}`, { headers: authHeaders(cfg), signal: opts.signal });
  if (!res.ok || !res.body) throw new Error(`stream failed (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let evt = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
      if (line === "") {
        evt = "";
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        evt = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        onEvent(evt || "message", line.slice(5).trim());
      }
    }
  }
}
