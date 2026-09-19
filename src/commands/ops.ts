import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { composeUp, hasDocker, resolveRepoRoot } from "../lib/compose.js";
import { generateSecrets, preflight } from "../lib/env-manager.js";
import { hasTool, toolVersion } from "../lib/exec.js";
import { checkHttp } from "../lib/http.js";
import { validateRelayConfigYaml } from "../lib/validate.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { withSpinner, celebrate, timer } from "../ui/spinner.js";
import { runTasks } from "../ui/tasks.js";
import { printChecks, printTable } from "../ui/table.js";
import { promptIfMissing } from "../ui/prompt.js";

export interface DeployOpts {
  env?: string;
  onlyMissing?: boolean;
  build?: boolean;
  yes?: boolean;
}

export async function deploy(rawOpts: DeployOpts) {
  const answered = await promptIfMissing<DeployOpts>(
    [{ type: "list", name: "env", message: "Environment:", choices: ["local", "production", "appliance", "k8s"], default: rawOpts.env ?? "local" }],
    rawOpts,
  );
  const env = (answered.env ?? "local").toLowerCase();
  if (!isJson()) header(`Deploy (${env})`);

  if (env === "k8s") {
    const msg = "Kubernetes deploy: see docs/quickstarts/trace-kubernetes.md — apply manifests with your secret manager (never commit .env)";
    if (isJson()) emitJson({ ok: true, env, hint: msg });
    else { log.info(msg); log.dim("Tip: kubectl create secret generic laststate --from-env-file=.env && kubectl apply -f deploy/k8s/"); console.log(""); }
    return;
  }

  // 1. secrets (--no-only-missing regenerates everything)
  const onlyMissing = rawOpts.onlyMissing !== false;
  const elapsed = timer();
  const doCompose = async () => {
    const r = await composeUp({ appliance: env === "appliance", build: rawOpts.build !== false });
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).slice(-800));
  };
  // 2. preflight gate for production/appliance
  if (env === "production" || env === "appliance") {
    const issues = preflight({ deployEnv: env });
    if (issues.length > 0) {
      if (isJson()) emitJson({ ok: false, env, issues });
      else {
        log.err(`Preflight failed (${issues.length} issue(s)) — fix before deploy:`);
        printTable(["key", "problem", "hint"], issues.map((i) => [i.key, i.problem, i.hint]));
        process.exitCode = 1;
      }
      return;
    }
    log.ok("Preflight passed");
  }

  if (!(await hasDocker())) {
    const msg = "docker not found";
    if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
    return;
  }
  await runTasks([
    {
      title: `Secrets (generate${onlyMissing ? " --only-missing" : ""})`,
      run: async () => {
        generateSecrets({ onlyMissing });
      },
    },
    { title: `compose up (${env})`, run: doCompose },
  ]);
  if (isJson()) emitJson({ ok: true, env });
  else { celebrate(`Deploy ${env} done`, elapsed()); log.dim("Trace http://localhost:8080"); console.log(""); }
}

export interface DoctorOpts { fix?: boolean }

export async function doctor(rawOpts: DoctorOpts) {
  if (!isJson()) header("Doctor");
  const checks: Array<{ check: string; state: "pass" | "fail" | "skip"; hint: string }> = [];

  // tools
  for (const [tool, args] of [["git", ["--version"]], ["docker", ["--version"]], ["cmake", ["--version"]], ["node", ["--version"]]] as Array<[string, string[]]>) {
    const ok = await hasTool(tool, args);
    const ver = ok ? await toolVersion(tool, args) : null;
    checks.push({ check: `${tool} installed`, state: ok ? "pass" : "fail", hint: ver ?? "not found" });
  }

  // files
  const root = resolveRepoRoot();
  checks.push({ check: "repo root (docker-compose.yml)", state: existsSync(join(root, "docker-compose.yml")) ? "pass" : "skip", hint: root });
  checks.push({ check: "laststate.yaml", state: existsSync("laststate.yaml") ? "pass" : "fail", hint: existsSync("laststate.yaml") ? "found" : "run 'laststate init'" });
  checks.push({ check: ".env", state: existsSync(join(root, ".env")) || existsSync(".env") ? "pass" : "skip", hint: "run 'laststate config generate-secrets'" });

  // relay config
  const relayPath = existsSync(join(root, "relay-config.yaml")) ? join(root, "relay-config.yaml") : existsSync("relay-config.yaml") ? "relay-config.yaml" : null;
  if (relayPath) {
    try {
      const text = readFileSync(relayPath, "utf8");
      checks.push(...validateRelayConfigYaml(text));
    } catch { checks.push({ check: "relay-config.yaml", state: "fail", hint: "unreadable" }); }
  } else {
    checks.push({ check: "relay-config.yaml", state: "skip", hint: "not found (repo root only)" });
  }

  // preflight (non-blocking display)
  const issues = preflight({});
  checks.push({
    check: "secrets preflight",
    state: issues.length === 0 ? "pass" : "fail",
    hint: issues.length === 0 ? "no placeholders" : `${issues.length} issue(s): ${issues.slice(0, 3).map((i) => i.key).join(", ")}`,
  });

  // live endpoints (skip when down)
  for (const [name, url] of [["trace /health/live", "http://localhost:8080/health/live"], ["relay capabilities", "http://localhost:8384/v1/ingest/capabilities"]] as Array<[string, string]>) {
    const r = await checkHttp(url, 2500);
    checks.push({ check: name, state: r.ok ? "pass" : "skip", hint: r.ok ? `HTTP ${r.status}` : "not running (laststate up)" });
  }

  if (rawOpts.fix) {
    await withSpinner("Auto-fix: generate missing secrets", async () => { generateSecrets({ onlyMissing: true }); });
    log.ok("Fix applied (secrets only-missing). Re-run doctor.");
  }

  const failed = checks.filter((c) => c.state === "fail").length;
  if (isJson()) emitJson({ ok: failed === 0, failed, checks });
  else {
    printChecks(checks, true);
    console.log("");
    if (failed > 0) { log.err(`${failed} check(s) failing — run with --verbose or 'laststate doctor --fix'`); process.exitCode = 1; }
    else log.ok("All good.");
  }
}

export async function updateCheck() {
  if (!isJson()) header("Update");
  try {
    const r = await execa("npm", ["view", "laststate-cli", "version"], { reject: false, timeout: 10_000 });
    const latest = (r.stdout || "").trim();
    const cur = "1.0.0";
    if (isJson()) emitJson({ ok: true, current: cur, latest: latest || null, update: !!latest && latest !== cur });
    else if (latest && latest !== cur) { log.warn(`Update available: ${cur} → ${latest} — npm i -g laststate-cli`); }
    else { log.ok(`CLI up to date (${cur})`); console.log(""); }
  } catch (e) {
    if (isJson()) emitJson({ ok: false, error: (e as Error).message });
    else { log.warn("Could not check npm registry (offline?)"); }
  }
}
