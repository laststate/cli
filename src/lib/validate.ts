import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "./config-store.js";

export interface ValidationIssue {
  check: string;
  state: "pass" | "fail" | "skip";
  hint: string;
}

export function validateProjectConfig(cfg: ProjectConfig | null): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!cfg) {
    return [{ check: "laststate.yaml exists", state: "fail", hint: "run 'laststate init' first" }];
  }
  out.push({ check: "laststate.yaml exists", state: "pass", hint: "found" });
  const lep = Number(cfg.lep_version ?? 2);
  out.push(
    lep === 1 || lep === 2
      ? { check: "LEP version 1|2", state: "pass", hint: `v${lep}` }
      : { check: "LEP version 1|2", state: "fail", hint: `invalid lep_version=${cfg.lep_version}` },
  );
  const token = String(cfg.ingest_token ?? "");
  out.push(
    token.startsWith("env:")
      ? { check: "ingest_token via env:", state: "pass", hint: token }
      : token.startsWith("dev-")
        ? { check: "ingest_token local dev", state: "pass", hint: "dev- prefix — rotate before sharing" }
        : token
          ? { check: "ingest_token set", state: "pass", hint: "custom token" }
          : { check: "ingest_token set", state: "fail", hint: "missing — run init or config set" },
  );
  const url = String(cfg.trace_url ?? cfg.relay_url ?? "");
  out.push(
    url.startsWith("http")
      ? { check: "trace/relay url", state: "pass", hint: url }
      : { check: "trace/relay url", state: "fail", hint: "missing http(s) url" },
  );
  return out;
}

export function probeLatchSources(cwd = process.cwd()): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const candidates = [
    "latch/include/laststate/latch.h",
    "third_party/latch/include/laststate/latch.h",
    "latch-snippet.c",
    "main.c",
    "CMakeLists.txt",
  ];
  const found = candidates.filter((f) => existsSync(join(cwd, f)));
  if (found.length > 0) {
    out.push({ check: "latch include path", state: "pass", hint: found.join(", ") });
  } else {
    out.push({ check: "latch include path", state: "skip", hint: "static scaffold — include/laststate/latch.h not probed" });
  }
  // transport registration probe (grep)
  try {
    const files = ["main.c", "latch-snippet.c", ...found.filter((f) => f.endsWith(".c"))];
    let sawTransport = false;
    let sawBoot = false;
    for (const f of files) {
      const p = join(cwd, f);
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      if (/ls_transport_register|transport_register/.test(text)) sawTransport = true;
      if (/ls_boot\s*\(/.test(text)) sawBoot = true;
    }
    out.push(
      sawTransport
        ? { check: "transport registration", state: "pass", hint: "ls_transport_register found" }
        : { check: "transport registration", state: "skip", hint: "static scaffold — register a transport before ls_boot()" },
    );
    out.push(
      sawBoot
        ? { check: "ls_boot() wired", state: "pass", hint: "ls_boot() found" }
        : { check: "ls_boot() wired", state: "skip", hint: "call ls_boot() after ls_init()" },
    );
  } catch {
    out.push({ check: "transport registration", state: "skip", hint: "probe error" });
  }
  return out;
}

export function validateRelayConfigYaml(text: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  try {
    const doc = parseYaml(text) as Record<string, unknown>;
    if (!doc || typeof doc !== "object") return [{ check: "relay-config.yaml parse", state: "fail", hint: "empty/invalid yaml" }];
    out.push({ check: "relay-config.yaml parse", state: "pass", hint: "valid yaml" });
    const raw = text;
    // tokens must be env: refs, never literals
    const literalToken = /token:\s*["']?(?!env:)(lst_ingest_|sk_|dev-)[^\s"']*/m;
    if (literalToken.test(raw)) {
      out.push({ check: "relay tokens via env:", state: "fail", hint: "literal token found — use env:VAR" });
    } else {
      out.push({ check: "relay tokens via env:", state: "pass", hint: "no literal tokens" });
    }
    return out;
  } catch (e) {
    return [{ check: "relay-config.yaml parse", state: "fail", hint: (e as Error).message }];
  }
}
