import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderLogoPixels,
  renderLogoPng,
  renderLogoSixel,
  decodePng,
  downscale,
  sixelFromPixels,
  asciiFromPixels,
  getLogoPixels,
  FONT,
} from "../src/ui/logo-image.js";
import { setGlobalFlags } from "../src/lib/logger.js";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  setGlobalFlags({});
  delete process.env.CI;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  setGlobalFlags({});
});

describe("logo-image", () => {
  it("font covers every letter of LastState", () => {
    for (const ch of "LastState") {
      expect(FONT[ch], `glyph ${ch}`).toBeDefined();
      expect(FONT[ch]).toHaveLength(7);
    }
  });

  it("raster has white mark pixels and gradient slash pixels", () => {
    const { w, h, data } = renderLogoPixels();
    expect(w).toBeGreaterThan(400);
    expect(h).toBeGreaterThan(30);
    let white = 0;
    let colored = 0;
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 200 && g > 200 && b > 200) white++;
      else if (r > 40 || g > 40 || b > 40) colored++;
    }
    expect(white).toBeGreaterThan(2000); // stroke + slash + wordmark
    expect(colored).toBeGreaterThan(200); // gradient slash
  });

  it("wordmark area (right side) is non-empty", () => {
    const { w, data } = renderLogoPixels();
    let right = 0;
    for (let y = 0; y < 52; y++) {
      for (let x = 300; x < w; x++) {
        const o = (y * w + x) * 3;
        if (data[o] > 200) right++;
      }
    }
    expect(right).toBeGreaterThan(500);
  });

  it("PNG has valid signature, IHDR size and IEND", () => {
    const png = renderLogoPng();
    expect(png[0]).toBe(0x89);
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(540); // IHDR width
    expect(png.readUInt32BE(20)).toBe(52); // IHDR height
    expect(png.toString("ascii", png.length - 8, png.length - 4)).toBe("IEND");
    expect(png.length).toBeGreaterThan(1000);
  });

  it("sixel has valid envelope and brand palette", () => {
    const six = renderLogoSixel();
    expect(six.startsWith("\x1bPq")).toBe(true);
    expect(six.endsWith("\x1b\\")).toBe(true);
    expect(six).toContain("#1;2;100;100;100"); // white
    expect(six).toContain('"1;1;540;52'); // raster attributes
    expect(six.length).toBeGreaterThan(1000);
  });

  it("decodes the shipped brand.png (real logo, 2x)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pngPath = join(here, "..", "assets", "brand.png");
    expect(existsSync(pngPath)).toBe(true);
    const px = decodePng(new Uint8Array(readFileSync(pngPath)));
    expect(px.w).toBe(2176);
    expect(px.h).toBe(266);
    let lit = 0;
    for (let i = 0; i < px.data.length; i += 3) {
      if (px.data[i] > 100 || px.data[i + 1] > 100 || px.data[i + 2] > 100) lit++;
    }
    const total = px.w * px.h;
    expect(lit / total).toBeGreaterThan(0.05);
    expect(lit / total).toBeLessThan(0.6);
  });

  it("getLogoPixels prefers the real PNG", () => {
    const { px, real } = getLogoPixels();
    expect(real).toBe(true);
    expect(px.w).toBe(2176);
  });

  it("sixel from the real PNG is well-formed", () => {
    const { px } = getLogoPixels();
    const six = sixelFromPixels(downscale(px, 760));
    expect(six.startsWith("\x1bPq")).toBe(true);
    expect(six.endsWith("\x1b\\")).toBe(true);
    expect(six).toContain("#1;2;100;100;100");
    expect(six).toContain('"1;1;760;');
  });

  it("ascii art comes from real pixels and fits the terminal", () => {
    const art = asciiFromPixels(getLogoPixels().px, 100);
    const lines = art.split("\n");
    expect(lines.length).toBeGreaterThan(4);
    expect(art).toMatch(/[\u2800-\u28ff]/);
    for (const l of lines) {
      expect(l.replace(/\x1b\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(100);
    }
  });
});
