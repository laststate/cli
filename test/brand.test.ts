import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  gradientText,
  logoStatic,
  stripAnsi,
  BRAND_STOPS,
} from "../src/ui/brand.js";
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

describe("brand", () => {
  it("gradient stops match the logo SVG", () => {
    expect([...BRAND_STOPS]).toEqual(["#4357EE", "#7757F7", "#D07BFA"]);
  });

  it("gradientText preserves characters", () => {
    expect(stripAnsi(gradientText("abc", 0))).toBe("abc");
    expect(gradientText("", 0)).toBe("");
  });

  it("static logo is multi-line art (no animation)", () => {
    const plain = stripAnsi(logoStatic());
    const lines = plain.split("\n");
    expect(lines.length).toBeGreaterThan(4);
    expect(plain).toMatch(/[\u2800-\u28ff]/);
    // every line fits a standard terminal
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(100);
  });
});
