import { existsSync } from "node:fs";
import { basename } from "node:path";
import { execa } from "execa";
import { loadProjectConfig, resolveValue } from "../lib/config-store.js";
import { fetchWithTimeout } from "../lib/http.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { printTable } from "../ui/table.js";

export async function symbolicateUpload(elf: string, opts: { url?: string; token?: string }) {
  const cfg = loadProjectConfig();
  const url = resolveValue("trace_url", { flag: opts.url, envNames: ["TRACE_URL"], project: cfg ?? undefined, fallback: "http://localhost:8080" })!;
  const token = resolveValue("ingest_token", { flag: opts.token, envNames: ["LASTSTATE_COMPANY_TOKEN", "TRACE_BOOTSTRAP_TOKEN"], project: cfg ?? undefined });
  if (!existsSync(elf)) {
    const msg = `ELF not found: ${elf}`;
    if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
    return;
  }
  if (!isJson()) header("Artifact upload");
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(elf);
  try {
    const res = await fetchWithTimeout(`${url.replace(/\/$/, "")}/v1/artifacts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Artifact-Name": basename(elf),
        ...(token ? { Authorization: `Bearer ${token.replace(/ #.*$/, "")}` } : {}),
      },
      body: bytes,
      timeoutMs: 30_000,
    });
    const body = await res.text();
    if (isJson()) emitJson({ ok: res.ok, status: res.status, body: body.slice(0, 1000) });
    else if (res.ok) { log.ok(`${basename(elf)} uploaded (${bytes.length} bytes) — build_id must match firmware`); console.log(""); }
    else { log.err(`Upload failed: HTTP ${res.status} ${body.slice(0, 300)}`); process.exitCode = 1; }
  } catch (e) {
    const msg = `Upload error: ${(e as Error).message} — is Trace running? (laststate up)`;
    if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
  }
}

export async function symbolicateResolve(addrs: string[], opts: { elf?: string }) {
  if (!isJson()) header("Symbolicate");
  // Prefer local llvm-symbolizer / addr2line when ELF provided
  if (opts.elf && existsSync(opts.elf)) {
    for (const tool of ["llvm-symbolizer", "addr2line"]) {
      try {
        const probe = await execa(tool, ["--version"], { reject: false, timeout: 5000 });
        if (probe.exitCode !== 0) continue;
        const rows: string[][] = [];
        for (const a of addrs) {
          const r = tool === "addr2line"
            ? await execa("addr2line", ["-e", opts.elf, "-f", "-C", a], { reject: false })
            : await execa("llvm-symbolizer", [`--obj=${opts.elf}`, a], { reject: false });
          const lines = (r.stdout || "(unknown)").trim().split("\n");
          rows.push([a, lines[0] ?? "?", lines[1] ?? ""]);
        }
        if (isJson()) emitJson({ ok: true, tool, frames: rows.map(([addr, fn, loc]) => ({ addr, fn, loc })) });
        else { printTable(["addr", "function", "location"], rows); console.log(""); }
        return;
      } catch { /* try next */ }
    }
  }
  const msg = "No local symbolizer (llvm-symbolizer/addr2line) or ELF — upload ELF to Trace first: laststate symbolicate upload-artifact <elf>";
  if (isJson()) emitJson({ ok: false, error: msg, addrs });
  else { log.warn(msg); log.dim(`addrs: ${addrs.join(", ")}`); }
}
