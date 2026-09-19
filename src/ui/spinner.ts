import ora, { type Ora } from "ora";
import chalk from "chalk";
import { getFlags, isJson, log } from "../lib/logger.js";

/** Brand arc spinner — echoes the angular SVG mark, magenta/violet. */
export const BRAND_SPINNER = {
  frames: ["◜", "◠", "◝", "◞", "◡", "◟"],
  interval: 80,
};

export const BRAND_SUCCESS = chalk.hex("#7757F7")("◆");

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Starts a wall-clock timer; call the returned fn for a "3.1s" label. */
export function timer(): () => string {
  const t0 = Date.now();
  return () => fmtDuration(Date.now() - t0);
}

export function spinner(text: string): Ora {
  return ora({
    text,
    spinner: BRAND_SPINNER,
    color: "magenta",
    isEnabled: !isJson() && !process.env.CI && !getFlags().quiet,
  });
}

/** Rewrites the running spinner line (no-op when spinners are disabled). */
export function spinUpdate(s: Ora, text: string): void {
  s.text = text;
}

export async function withSpinner<T>(text: string, fn: (s: Ora) => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const s = spinner(text).start();
  try {
    const r = await fn(s);
    s.succeed(`${BRAND_SUCCESS} ${text} · ${fmtDuration(Date.now() - t0)}`);
    return r;
  } catch (e) {
    s.fail(`${text} — ${(e as Error).message}`);
    throw e;
  }
}

export async function steps<T>(title: string, items: Array<{ label: string; run: () => Promise<T> }>): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) {
    const t0 = Date.now();
    const s = spinner(`${title} — ${item.label}`).start();
    try {
      out.push(await item.run());
      s.succeed(`${BRAND_SUCCESS} ${item.label} · ${fmtDuration(Date.now() - t0)}`);
    } catch (e) {
      s.fail(`${item.label}: ${(e as Error).message}`);
      throw e;
    }
  }
  return out;
}

/** Light celebratory closing line: `  ◆ Stack up · done in 3.1s`. */
export function celebrate(msg: string, elapsed?: string): void {
  if (getFlags().json || getFlags().quiet) return;
  const suffix = elapsed ? chalk.dim(` · done in ${elapsed}`) : "";
  log.raw(`  ${BRAND_SUCCESS} ${msg}${suffix}`);
}
