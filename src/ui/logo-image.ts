import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import chalk from "chalk";
import { crc32 } from "../lib/crc32.js";
import { hexToRgb, brandRgbAt } from "./palette.js";

/**
 * True-pixel LastState logo for terminals. No animation — just the image.
 *
 * Source priority:
 *  1. `assets/brand.gif` — user-supplied animated override (iTerm2).
 *  2. `assets/brand.png` — real render of `brand.svg` (shipped, 2x, black bg).
 *  3. Built-in software raster (fallback when files are missing).
 *
 * Protocols: Sixel (Windows Terminal ≥ 1.22, foot, mlterm, contour),
 * PNG + OSC 1337 (iTerm2, WezTerm), PNG + Kitty graphics (Kitty, Ghostty).
 * Anything else gets truecolor half-block ASCII art generated from the
 * same pixels — no hand-drawn shapes, no animation, scripts never break.
 */

type Pt = [number, number];

// ─── Built-in raster geometry (SVG viewBox units, from assets/brand.svg) ────
const STROKE_PTS: Pt[] = [
  [24, 102],
  [101.775, 102],
  [153.26, 31],
  [311, 31],
];
const STROKE_W = 31;
const SLASH_WHITE: Pt[] = [
  [239, 116],
  [273.714, 116],
  [311, 58],
  [277.571, 58],
];
const SLASH_GRAD: Pt[] = [
  [284, 116],
  [391.728, 116],
  [436, 58],
  [320.893, 58],
];
const GRAD_A: Pt = [278.097, 118.698];
const GRAD_B: Pt = [433.625, 40.643];

const S = 0.5;
const OX = 8.5;
const OY = 15.5;
const LOGO_W = 540;
const LOGO_H = 52;
const FONT_SCALE = 6;
const TEXT_X_SVG = 449;
const TEXT_BASELINE_SVG = 116;

// ─── 5x7 bitmap font (only glyphs needed for "LastState") ────────────────────
export const FONT: Record<string, string[]> = {
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".###."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: ["..#..", "..#..", "#####", "..#..", "..#..", "..#..", "..##."],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  "?": ["#####", "#...#", "..##.", "...#.", "...#.", ".....", "...#."],
};
const FONT_ADVANCE = 6 * FONT_SCALE;

// ─── Pixel buffers ───────────────────────────────────────────────────────────
export interface Pixels {
  w: number;
  h: number;
  data: Uint8Array; // RGB
}

function distToSeg(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

/** Point in convex quad (same winding on all 4 edges). */
function inQuad(px: number, py: number, q: Pt[]): boolean {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cur = sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
    if (cur === 0) continue;
    if (s === 0) s = cur;
    else if (s !== cur) return false;
  }
  return true;
}

function gradT(px: number, py: number): number {
  const dx = GRAD_B[0] - GRAD_A[0];
  const dy = GRAD_B[1] - GRAD_A[1];
  const t = ((px - GRAD_A[0]) * dx + (py - GRAD_A[1]) * dy) / (dx * dx + dy * dy);
  return Math.max(0, Math.min(1, t));
}

function drawText(data: Uint8Array, text: string): void {
  const pen0 = Math.round((TEXT_X_SVG - OX) * S);
  const top = Math.round((TEXT_BASELINE_SVG - OY) * S) - 7 * FONT_SCALE;
  [...text].forEach((ch, ci) => {
    const glyph = FONT[ch] ?? FONT["?"];
    const gx0 = pen0 + ci * FONT_ADVANCE;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== "#") continue;
        for (let dy = 0; dy < FONT_SCALE; dy++) {
          for (let dx = 0; dx < FONT_SCALE; dx++) {
            const x = gx0 + gx * FONT_SCALE + dx;
            const y = top + gy * FONT_SCALE + dy;
            if (x < 0 || y < 0 || x >= LOGO_W || y >= LOGO_H) continue;
            const o = (y * LOGO_W + x) * 3;
            data[o] = 255;
            data[o + 1] = 255;
            data[o + 2] = 255;
          }
        }
      }
    }
  });
}

/** Fallback raster (used only when brand.png is missing). */
export function renderLogoPixels(): Pixels {
  const data = new Uint8Array(LOGO_W * LOGO_H * 3);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= LOGO_W || y >= LOGO_H) return;
    const o = (y * LOGO_W + x) * 3;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
  };
  const svgX = (x: number) => (x - OX) * S;
  const svgY = (y: number) => (y - OY) * S;

  const hw = STROKE_W / 2;
  for (let s = 0; s < STROKE_PTS.length - 1; s++) {
    const a = STROKE_PTS[s];
    const b = STROKE_PTS[s + 1];
    const minX = Math.floor(svgX(Math.min(a[0], b[0]) - hw));
    const maxX = Math.ceil(svgX(Math.max(a[0], b[0]) + hw));
    const minY = Math.floor(svgY(Math.min(a[1], b[1]) - hw));
    const maxY = Math.ceil(svgY(Math.max(a[1], b[1]) + hw));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (distToSeg(OX + x / S, OY + y / S, a, b) <= hw) set(x, y, 255, 255, 255);
      }
    }
  }

  for (const { q, grad } of [
    { q: SLASH_WHITE, grad: false },
    { q: SLASH_GRAD, grad: true },
  ]) {
    const xs = q.map((p) => p[0]);
    const ys = q.map((p) => p[1]);
    const minX = Math.floor(svgX(Math.min(...xs)));
    const maxX = Math.ceil(svgX(Math.max(...xs)));
    const minY = Math.floor(svgY(Math.min(...ys)));
    const maxY = Math.ceil(svgY(Math.max(...ys)));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const sx = OX + x / S;
        const sy = OY + y / S;
        if (!inQuad(sx, sy, q)) continue;
        if (!grad) set(x, y, 255, 255, 255);
        else {
          const [r, g, b] = brandRgbAt(gradT(sx, sy));
          set(x, y, r, g, b);
        }
      }
    }
  }

  drawText(data, "LastState");
  return { w: LOGO_W, h: LOGO_H, data };
}

// ─── PNG decoder (8-bit, RGB/RGBA, non-interlaced) ────────────────────────────
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Uint8Array): Pixels {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  const depth = b[24];
  const color = b[25];
  if (depth !== 8 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG (depth ${depth}, color ${color})`);
  if (b[28] !== 0) throw new Error("interlaced PNG not supported");
  const channels = color === 2 ? 3 : 4;
  const idat: Buffer[] = [];
  let off = 8;
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (type === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === "IEND") break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const data = new Uint8Array(w * h * 3);
  const prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const cur = raw.subarray(p, p + stride);
    p += stride;
    const bpp = channels;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const bb = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v: number = cur[i];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + bb) & 0xff;
      else if (f === 3) v = (v + ((a + bb) >> 1)) & 0xff;
      else if (f === 4) v = (v + paeth(a, bb, c)) & 0xff;
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      data[o] = cur[x * channels];
      data[o + 1] = cur[x * channels + 1];
      data[o + 2] = cur[x * channels + 2];
    }
    cur.copy(prev);
  }
  return { w, h, data };
}

/** Box downscale (for Sixel payloads). */
export function downscale(src: Pixels, targetW: number): Pixels {
  if (src.w <= targetW) return src;
  const s = src.w / targetW;
  const w = targetW;
  const h = Math.max(1, Math.round(src.h / s));
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * s);
      const x1 = Math.min(src.w, Math.ceil((x + 1) * s));
      const y0 = Math.floor(y * s);
      const y1 = Math.min(src.h, Math.ceil((y + 1) * s));
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * src.w + xx) * 3;
          r += src.data[o];
          g += src.data[o + 1];
          bl += src.data[o + 2];
          n++;
        }
      }
      const o = (y * w + x) * 3;
      data[o] = Math.round(r / n);
      data[o + 1] = Math.round(g / n);
      data[o + 2] = Math.round(bl / n);
    }
  }
  return { w, h, data };
}

// ─── PNG encoder (8-bit RGB, no filter) ───────────────────────────────────────
function pngChunk(type: string, body: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.from(type, "ascii");
  const bb = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, bb])));
  return Buffer.concat([len, tb, bb, crc]);
}

export function renderLogoPng(): Buffer {
  const { w, h, data } = renderLogoPixels();
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(data.buffer, y * w * 3, w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

// ─── Sixel encoder ────────────────────────────────────────────────────────────
const RAMP: Array<[number, number, number]> = Array.from({ length: 8 }, (_, i) => {
  const t = i / 7;
  return hexToRgb(
    "#" +
      brandRgbAt(t)
        .map((v) => v.toString(16).padStart(2, "0"))
        .join(""),
  );
});

function rasterIndex(data: Uint8Array, w: number, x: number, y: number): number {
  const o = (y * w + x) * 3;
  const r = data[o];
  const g = data[o + 1];
  const b = data[o + 2];
  if (r > 200 && g > 200 && b > 200) return 1;
  if (r < 40 && g < 40 && b < 40) return 0;
  let best = 2;
  let bestD = Infinity;
  for (let i = 0; i < RAMP.length; i++) {
    const [rr, gg, bb] = RAMP[i];
    const d = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i + 2;
    }
  }
  return best;
}

/** Top-frequency palette: black #0, white #1, then most-used colors. */
export function paletteFromPixels(px: Pixels, maxColors = 254): Array<[number, number, number]> {
  const freq = new Map<number, number>();
  for (let i = 0; i < px.data.length; i += 3) {
    const r = px.data[i];
    const g = px.data[i + 1];
    const b = px.data[i + 2];
    if (r < 24 && g < 24 && b < 24) continue; // black handled by #0
    if (r > 240 && g > 240 && b > 240) continue; // white handled by #1
    const key = (r << 16) | (g << 8) | b;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors);
  return [
    [0, 0, 0],
    [255, 255, 255],
    ...top.map(([k]): [number, number, number] => [(k >> 16) & 0xff, (k >> 8) & 0xff, k & 0xff]),
  ];
}

function nearestIndex(pal: Array<[number, number, number]>, r: number, g: number, b: number): number {
  if (r < 24 && g < 24 && b < 24) return 0;
  if (r > 240 && g > 240 && b > 240) return 1;
  let best = 2;
  let bestD = Infinity;
  for (let i = 2; i < pal.length; i++) {
    const [rr, gg, bb] = pal[i];
    const d = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best;
}

export function sixelEncode(px: Pixels, pal: Array<[number, number, number]>, index: (x: number, y: number) => number): string {
  const { w, h } = px;
  let out = `\x1bPq"1;1;${w};${h}`;
  pal.forEach(([r, g, b], i) => {
    out += `#${i};2;${Math.round((r / 255) * 100)};${Math.round((g / 255) * 100)};${Math.round((b / 255) * 100)}`;
  });
  const bands = Math.ceil(h / 6);
  for (let band = 0; band < bands; band++) {
    const cells = new Map<number, Int8Array>();
    const used: number[] = [];
    for (let c = 0; c < pal.length; c++) {
      const arr = new Int8Array(w);
      let any = false;
      for (let x = 0; x < w; x++) {
        let bits = 0;
        for (let r = 0; r < 6; r++) {
          const y = band * 6 + r;
          if (y >= h) break;
          if (index(x, y) === c) bits |= 1 << r;
        }
        arr[x] = bits;
        if (bits) any = true;
      }
      if (any) {
        used.push(c);
        cells.set(c, arr);
      }
    }
    if (used.length === 0) {
      out += "-";
      continue;
    }
    used.forEach((c, pi) => {
      out += `#${c}`;
      const arr = cells.get(c)!;
      let mn = 0;
      while (mn < w && arr[mn] === 0) mn++;
      let mx = w - 1;
      while (mx >= 0 && arr[mx] === 0) mx--;
      if (mn > 0) out += `!${mn}?`;
      let i = mn;
      while (i <= mx) {
        const v = arr[i];
        let n = 1;
        while (i + n <= mx && arr[i + n] === v && n < 255) n++;
        const ch = String.fromCharCode(63 + v);
        out += n > 1 ? `!${n}${ch}` : ch;
        i += n;
      }
      out += pi < used.length - 1 ? "$" : "-";
    });
  }
  out += "\x1b\\";
  return out;
}

/** Sixel from the built-in raster (10-color ramp palette). */
export function renderLogoSixel(): string {
  const px = renderLogoPixels();
  const pal: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], ...RAMP];
  return sixelEncode(px, pal, (x, y) => rasterIndex(px.data, px.w, x, y));
}

/** Sixel from arbitrary pixels (frequency palette — best for the real PNG). */
export function sixelFromPixels(px: Pixels): string {
  const pal = paletteFromPixels(px);
  const cache = new Map<number, number>();
  const at = (x: number, y: number): number => {
    const o = (y * px.w + x) * 3;
    const r = px.data[o];
    const g = px.data[o + 1];
    const b = px.data[o + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let v = cache.get(key);
    if (v === undefined) {
      v = nearestIndex(pal, r, g, b);
      cache.set(key, v);
    }
    return v;
  };
  return sixelEncode(px, pal, at);
}

// ─── Braille ASCII art (fallback for non-image terminals) ─────────────────────
// Braille dot bits by (dx, dy): cols carry dots 1,2,3,7 / 4,5,6,8.
const BRAILLE_COL = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

export function asciiFromPixels(px: Pixels, cols = 100): string {
  const dotW = px.w / (cols * 2);
  const dotH = dotW; // square dots
  const rows = Math.max(4, Math.round(px.h / (dotH * 4)));
  const colored = chalk.level > 0;
  const sample = (dx: number, dy: number): [number, number, number] => {
    const x0 = Math.floor(dx * dotW);
    const x1 = Math.min(px.w, Math.ceil((dx + 1) * dotW));
    const y0 = Math.floor(dy * dotH);
    const y1 = Math.min(px.h, Math.ceil((dy + 1) * dotH));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * px.w + x) * 3;
        r += px.data[o];
        g += px.data[o + 1];
        b += px.data[o + 2];
        n++;
      }
    }
    if (n === 0) return [0, 0, 0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const lines: string[] = [];
  const coverage: number[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    let lit = 0;
    for (let c = 0; c < cols; c++) {
      let bits = 0;
      let lr = 0;
      let lg = 0;
      let lb = 0;
      let ln = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const col = sample(c * 2 + dx, r * 4 + dy);
          if (lum(col) > 90) {
            bits |= BRAILLE_COL[dx][dy];
            lr += col[0];
            lg += col[1];
            lb += col[2];
            ln++;
          }
        }
      }
      if (bits === 0) {
        line += " ";
        continue;
      }
      lit++;
      const ch = String.fromCharCode(0x2800 + bits);
      if (!colored) {
        line += ch;
        continue;
      }
      const hex = `#${Math.round(lr / ln)
        .toString(16)
        .padStart(2, "0")}${Math.round(lg / ln)
        .toString(16)
        .padStart(2, "0")}${Math.round(lb / ln)
        .toString(16)
        .padStart(2, "0")}`;
      line += chalk.hex(hex)(ch);
    }
    lines.push(line.replace(/\s+$/, ""));
    coverage.push(lit / cols);
  }
  // trim near-empty edge rows (baseline noise)
  let start = 0;
  while (start < lines.length && coverage[start] < 0.02) start++;
  let end = lines.length;
  while (end > start && coverage[end - 1] < 0.02) end--;
  return lines.slice(start, end).join("\n");
}

// ─── Source resolution ───────────────────────────────────────────────────────
function assetDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "assets"), join(here, "..", "..", "assets")];
  for (const c of candidates) {
    if (existsSync(join(c, "brand.svg"))) return c;
  }
  return candidates[0];
}

export function brandAssetPath(name: "brand.png" | "brand.gif" | "brand.svg"): string | null {
  const p = join(assetDir(), name);
  return existsSync(p) ? p : null;
}

/** Best available pixels: real brand.png, else built-in raster. */
export function getLogoPixels(): { px: Pixels; real: boolean } {
  const file = brandAssetPath("brand.png");
  if (file) {
    try {
      return { px: decodePng(new Uint8Array(readFileSync(file))), real: true };
    } catch {
      // fall through to raster
    }
  }
  return { px: renderLogoPixels(), real: false };
}

/** Static ASCII logo generated from the real pixels (no animation). */
export function logoAscii(cols = 100): string {
  return asciiFromPixels(getLogoPixels().px, cols);
}
