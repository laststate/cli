import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { findRepoRootSync } from "./exec.js";
import { log } from "./logger.js";

export interface ComposeOpts {
  appliance?: boolean;
  services?: string[];
  build?: boolean;
  detached?: boolean;
  envFile?: string;
}

function composeBase(repoRoot: string, appliance?: boolean): string[] {
  const file = appliance ? "docker-compose.appliance.yml" : "docker-compose.yml";
  return ["compose", "-f", file];
}

export function resolveRepoRoot(cwd = process.cwd()): string {
  const fromSync = findRepoRootSync(cwd);
  if (fromSync) return fromSync;
  // fallback: cwd itself if it has a compose file, else cwd
  if (existsSync(join(cwd, "docker-compose.yml"))) return cwd;
  return cwd;
}

export async function composeUp(opts: ComposeOpts = {}, cwd = process.cwd()) {
  const root = resolveRepoRoot(cwd);
  const args = [...composeBase(root, opts.appliance), "up"];
  if (opts.detached !== false) args.push("-d");
  if (opts.build) args.push("--build");
  if (opts.services?.length) args.push(...opts.services);
  log.verbose(`$ docker ${args.join(" ")} (cwd=${root})`);
  const res = await execa("docker", args, { cwd: root, reject: false });
  return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, root };
}

export async function composeDown(opts: { appliance?: boolean; volumes?: boolean } = {}, cwd = process.cwd()) {
  const root = resolveRepoRoot(cwd);
  const args = [...composeBase(root, opts.appliance), "down"];
  if (opts.volumes) args.push("-v");
  const res = await execa("docker", args, { cwd: root, reject: false });
  return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, root };
}

export async function composePs(appliance = false, cwd = process.cwd()) {
  const root = resolveRepoRoot(cwd);
  const res = await execa("docker", [...composeBase(root, appliance), "ps", "--format", "json"], { cwd: root, reject: false });
  return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, root };
}

export async function composeLogs(service: string | undefined, follow: boolean, tail: string, appliance = false, cwd = process.cwd()) {
  const root = resolveRepoRoot(cwd);
  const args = [...composeBase(root, appliance), "logs", "--tail", tail];
  if (follow) args.push("-f");
  if (service) args.push(service);
  const res = await execa("docker", args, { cwd: root, reject: false, timeout: follow ? 30_000 : 15_000 });
  return { exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, root };
}

export async function hasDocker(): Promise<boolean> {
  try {
    const r = await execa("docker", ["--version"], { reject: false, timeout: 8000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}
