import { composeUp, composeDown, composePs, composeLogs, hasDocker, resolveRepoRoot } from "../lib/compose.js";
import { checkHttp, waitForHttp } from "../lib/http.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { withSpinner, celebrate, timer } from "../ui/spinner.js";
import { runTasks } from "../ui/tasks.js";
import { printTable } from "../ui/table.js";

export interface UpOpts {
  appliance?: boolean;
  build?: boolean;
  /** commander maps --no-sim to {sim:false} (default true). */
  sim?: boolean;
  services?: string;
  waitTimeout?: string;
  open?: boolean;
  yes?: boolean;
}

export async function up(rawOpts: UpOpts) {
  if (!isJson()) header(rawOpts.appliance ? "Up (appliance)" : "Up (local dev)");
  if (!(await hasDocker())) {
    const msg = "docker not found — install Docker Desktop to run the stack";
    if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
    return;
  }
  const root = resolveRepoRoot();
  log.verbose(`repo root: ${root}`);
  const services = rawOpts.services?.split(",").map((s) => s.trim()).filter(Boolean);
  const list = services ?? (rawOpts.sim === false ? ["trace", "relay", "postgres", "minio", "createbucket"] : undefined);

  const elapsed = timer();
  const waitMs = parseInt(rawOpts.waitTimeout ?? "60000", 10) || 60000;
  const targets = [
    { name: "Trace UI", url: "http://localhost:8080/health/live" },
    { name: "Relay admin", url: "http://localhost:8383/v1/health" },
  ];
  const health: Record<string, boolean> = {};
  await runTasks([
    {
      title: "docker compose up",
      run: async () => {
        const r = await composeUp({ appliance: rawOpts.appliance, build: rawOpts.build, services: list });
        if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).slice(-800) || "compose up failed");
      },
    },
    ...targets.map((t) => ({
      title: `${t.name} health`,
      run: async (_ctx: Record<string, unknown>, task: { title: string; output: string }) => {
        const start = Date.now();
        const iv = setInterval(() => {
          task.output = `${t.url} · ${Math.round((Date.now() - start) / 1000)}s`;
        }, 500);
        try {
          health[t.name] = await waitForHttp(t.url, { timeoutMs: Math.min(waitMs, 30_000) });
        } finally {
          clearInterval(iv);
        }
        task.title = `${t.name} health — ${health[t.name] ? "reachable" : "unreachable"}`;
      },
    })),
  ]);

  const urls = {
    trace: "http://localhost:8080",
    relayAdmin: "http://localhost:8383",
    relayHttp: "http://localhost:8384",
    grafana: rawOpts.appliance ? null : "http://localhost:3000",
    prometheus: rawOpts.appliance ? null : "http://localhost:9090",
    simMetrics: rawOpts.appliance || rawOpts.sim === false ? null : "http://localhost:9468",
  };
  if (isJson()) {
    emitJson({ ok: true, root, health, urls });
  } else {
    printTable(["service", "url", "health"], [
      ["trace", urls.trace, health["Trace UI"] ? "✓" : "✗"],
      ["relay-admin", urls.relayAdmin, health["Relay admin"] ? "✓" : "✗"],
      ["relay-http", urls.relayHttp, "-"],
      ...(urls.grafana ? [["grafana", urls.grafana, "-"] as string[]] : []),
      ...(urls.prometheus ? [["prometheus", urls.prometheus, "-"] as string[]] : []),
    ]);
    if (rawOpts.open) {
      try {
        const open = (await import("open")).default;
        await open(urls.trace);
      } catch { /* noop */ }
    }
    celebrate(`Stack ${rawOpts.appliance ? "appliance " : ""}up`, elapsed());
    console.log("");
  }
}

export async function down(opts: { appliance?: boolean; volumes?: boolean }) {
  if (!isJson()) header("Down");
  await withSpinner("docker compose down", async () => {
    const r = await composeDown(opts);
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).slice(-500));
  });
  if (isJson()) emitJson({ ok: true });
  else { log.ok("Stack down"); console.log(""); }
}

export async function ps(opts: { appliance?: boolean }) {
  const r = await composePs(!!opts.appliance);
  if (isJson()) {
    try { emitJson({ ok: true, services: JSON.parse(`[${r.stdout.trim().split("\n").join(",")}]`) }); }
    catch { emitJson({ ok: true, raw: r.stdout }); }
    return;
  }
  header("Services");
  if (!r.stdout.trim()) {
    log.warn("No services running (or compose ps unsupported). Run 'laststate up'.");
  } else {
    try {
      const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
      printTable(["name", "state", "ports"], lines.map((s: Record<string, string>) => [s.Name ?? s.name ?? "?", s.State ?? s.state ?? "?", (s.Ports ?? s.ports ?? "").toString().slice(0, 60)]));
    } catch {
      console.log(r.stdout);
    }
  }
  console.log("");
}

export async function logs(opts: { service?: string; follow?: boolean; tail?: string; appliance?: boolean }) {
  const r = await composeLogs(opts.service, !!opts.follow, opts.tail ?? "100", !!opts.appliance);
  console.log(r.stdout || r.stderr || "(no logs)");
}

export async function status(opts: { url?: string }) {
  const base = (opts.url ?? "http://localhost:8080").replace(/\/$/, "");
  if (!isJson()) header("Status");
  const checks = [
    { name: "trace /health/live", url: `${base}/health/live` },
    { name: "trace capabilities", url: `${base}/v1/relay/capabilities` },
    { name: "relay admin", url: "http://localhost:8383/v1/health" },
    { name: "relay capabilities", url: "http://localhost:8384/v1/ingest/capabilities" },
  ];
  const rows: string[][] = [];
  let allOk = true;
  for (const c of checks) {
    const r = await checkHttp(c.url);
    const ok = r.ok;
    if (!ok && c.name.startsWith("relay")) { rows.push([c.name, "-", c.url]); continue; }
    if (!ok) allOk = false;
    rows.push([c.name, ok ? `✓ ${r.status}` : `✗ ${r.error ?? r.status}`, c.url]);
  }
  if (isJson()) emitJson({ ok: allOk, checks: rows });
  else { printTable(["check", "result", "url"], rows); console.log(""); if (!allOk) process.exitCode = 1; }
}
