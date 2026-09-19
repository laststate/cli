import chalk from "chalk";
import CliProgress from "cli-progress";
import { getFlags } from "../lib/logger.js";

export const theme = {
  primary: chalk.hex("#7757F7"),
  ok: chalk.green,
  warn: chalk.yellow,
  err: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
  title: (s: string) => chalk.bold.hex("#D07BFA")(s),
  /** Brand gradient stops from the logo SVG (#4357EE → #7757F7 → #D07BFA). */
  brand: {
    indigo: chalk.hex("#4357EE"),
    violet: chalk.hex("#7757F7"),
    pink: chalk.hex("#D07BFA"),
  },
};

export function statusIcon(state: "pass" | "fail" | "skip"): string {
  if (state === "pass") return chalk.green("✓");
  if (state === "fail") return chalk.red("✗");
  return chalk.dim("-");
}
