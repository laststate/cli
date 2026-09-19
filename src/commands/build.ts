import { existsSync } from "node:fs";
import { execa } from "execa";
import { loadProjectConfig } from "../lib/config-store.js";
import { hasTool } from "../lib/exec.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { celebrate, timer } from "../ui/spinner.js";
import { runTasks } from "../ui/tasks.js";

export interface BuildOpts {
  preset?: string;
  clean?: boolean;
  jobs?: string;
}

const PRESET_BY_TARGET: Record<string, string> = {
  esp32: "esp32",
  "cortex-m": "arm-cortex-m4",
  riscv: "riscv32",
  riscv64: "riscv64",
  zephyr: "host-debug",
  arduino: "host-debug",
  host: "host-debug",
};

export async function build(rawOpts: BuildOpts) {
  const cfg = loadProjectConfig();
  const preset = rawOpts.preset ?? (cfg?.target ? PRESET_BY_TARGET[String(cfg.target)] ?? "host-debug" : "host-debug");
  if (!isJson()) header(`Build (${preset})`);

  if (!(await hasTool("cmake"))) {
    const msg = "cmake not found — install CMake >= 3.20 + Ninja to build";
    if (isJson()) emitJson({ ok: false, error: msg });
    else { log.err(msg); process.exitCode = 1; }
    return;
  }
  if (!existsSync("CMakeLists.txt") && !existsSync("CMakePresets.json")) {
    log.warn("No CMakeLists.txt/CMakePresets.json in cwd — running preset configure anyway (may fail).");
  }

  const elapsed = timer();
  try {
    const ctx = await runTasks([
      {
        title: rawOpts.clean ? `Clean configure --preset ${preset}` : `Configure --preset ${preset}`,
        run: async () => {
          const args = rawOpts.clean ? ["--preset", preset, "--fresh"] : ["--preset", preset];
          const r = await execa("cmake", args, { reject: false });
          if (r.exitCode !== 0) throw new Error(r.stderr.slice(-500) || r.stdout.slice(-500) || "cmake configure failed");
        },
      },
      {
        title: "Compile",
        run: async () => {
          const r = await execa("cmake", ["--build", "--preset", preset, ...(rawOpts.jobs ? ["-j", rawOpts.jobs] : [])], { reject: false });
          if (r.exitCode !== 0) throw new Error(r.stderr.slice(-800) || "build failed");
        },
      },
      {
        title: "ctest",
        run: async (ctx, task) => {
          const r = await execa("ctest", ["--preset", preset, "--output-on-failure"], { reject: false });
          ctx.tests = r.exitCode === 0 ? "passed" : `exit ${r.exitCode}`;
          task.title = `ctest — ${ctx.tests as string}`;
        },
      },
    ]);
    const tests = String(ctx.tests ?? "skipped");
    if (isJson()) emitJson({ ok: true, preset, tests });
    else { celebrate(`Build ${preset} done`, elapsed()); log.dim(`ctest: ${tests}`); console.log(""); }
  } catch (e) {
    const msg = (e as Error).message;
    if (isJson()) emitJson({ ok: false, preset, error: msg });
    else { log.err(msg); process.exitCode = 1; }
  }
}
