/** Shared LastState brand palette (from the logo SVG gradient). */
export const BRAND_STOPS = ["#4357EE", "#7757F7", "#D07BFA"] as const;
export const BRAND_TAGLINE = "Latch → LEP → Relay → Trace";

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Interpolated brand color at position t in [0,1] across the 3 stops. */
export function brandColorAt(t: number): string {
  const c = ((t % 1) + 1) % 1;
  const segs = BRAND_STOPS.length - 1;
  const pos = c * segs;
  const i = Math.min(Math.floor(pos), segs - 1);
  const f = pos - i;
  const [r1, g1, b1] = hexToRgb(BRAND_STOPS[i]);
  const [r2, g2, b2] = hexToRgb(BRAND_STOPS[i + 1]);
  const r = lerp(r1, r2, f).toString(16).padStart(2, "0");
  const g = lerp(g1, g2, f).toString(16).padStart(2, "0");
  const b = lerp(b1, b2, f).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

/** Interpolated brand RGB at position t in [0,1]. */
export function brandRgbAt(t: number): [number, number, number] {
  return hexToRgb(brandColorAt(t));
}
