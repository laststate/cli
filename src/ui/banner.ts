import { theme } from "./theme.js";
import { getFlags } from "../lib/logger.js";
import { logoStatic } from "./brand.js";

function suppressed(): boolean {
  const f = getFlags();
  return !!(f.noBanner || f.json || f.quiet || process.env.CI);
}

/**
 * Brand banner: ASCII logo on every command (no images, no animation).
 * Honors --no-banner / --json / --quiet / CI.
 */
export function banner(title: string, subtitle?: string) {
  if (suppressed()) return;
  console.log(logoStatic());
  const line = subtitle || title;
  if (line) console.log(theme.dim(`  ${line}`));
}

export function header(title: string) {
  const f = getFlags();
  if (f.json || f.quiet) return;
  console.log(`\n  ${theme.title(title)}\n`);
}

export function sectionDone(msg?: string) {
  const f = getFlags();
  if (f.json || f.quiet) return;
  if (msg) console.log(theme.dim(`  ${msg}`));
  console.log("");
}
