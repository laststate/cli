import chalk from "chalk";
import { BRAND_STOPS, BRAND_TAGLINE, brandColorAt } from "./palette.js";
import { brandAssetPath, logoAscii } from "./logo-image.js";

export { BRAND_STOPS, BRAND_TAGLINE, brandAssetPath };

/**
 * LastState brand for the terminal: ASCII art only (no images,
 * no animation). The art is generated from the real logo pixels,
 * so it always matches the mark. Scripts/CI/pipes use the same
 * quiet static path via --json / --quiet / --no-banner.
 */

export function gradientText(text: string, offset = 0): string {
  const chars = [...text];
  if (chars.length === 0) return "";
  return chars
    .map((ch, i) => {
      if (ch === " ") return ch;
      return chalk.hex(brandColorAt(offset + i / Math.max(chars.length, 1)))(ch);
    })
    .join("");
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** ASCII logo (braille art from the real logo pixels). */
export function logoStatic(): string {
  return logoAscii();
}
