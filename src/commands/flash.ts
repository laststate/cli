import { execa } from "execa";
import { loadProjectConfig } from "../lib/config-store.js";
import { hasTool } from "../lib/exec.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { withSpinner } from "../ui/spinner.js";
import { confirm, promptIfMissing } from "../ui/prompt.js";

export interface FlashOpts {
  port?: string;
  baud?: string;
  monitor?: boolean;
  yes?: boolean;
}

export async function flash(rawOpts: FlashOpts) {
  const cfg = loadProjectConfig();
  const target = String(cfg?.target ?? "cortex-m").toLowerCase();
  const answered = await promptIfMissing<FlashOpts>(
    [{ type: "input", name: "port", message: "Serial port (e.g. COM3, /dev/ttyUSB0):", default: rawOpts.port ?? "" }],
    rawOpts,
  );
  if (!isJson()) header(`Flash (${target})`);

  if (target === "esp32") {
    if (!(await hasTool("idf.py", ["--version"]))) {
      const msg = "idf.py not found — install ESP-IDF and export.sh first";
      if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
      return;
    }
    const ok = await confirm(`Flash via 'idf.py flash${answered.monitor === false ? "" : " monitor"}'${answered.port ? ` -p ${answered.port}` : ""}?`, true);
    if (!ok) { log.warn("Aborted."); return; }
    await withSpinner("idf.py flash", async () => {
      const args = ["flash"];
      if (answered.port) args.push("-p", answered.port);
      if (answered.baud) args.push("-b", answered.baud);
      const r = await execa("idf.py", args, { reject: false, timeout: 300_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr.slice(-800) || "idf.py flash failed");
      if (answered.monitor !== false) log.info("Run 'idf.py monitor' to watch logs, then trigger a fault.");
    });
  } else if (target === "zephyr") {
    if (!(await hasTool("west", ["--version"]))) {
      const msg = "west not found — install Zephyr SDK first";
      if (isJson()) emitJson({ ok: false, error: msg }); else { log.err(msg); process.exitCode = 1; }
      return;
    }
    await withSpinner("west flash", async () => {
      const r = await execa("west", ["flash"], { reject: false, timeout: 300_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr.slice(-800) || "west flash failed");
    });
  } else {
    // cortex-m / riscv / generic: openocd hint + passthrough
    const hasOpenocd = await hasTool("openocd", ["--version"]);
    if (!hasOpenocd) {
      const msg = "openocd not found — install OpenOCD or flash with your probe tool (J-Link, pyOCD)";
      if (isJson()) emitJson({ ok: false, target, error: msg, hint: "confirm port/board before flashing (see latch/hil/AGENTS.md)" });
      else { log.warn(msg); log.dim("Confirm port/board before flashing (see latch/hil/AGENTS.md)."); }
      return;
    }
    const ok = await confirm(`Flash with OpenOCD on ${answered.port || "(default port)"}?`, true);
    if (!ok) { log.warn("Aborted."); return; }
    await withSpinner("openocd flash", async () => {
      const r = await execa("openocd", ["-f", "interface/stlink.cfg", "-f", "target/stm32f4x.cfg", "-c", "program build/firmware.elf verify reset exit"], { reject: false, timeout: 300_000 });
      if (r.exitCode !== 0) throw new Error(r.stderr.slice(-800) || "openocd failed — adjust cfg for your board");
    });
  }
  if (isJson()) emitJson({ ok: true, target });
  else { log.ok("Flash finished."); console.log(""); }
}
