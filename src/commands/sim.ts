import { execa } from "execa";
import { checkHttp } from "../lib/http.js";
import { resolveRepoRoot } from "../lib/compose.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { withSpinner } from "../ui/spinner.js";
import { promptIfMissing } from "../ui/prompt.js";

export interface SimOpts {
  scenario?: string;
  rate?: string;
  devices?: string;
  duration?: string;
}

const SCENARIOS = ["demo", "steady", "crash-storm", "outage", "recovery", "boot-loop"];

export async function simRun(rawOpts: SimOpts) {
  const answered = await promptIfMissing<SimOpts>(
    [{ type: "list", name: "scenario", message: "Scenario:", choices: SCENARIOS, default: rawOpts.scenario ?? "demo" }],
    rawOpts,
  );
  const scenario = answered.scenario ?? "demo";
  if (!isJson()) header(`Simulator (${scenario})`);
  const root = resolveRepoRoot();
  const env = {
    SIM_SCENARIO: scenario,
    ...(answered.rate ? { SIMULATOR_RATE: answered.rate } : {}),
    ...(answered.devices ? { SIMULATOR_DEVICE_COUNT: answered.devices } : {}),
  };
  await withSpinner("docker compose up simulator", async () => {
    const r = await execa("docker", ["compose", "up", "-d", "--build", "simulator"], { cwd: root, env: { ...process.env, ...env } as Record<string, string>, reject: false });
    if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).slice(-600) || "simulator up failed");
  });
  if (answered.duration) {
    const secs = parseInt(answered.duration, 10);
    if (!Number.isNaN(secs) && secs > 0) {
      log.info(`Running ${secs}s...`);
      await new Promise((res) => setTimeout(res, secs * 1000));
      await execa("docker", ["compose", "stop", "simulator"], { cwd: root, reject: false });
      log.ok("Simulator stopped (duration elapsed)");
    }
  }
  const metrics = await checkHttp("http://localhost:9468/metrics");
  if (isJson()) emitJson({ ok: true, scenario, metrics: metrics.ok });
  else { log.ok(`Simulator running (scenario=${scenario}, metrics ${metrics.ok ? "✓ :9468" : "-"} )`); console.log(""); }
}

export async function simStop() {
  const root = resolveRepoRoot();
  await withSpinner("Stopping simulator", async () => {
    await execa("docker", ["compose", "stop", "simulator"], { cwd: root, reject: false });
  });
  if (isJson()) emitJson({ ok: true });
  else { log.ok("Simulator stopped"); console.log(""); }
}
