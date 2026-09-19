import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, basename, isAbsolute } from "node:path";
import { loadProjectConfig, resolveValue } from "../lib/config-store.js";
import { fetchWithTimeout } from "../lib/http.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { progressBar } from "../ui/progress.js";
import { promptIfMissing } from "../ui/prompt.js";

export interface IngestOpts {
  to?: string;
  url?: string;
  token?: string;
  batch?: boolean;
  yes?: boolean;
}

function collectFiles(input: string): string[] {
  const abs = isAbsolute(input) ? input : resolve(process.cwd(), input);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isDirectory()) {
    return readdirSync(abs).filter((f) => /\.lep$/i.test(f)).map((f) => resolve(abs, f));
  }
  return [abs];
}

function loadBytes(path: string): Uint8Array {
  const text = (() => { try { return readFileSync(path, "utf8").trim(); } catch { return ""; } })();
  if (/^[0-9a-fA-F\s\r\n]+$/.test(text) && text.replace(/\s/g, "").length >= 8 && !text.includes("LSTP")) {
    return new Uint8Array(Buffer.from(text.replace(/[^0-9a-fA-F]/g, ""), "hex"));
  }
  return new Uint8Array(readFileSync(path));
}

export async function ingest(input: string | undefined, rawOpts: IngestOpts) {
  const cfg = loadProjectConfig();
  const answered = await promptIfMissing<{ input?: string }>(
    [{ type: "input", name: "input", message: "LEP file or directory:", default: input ?? "" }],
    { input },
  );
  const to = (rawOpts.to ?? "relay").toLowerCase();
  const url = resolveValue("trace_url", {
    flag: rawOpts.url,
    envNames: ["TRACE_URL", "RELAY_URL"],
    project: cfg ?? undefined,
    fallback: to === "trace" ? "http://localhost:8080" : "http://localhost:8384",
  })!;
  const token = resolveValue("ingest_token", {
    flag: rawOpts.token,
    envNames: ["LASTSTATE_INGEST_TOKEN", "TRACE_BOOTSTRAP_TOKEN", "LASTSTATE_COMPANY_TOKEN"],
    project: cfg ?? undefined,
  });
  if (!isJson()) header(`Ingest → ${to} (${url})`);

  const files = collectFiles(answered.input ?? "");
  if (files.length === 0) {
    const msg = `No .lep file found: ${answered.input}`;
    if (isJson()) emitJson({ ok: false, error: msg });
    else { log.err(msg); process.exitCode = 1; }
    return;
  }
  if (!token || /^dev-/.test(token)) {
    log.warn("Using local dev token — rotate before any shared use.");
  }

  const endpoint = to === "trace" ? `${url.replace(/\/$/, "")}/v1/ingest` : `${url.replace(/\/$/, "")}/v1/ingest`;
  const bar = progressBar(files.length, "ingest", "arq");
  const results: Array<{ file: string; id?: string; status?: number; duplicate?: boolean; error?: string }> = [];
  let sentBytes = 0;
  for (const f of files) {
    const bytes = loadBytes(f);
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(token ? { Authorization: `Bearer ${token.replace(/ #.*$/, "")}` } : {}),
        },
        body: Buffer.from(bytes),
        timeoutMs: 15_000,
      });
      const body = await res.text().catch(() => "");
      let parsed: { id?: string; duplicate?: boolean } = {};
      try { parsed = JSON.parse(body); } catch { /* noop */ }
      const id = res.headers.get("X-Last-State-Event-ID") ?? parsed.id;
      results.push({ file: basename(f), id: id ?? undefined, status: res.status, duplicate: parsed.duplicate });
      if (![200, 201, 202].includes(res.status)) {
        log.warn(`${basename(f)} → HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (e) {
      results.push({ file: basename(f), error: (e as Error).message });
    }
    sentBytes += bytes.length;
    bar.tick(1, `${(sentBytes / 1024).toFixed(1)} KB`);
  }
  bar.stop();
  const ok = results.every((r) => !r.error && (r.status === 200 || r.status === 201 || r.status === 202));
  if (isJson()) {
    emitJson({ ok, to, endpoint, count: results.length, results });
  } else {
    for (const r of results) {
      if (r.error) log.err(`${r.file}: ${r.error}`);
      else log.ok(`${r.file} → ${r.status} id=${r.id ?? "?"}${r.duplicate ? " (duplicate)" : ""}`);
    }
    console.log("");
    if (!ok) process.exitCode = 1;
  }
}
