import open from "open";
import { billingCheckout, billingConfig, billingPortal, billingStatus, billingWatch } from "../lib/billing.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { printTable } from "../ui/table.js";

export async function billingShow() {
  const cfg = billingConfig();
  if (!isJson()) header("Billing status");
  try {
    const s = await billingStatus(cfg);
    if (isJson()) {
      emitJson({ ok: true, ...s });
      return;
    }
    printTable(["field", "value"], [
      ["billing", s.billing],
      ["org", s.org],
      ["health", s.health.ok ? `✓ HTTP ${s.health.status}` : "✗ unreachable"],
      ["entitlement", s.entitlement.ok ? s.entitlement.body.slice(0, 160) : `✗ HTTP ${s.entitlement.status}`],
      ["usage", s.usage.ok ? s.usage.body.slice(0, 160) : `✗ HTTP ${s.usage.status}`],
    ]);
  } catch (e) {
    const msg = (e as Error).message;
    if (isJson()) emitJson({ ok: false, error: msg });
    else {
      log.err(msg);
      process.exitCode = 1;
    }
  }
}

export async function billingCheckoutCmd(plan: string, opts: { open?: boolean } = {}) {
  try {
    const url = await billingCheckout(plan);
    if (isJson()) emitJson({ ok: true, checkout_url: url });
    else {
      log.info(`Checkout ready: ${url}`);
      if (opts.open !== false) await open(url).catch(() => undefined);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (isJson()) emitJson({ ok: false, error: msg });
    else {
      log.err(msg);
      process.exitCode = 1;
    }
  }
}

export async function billingPortalCmd(returnUrl: string) {
  try {
    const url = await billingPortal(returnUrl);
    if (isJson()) emitJson({ ok: true, url });
    else {
      log.info(`Portal: ${url}`);
      await open(url).catch(() => undefined);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (isJson()) emitJson({ ok: false, error: msg });
    else {
      log.err(msg);
      process.exitCode = 1;
    }
  }
}

export async function billingWatchCmd(opts: { events?: string } = {}) {
  if (!isJson()) header("Billing live tail (Ctrl+C to stop)");
  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
  try {
    await billingWatch(
      (type, data) => {
        if (isJson()) emitJson({ type, data });
        else log.info(`[${type}] ${data.slice(0, 300)}`);
      },
      { events: opts.events, signal: ctrl.signal },
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    const msg = (e as Error).message;
    if (isJson()) emitJson({ ok: false, error: msg });
    else {
      log.err(msg);
      process.exitCode = 1;
    }
  }
}
