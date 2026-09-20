import { execa, type Options, type Result } from "execa";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { log } from "./logger.js";

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  reject?: boolean;
  verbose?: boolean;
}

export async function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<Result> {
  const execOpts: Options = {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>,
    reject: opts.reject ?? false,
  };
  if (opts.verbose) log.verbose(`$ ${cmd} ${args.join(" ")}`);
  const res = await execa(cmd, args, execOpts);
  return res;
}

export async function hasTool(cmd: string, args = ["--version"]): Promise<boolean> {
  try {
    const r = await execa(cmd, args, { reject: false, timeout: 8000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

export async function toolVersion(cmd: string, args = ["--version"]): Promise<string | null> {
  try {
    const r = await execa(cmd, args, { reject: false, timeout: 8000 });
    const out = `${r.stdout ?? ""} ${r.stderr ?? ""}`.trim().split("\n")[0] ?? "";
    return out.slice(0, 120) || null;
  } catch {
    return null;
  }
}

export function findRepoRootSync(cwd = process.cwd()): string | null {
  let cur = resolve(cwd);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(cur, "docker-compose.yml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
