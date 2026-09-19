import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProjectConfig } from "../lib/config-store.js";
import { decodeLep } from "../lib/lep.js";
import { validateProjectConfig, probeLatchSources } from "../lib/validate.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { printChecks } from "../ui/table.js";

export interface TestOpts {
  verbose?: boolean;
  filter?: string;
  vectorsPath?: string;
  json?: boolean;
}

interface Check { check: string; state: "pass" | "fail" | "skip"; hint: string }

function findVectorsDir(hint?: string): string | null {
  const candidates = [
    hint,
    "protocol/test-vectors",
    "../protocol/test-vectors",
    "../../protocol/test-vectors",
    "/protocol/test-vectors",
  ].filter(Boolean) as string[];
  // also walk up to repo root
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(join(cur, "protocol/test-vectors"));
    const { dirname } = { dirname: (p: string) => p.split(/[/\\]/).slice(0, -1).join("/") || "/" };
    const next = dirname(cur);
    if (next === cur) break;
    cur = next;
  }
  // absolute repo fallback
  candidates.push("C:/Users/USER/LastState/protocol/test-vectors");
  for (const c of candidates) {
    try {
      if (c && existsSync(join(resolve(c), "manifest.json"))) return resolve(c);
    } catch { /* noop */ }
  }
  return null;
}

function hexToBytes(hexStr: string): Uint8Array {
  const clean = hexStr.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function loadVectorBytes(path: string): Uint8Array | null {
  try {
    const text = readFileSync(path, "utf8").trim();
    if (/^[0-9a-fA-F\s\r\n]+$/.test(text) && text.replace(/\s/g, "").length >= 8) {
      return hexToBytes(text);
    }
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

function runVectorChecks(vectorsDir: string | null): Check[] {
  if (!vectorsDir) {
    return [{ check: "LEP test-vectors", state: "skip", hint: "protocol/test-vectors not found — validate against HIL fixtures" }];
  }
  let manifest: { valid?: string[]; invalid?: string[]; vectors?: Array<{ path: string; kind: string }> } = {};
  try {
    const raw = JSON.parse(readFileSync(join(vectorsDir, "manifest.json"), "utf8"));
    if (Array.isArray(raw.vectors)) {
      manifest = {
        valid: raw.vectors.filter((v: { kind: string }) => v.kind === "valid").map((v: { path: string }) => v.path),
        invalid: raw.vectors.filter((v: { kind: string }) => v.kind === "invalid").map((v: { path: string }) => v.path),
        vectors: raw.vectors,
      };
    } else {
      manifest = raw;
    }
  } catch {
    // fallback: scan dirs
    const valid: string[] = [];
    const invalid: string[] = [];
    try {
      for (const f of readdirSync(join(vectorsDir, "valid"))) valid.push(`valid/${f}`);
      for (const f of readdirSync(join(vectorsDir, "invalid"))) invalid.push(`invalid/${f}`);
    } catch { /* noop */ }
    manifest = { valid, invalid };
  }
  const checks: Check[] = [];
  const validFiles = manifest.valid ?? [];
  const invalidFiles = manifest.invalid ?? [];
  let validOk = 0, validTotal = 0;
  for (const rel of validFiles.slice(0, 12)) {
    const p = join(vectorsDir, rel);
    if (!existsSync(p)) continue;
    const bytes = loadVectorBytes(p);
    if (!bytes) continue;
    validTotal++;
    const d = decodeLep(bytes);
    if (d.ok) validOk++;
    else checks.push({ check: `vector ${rel}`, state: "fail", hint: d.errors[0] ?? "decode failed" });
  }
  if (validTotal > 0) {
    checks.unshift({
      check: `LEP valid vectors (${validOk}/${validTotal})`,
      state: validOk === validTotal ? "pass" : "fail",
      hint: validOk === validTotal ? `${validTotal} envelopes decode` : "see failures below",
    });
  }
  let invalidOk = 0, invalidTotal = 0;
  for (const rel of invalidFiles.slice(0, 12)) {
    const p = join(vectorsDir, rel);
    if (!existsSync(p)) continue;
    const bytes = loadVectorBytes(p);
    if (!bytes) continue;
    invalidTotal++;
    const d = decodeLep(bytes);
    if (!d.ok) invalidOk++;
    else checks.push({ check: `vector ${rel} must reject`, state: "fail", hint: "invalid envelope decoded as ok" });
  }
  if (invalidTotal > 0) {
    checks.unshift({
      check: `LEP invalid vectors rejected (${invalidOk}/${invalidTotal})`,
      state: invalidOk === invalidTotal ? "pass" : "fail",
      hint: invalidOk === invalidTotal ? "all corrupt envelopes rejected" : "see failures",
    });
  }
  if (checks.length === 0) {
    return [{ check: "LEP test-vectors", state: "skip", hint: "manifest empty — nothing to validate" }];
  }
  return checks;
}

export async function test(rawOpts: TestOpts) {
  const verbose = !!rawOpts.verbose;
  if (!isJson()) header("LastState integration checks");
  const cfg = loadProjectConfig();
  const checks: Check[] = [
    ...validateProjectConfig(cfg),
    ...probeLatchSources(),
    ...runVectorChecks(findVectorsDir(rawOpts.vectorsPath)),
    { check: "spool persistence", state: "skip" as const, hint: "needs target storage ports" },
    { check: "HIL end-to-end", state: "skip" as const, hint: "use latch/hil/runner.py --board <json> --scenario hardfault" },
  ];
  const filter = rawOpts.filter?.toLowerCase();
  const shown = filter ? checks.filter((c) => c.check.toLowerCase().includes(filter)) : checks;
  const failed = shown.filter((c) => c.state === "fail").length;

  if (isJson() || rawOpts.json) {
    emitJson({ ok: failed === 0, failed, checks: shown });
  } else {
    printChecks(shown, verbose);
    console.log("");
    if (failed > 0) {
      log.err("Some checks need attention. See https://docs.laststate.io/quickstart");
      process.exitCode = 1;
    } else {
      log.ok("Static checks passed (- = not probed by this scaffold). Trigger a fault and run 'laststate analyze <file.lep>'");
      console.log("");
    }
  }
}
