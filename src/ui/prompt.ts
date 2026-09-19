import * as clack from "@clack/prompts";
import { getFlags } from "../lib/logger.js";

export interface PromptQuestion {
  type?: "input" | "list" | "confirm" | string;
  name?: string;
  message?: string;
  default?: unknown;
  choices?: Array<string | { name?: string; value?: unknown }>;
}

function cancelled(): never {
  clack.cancel("Cancelled.");
  process.exit(1);
}

async function askOne(q: PromptQuestion): Promise<unknown> {
  if (q.type === "list") {
    const options = (q.choices ?? []).map((c) =>
      typeof c === "string" ? { value: c, label: c } : { value: c.value ?? c.name, label: String(c.name ?? c.value) },
    );
    const out = await clack.select({ message: q.message ?? "", options, initialValue: q.default });
    if (clack.isCancel(out)) cancelled();
    return out;
  }
  if (q.type === "confirm") {
    const out = await clack.confirm({ message: q.message ?? "", initialValue: (q.default as boolean | undefined) ?? true });
    if (clack.isCancel(out)) cancelled();
    return out;
  }
  const out = await clack.text({
    message: q.message ?? "",
    defaultValue: q.default !== undefined && q.default !== "" ? String(q.default) : undefined,
    placeholder: q.default !== undefined && q.default !== "" ? String(q.default) : undefined,
  });
  if (clack.isCancel(out)) cancelled();
  return (out as string) || "";
}

export async function promptIfMissing<T>(questions: PromptQuestion | PromptQuestion[], provided: Partial<T>): Promise<T> {
  if (getFlags().yes) return provided as T;
  // only ask for keys not already provided
  const list = Array.isArray(questions) ? questions : [questions];
  const missing = list.filter((q) => {
    const n = q.name as keyof T | undefined;
    if (!n) return true;
    const v = provided[n];
    return v === undefined || v === "" || v === null;
  });
  if (missing.length === 0) return provided as T;
  // skip prompts in non-TTY (CI) — return as-is
  if (!process.stdin.isTTY) return provided as T;
  const out = { ...provided } as Record<string, unknown>;
  for (const q of missing) {
    if (q.name) out[q.name] = await askOne(q);
  }
  return out as T;
}

export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  if (getFlags().yes) return true;
  if (!process.stdin.isTTY) return defaultValue;
  const out = await clack.confirm({ message, initialValue: defaultValue });
  if (clack.isCancel(out)) cancelled();
  return !!out;
}
