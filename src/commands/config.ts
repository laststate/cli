import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CONFIG_FILE = "laststate.yaml";

function parseYamlSimple(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(.+)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export async function config(action: string, key?: string, value?: string) {
  // commander subcommand shim: action is the subcommand string or undefined
  // Support: 'list', 'get <key>', 'set <key> <value>'
  const args = [action, key, value].filter(Boolean) as string[];
  const sub = args[0];

  if (!sub || sub === "list") {
    if (!existsSync(CONFIG_FILE)) {
      console.log(`  No ${CONFIG_FILE} found. Run 'laststate init' first.`);
      return;
    }
    const text = readFileSync(CONFIG_FILE, "utf8");
    console.log(`\n  ${CONFIG_FILE}:\n`);
    console.log(text);
    return;
  }
  if (sub === "get") {
    const k = args[1];
    if (!k) { console.error("  Usage: laststate config get <key>"); process.exitCode = 1; return; }
    if (!existsSync(CONFIG_FILE)) { console.error(`  No ${CONFIG_FILE}`); process.exitCode = 1; return; }
    const cfg = parseYamlSimple(readFileSync(CONFIG_FILE, "utf8"));
    console.log(cfg[k] ?? `(key '${k}' not set)`);
    return;
  }
  if (sub === "set") {
    const k = args[1], v = args[2];
    if (!k || v === undefined) { console.error("  Usage: laststate config set <key> <value>"); process.exitCode = 1; return; }
    let text = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf8") : "";
    const re = new RegExp(`^${k}:.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${k}: ${v}`);
    else text += `${k}: ${v}\n`;
    writeFileSync(CONFIG_FILE, text);
    console.log(`  Set ${k}=${v} in ${CONFIG_FILE}`);
    return;
  }
  console.error(`  Unknown config subcommand: ${sub}. Use: list | get <key> | set <key> <value>`);
  process.exitCode = 1;
}
