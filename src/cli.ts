import { Command } from "commander";
import { getFlags, setGlobalFlags } from "./lib/logger.js";
import { logoStatic } from "./ui/brand.js";
import { init } from "./commands/init.js";
import { test } from "./commands/test.js";
import { mock } from "./commands/mock.js";
import { analyze } from "./commands/analyze.js";
import { config, configList, configGet, configSet, configPaths, configGenerateSecrets, configPreflight } from "./commands/config.js";
import { build } from "./commands/build.js";
import { flash } from "./commands/flash.js";
import { ingest } from "./commands/ingest.js";
import { symbolicateUpload, symbolicateResolve } from "./commands/symbolicate.js";
import { up, down, ps, logs, status } from "./commands/stack.js";
import { simRun, simStop } from "./commands/sim.js";
import { deploy, doctor, updateCheck } from "./commands/ops.js";
import { brand } from "./commands/brand.js";

export const VERSION = "1.2.0";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("laststate")
    .description("LastState CLI — Latch → LEP → Relay → Trace. Scaffold, build, flash, test, mock, ingest, analyze.")
    .version(VERSION)
    .option("--json", "Machine-readable JSON output")
    .option("--yes", "Non-interactive: skip wizards, accept defaults")
    .option("--verbose", "Verbose output")
    .option("--quiet", "Minimal output")
    .option("--no-color", "Disable colors")
    .option("--no-banner", "Disable banners")
    .option("--profile <name>", "Config profile")
    .hook("preAction", (thisCommand, actionCommand) => {
      const o = thisCommand.optsWithGlobals?.() ?? thisCommand.opts();
      // NOTE: commander maps --no-x to {x:false}, not {noX:true}.
      setGlobalFlags({
        json: !!o.json,
        yes: !!o.yes,
        verbose: !!o.verbose,
        quiet: !!o.quiet,
        noColor: (o as Record<string, unknown>).color === false || !!o.noColor,
        noBanner: (o as Record<string, unknown>).banner === false || !!o.noBanner,
        profile: o.profile,
      });
      // ASCII banner on every command (except brand, which prints its own).
      // Skipped with --no-banner / --json / --quiet / CI.
      const leaf = actionCommand ?? thisCommand;
      const parts: string[] = [];
      let c: Command | null = leaf as Command;
      while (c && c.name() !== "laststate") {
        parts.unshift(c.name());
        c = c.parent ?? null;
      }
      if (parts[0] === "brand") return;
      const f = getFlags();
      if (f.noBanner || f.json || f.quiet || process.env.CI) return;
      console.log(logoStatic());
    });

  program.command("init").description("Initialize a new LastState project (wizard)")
    .option("--project-name <name>", "Name of the project")
    .option("--target <target>", "Target: esp32|cortex-m|riscv|riscv64|zephyr|arduino|host")
    .option("--lep <v>", "LEP version 1|2", "2")
    .option("--storage <s>", "Storage: flash|rtc|ram", "flash")
    .option("--relay-url <url>", "Relay URL", "http://localhost:8384")
    .option("--trace-url <url>", "Trace URL", "http://localhost:8080")
    .option("--no-git", "Skip git init")
    .action(init);

  program.command("build").description("Configure + build firmware (cmake presets + ctest)")
    .option("--preset <p>", "CMake preset (host-debug|arm-cortex-m4|riscv32|riscv64)")
    .option("--clean", "Fresh configure")
    .option("--jobs <n>", "Parallel jobs")
    .action(build);

  program.command("flash").description("Flash firmware (idf.py / west / openocd)")
    .option("--port <port>", "Serial port")
    .option("--baud <baud>", "Baud rate")
    .option("--no-monitor", "Skip monitor after flash")
    .action(flash);

  program.command("test").description("Test Latch integration (static probes + LEP vectors, honest -/✓/✗)")
    .option("--verbose", "Verbose output")
    .option("--filter <s>", "Filter checks by name")
    .option("--vectors-path <p>", "Path to protocol/test-vectors")
    .action(test);

  program.command("mock").description("Run mock Trace/Relay for development")
    .option("--port <port>", "Port", "8080")
    .option("--host <host>", "Host", "localhost")
    .option("--require-auth", "Require Bearer auth")
    .option("--token <t>", "Expected bearer token")
    .option("--no-cors", "Disable CORS header")
    .option("--no-log-ingest", "Silence ingest logs")
    .action(mock);

  program.command("ingest").alias("send").description("Send .lep file(s) to Relay/Trace")
    .argument("[file]", "LEP file or directory")
    .option("--to <dst>", "relay|trace", "relay")
    .option("--url <url>", "Ingest base URL")
    .option("--token <t>", "Bearer token (or env LASTSTATE_INGEST_TOKEN)")
    .action(ingest);

  program.command("analyze").description("Decode LEP envelope(s): header, CRC, TLVs, framing")
    .argument("<file>", "LEP file (.lep/.hex/.bin) or directory")
    .option("--output-format <format>", "Output format (json, text)", "text")
    .option("--deframe <m>", "Deframe hint (auto|cobs|latch-stream|raw)", "auto")
    .option("--tlv", "Show TLV table (default on)")
    .action(analyze);

  const sym = program.command("symbolicate").description("ELF artifacts + addr resolution");
  sym.command("upload-artifact").description("Upload ELF to Trace").argument("<elf>", "ELF file")
    .option("--url <url>", "Trace URL").option("--token <t>", "Token").action(symbolicateUpload);
  sym.command("resolve").description("Resolve addresses (llvm-symbolizer/addr2line)").argument("<addrs...>", "Hex addresses")
    .option("--elf <elf>", "ELF file").action((a: string[], o: { elf?: string }) => symbolicateResolve(a, o));

  const cfg = program.command("config").description("Manage configuration");
  cfg.command("list").description("List project + .env + global").action(() => configList());
  cfg.command("get").description("Get a value").argument("<key>", "key").action((k: string) => configGet(k));
  cfg.command("set").description("Set a value").argument("<key>", "key").argument("<value>", "value").action((k: string, v: string) => configSet(k, v));
  cfg.command("paths").description("Show config file paths").action(() => configPaths());
  cfg.command("generate-secrets").description("Generate secrets into .env").option("--only-missing", "Only fill missing/weak", true).option("--env-file <p>", ".env path", ".env").action((o: { onlyMissing?: boolean; envFile?: string }) => configGenerateSecrets({ onlyMissing: o.onlyMissing, envPath: o.envFile }));
  cfg.command("preflight").description("Check placeholders/weak secrets").option("--deploy-env <e>", "local|production").action((o: { deployEnv?: string }) => configPreflight({ deployEnv: o.deployEnv }));

  program.command("up").description("docker compose up (local dev or appliance)")
    .option("--appliance", "Use docker-compose.appliance.yml")
    .option("--build", "Build images")
    .option("--no-sim", "Skip simulator service")
    .option("--services <list>", "Comma-separated services")
    .option("--wait-timeout <ms>", "Health wait ms", "60000")
    .option("--open", "Open Trace UI in browser")
    .action(up);

  program.command("down").description("docker compose down")
    .option("--appliance", "Appliance file").option("--volumes", "Remove volumes too").action(down);

  program.command("ps").description("List stack services").option("--appliance", "Appliance file").action(ps);

  program.command("logs").description("Tail stack logs").argument("[service]", "Service name")
    .option("--follow", "Follow").option("--tail <n>", "Lines", "100").option("--appliance", "Appliance file").action((svc: string | undefined, o: { follow?: boolean; tail?: string; appliance?: boolean }) => logs({ service: svc, follow: o.follow, tail: o.tail, appliance: o.appliance }));

  program.command("status").description("Check Trace/Relay health + capabilities").option("--url <url>", "Trace URL", "http://localhost:8080").action(status);

  const sim = program.command("sim").description("Fleet simulator (docker)");
  sim.command("run").description("Start simulator").option("--scenario <s>", "demo|steady|crash-storm|outage|recovery|boot-loop", "demo")
    .option("--rate <n>", "Events/sec").option("--devices <n>", "Device count").option("--duration <s>", "Auto-stop seconds").action(simRun);
  sim.command("stop").description("Stop simulator").action(() => simStop());

  program.command("deploy").description("Secrets + preflight + compose up (local|production|appliance|k8s)")
    .option("--env <e>", "local|production|appliance|k8s", "local").option("--no-only-missing", "Regenerate all secrets").option("--no-build", "Skip --build").action(deploy);

  program.command("doctor").description("Environment audit (tools, configs, secrets, endpoints)").option("--fix", "Auto-fix missing secrets").option("--verbose", "Verbose").action(doctor);

  program.command("update").description("Check for CLI updates").option("--check", "Check only").action(() => updateCheck());

  program.command("brand").description("Show the LastState logo (image by default)").action(brand);

  return program;
}
