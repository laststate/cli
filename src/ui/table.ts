import Table from "cli-table3";
import { getFlags } from "../lib/logger.js";
import { statusIcon } from "./theme.js";

export function printTable(head: string[], rows: string[][]) {
  if (getFlags().json) return;
  const t = new Table({ head, style: { head: ["cyan"], border: ["grey"] }, wordWrap: true });
  for (const r of rows) t.push(r);
  console.log(t.toString());
}

export function printChecks(checks: Array<{ check: string; state: "pass" | "fail" | "skip"; hint: string }>, verbose: boolean) {
  if (getFlags().json) return;
  for (const c of checks) {
    const extra = verbose ? ` — ${c.hint}` : "";
    console.log(`  ${statusIcon(c.state)} ${c.check}${extra}`);
  }
}
