import chalk from "chalk";

export interface GlobalFlags {
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  noBanner?: boolean;
  profile?: string;
}

let flags: GlobalFlags = {};
let jsonMode = false;

export function setGlobalFlags(f: GlobalFlags) {
  flags = f;
  jsonMode = !!f.json;
  if (f.noColor || process.env.NO_COLOR || process.env.CI) chalk.level = 0;
}

export function getFlags(): GlobalFlags {
  return flags;
}

export function isJson() {
  return jsonMode;
}

export function isVerbose() {
  return !!flags.verbose;
}

export function isYes() {
  return !!flags.yes;
}

function prefix() {
  return "";
}

export const log = {
  info(msg: string) {
    if (flags.quiet || jsonMode) return;
    console.log(`  ${chalk.cyan("›")} ${msg}`);
  },
  ok(msg: string) {
    if (flags.quiet || jsonMode) return;
    console.log(`  ${chalk.green("✓")} ${msg}`);
  },
  warn(msg: string) {
    if (flags.quiet) return;
    if (jsonMode) { console.error(msg); return; }
    console.log(`  ${chalk.yellow("!")} ${msg}`);
  },
  err(msg: string) {
    console.error(`  ${chalk.red("✗")} ${msg}`);
  },
  dim(msg: string) {
    if (flags.quiet || jsonMode) return;
    console.log(chalk.dim(`  ${msg}`));
  },
  raw(msg: string) {
    if (flags.quiet) return;
    console.log(msg);
  },
  blank() {
    if (flags.quiet || jsonMode) return;
    console.log("");
  },
  verbose(msg: string) {
    if (!flags.verbose || jsonMode || flags.quiet) return;
    console.log(chalk.dim(`  [verbose] ${msg}`));
  },
};

export function emitJson(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export function fatal(msg: string, code = 1): never {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  } else {
    log.err(msg);
  }
  process.exitCode = code;
  throw new Error(msg);
}

export { chalk, prefix };
