import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { saveProjectConfig, SUPPORTED_TARGETS } from "../lib/config-store.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { celebrate, timer } from "../ui/spinner.js";
import { runTasks } from "../ui/tasks.js";
import { promptIfMissing } from "../ui/prompt.js";

export interface InitOpts {
  projectName?: string;
  target?: string;
  lep?: string;
  storage?: string;
  relayUrl?: string;
  traceUrl?: string;
  template?: string;
  git?: boolean;
  yes?: boolean;
}

const TARGET_PRESET: Record<string, string> = {
  esp32: "add_subdirectory(third_party/latch) # then idf_component_register / target_link_libraries(${PROJECT_NAME} PRIVATE laststate::latch)",
  "cortex-m": "add_subdirectory(third_party/latch)\ntarget_link_libraries(${PROJECT_NAME} PRIVATE laststate::latch)",
  riscv: "add_subdirectory(third_party/latch)\ntarget_link_libraries(${PROJECT_NAME} PRIVATE laststate::latch)",
  riscv64: "add_subdirectory(third_party/latch)\ntarget_link_libraries(${PROJECT_NAME} PRIVATE laststate::latch)",
  zephyr: "# zephyr: add latch as west module, then target_link_libraries(app PRIVATE laststate::latch)",
  arduino: "# arduino: copy latch/ into lib/, #include <latch/latch.h>",
  host: "add_subdirectory(third_party/latch)\ntarget_link_libraries(${PROJECT_NAME} PRIVATE laststate::latch)",
};

function mainC(project: string, target: string): string {
  const device = `${project.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-001`;
  const heapNote = target === "arduino" ? "/* constrained profile: breadcrumbs 16 */\n" : "";
  return `#include <latch/latch.h>
${heapNote}
static ls_transport_t *s_transport; /* register your UART/TCP transport here */

void app_init(void) {
    static ls_config_t cfg = {
        .device_id = "${device}",
        .firmware_version = "v1.0.0",
        .build_id = "dev-build",
        /* .storage = LS_STORAGE_FLASH, */
        /* .transport = s_transport, */
    };
    ls_init(&cfg);
    /* ls_transport_register(s_transport); -- register BEFORE ls_boot() */
    ls_boot();
    ls_breadcrumb("app:init");
}
`;
}

function cmakePatch(target: string): string {
  return `${TARGET_PRESET[target] ?? TARGET_PRESET["cortex-m"]}\n`;
}

export async function init(rawOpts: InitOpts) {
  const answered = await promptIfMissing<InitOpts>(
    [
      { type: "input", name: "projectName", message: "Project name:", default: rawOpts.projectName ?? "MyLastStateProject" },
      { type: "list", name: "target", message: "Target platform:", choices: [...SUPPORTED_TARGETS], default: rawOpts.target ?? "cortex-m" },
    ],
    rawOpts,
  );
  const name = answered.projectName ?? "MyLastStateProject";
  const target = (answered.target ?? "cortex-m").toLowerCase();
  const lep = parseInt(answered.lep ?? "2", 10) === 1 ? 1 : 2;
  const storage = answered.storage ?? "flash";
  const relayUrl = answered.relayUrl ?? "http://localhost:8384";
  const traceUrl = answered.traceUrl ?? "http://localhost:8080";

  // ASCII banner is printed by the global hook; keep the context line.
  log.dim(`${name} · target ${target} · LEPv${lep}`);

  const devToken = `dev-${randomBytes(9).toString("hex")}`;
  const dir = resolve(process.cwd(), name);
  const isNewDir = name !== "MyLastStateProject" && !existsSync(dir);
  const elapsed = timer();

  await runTasks([
    {
      title: "Scaffold files",
      run: async () => {
        const cfg = {
          project: name,
          target,
          lep_version: lep,
          storage,
          relay_url: relayUrl,
          trace_url: traceUrl,
          ingest_token: devToken,
        };
        // NOTE: devToken is local-dev only — rotate before any shared use
        if (isNewDir) {
          mkdirSync(dir, { recursive: true });
          saveProjectConfig(cfg as never, dir);
          writeFileSync(join(dir, "main.c"), mainC(name, target));
          writeFileSync(join(dir, "CMakeLists.patch.txt"), `# append to your CMakeLists.txt:\n${cmakePatch(target)}`);
          if (target === "esp32") {
            writeFileSync(join(dir, "partition.csv"), `# Name, Type, SubType, Offset, Size\nnvs,data,nvs,0x9000,0x6000\nphy_init,data,phy,0xf000,0x1000\nfactory,app,factory,0x10000,1M\n`);
          }
          writeFileSync(
            join(dir, ".gitignore"),
            `build/\n.env\n*.lep\nlaststate-spool/\n`,
          );
        } else {
          saveProjectConfig(cfg as never, process.cwd());
          if (!existsSync("main.c")) writeFileSync("main.c", mainC(name, target));
        }
      },
    },
    {
      title: "Git init",
      enabled: () => answered.git !== false,
      run: async () => {
        try {
          const cwd = isNewDir ? dir : process.cwd();
          const inside = await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd, reject: false });
          if (inside.exitCode !== 0) {
            await execa("git", ["init"], { cwd, reject: false });
          }
        } catch { /* best-effort */ }
      },
    },
  ]);

  const result = {
    ok: true,
    project: name,
    target,
    dir: isNewDir ? dir : process.cwd(),
    files: isNewDir
      ? [`${name}/laststate.yaml`, `${name}/main.c`, `${name}/CMakeLists.patch.txt`]
      : ["laststate.yaml", "main.c"],
    next: ["add #include <latch/latch.h>", "cmake --preset host-debug", "laststate mock", "laststate test"],
  };

  if (isJson()) {
    emitJson(result);
    return;
  }
  header("Done");
  celebrate(`${name} — ${result.files.length} files`, elapsed());
  log.dim(`CMake patch:\n  ${cmakePatch(target).split("\n").join("\n  ")}`);
  log.info("Next: laststate build && laststate mock && laststate test");
  console.log("");
}
