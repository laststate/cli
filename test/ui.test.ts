import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { progressBar } from "../src/ui/progress.js";
import { fmtDuration, timer, celebrate, withSpinner, spinUpdate, spinner } from "../src/ui/spinner.js";
import { setGlobalFlags } from "../src/lib/logger.js";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.CI;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  setGlobalFlags({});
});

describe("progress", () => {
  it("is a silent noop under --json", () => {
    setGlobalFlags({ json: true });
    const bar = progressBar(10, "x", "arq");
    expect(() => {
      bar.tick();
      bar.tick(2, "1.0 KB");
      bar.update(5, "half");
      bar.stop();
    }).not.toThrow();
  });

  it("ticks without throwing headless", () => {
    setGlobalFlags({});
    const bar = progressBar(3, "x");
    expect(() => {
      bar.tick();
      bar.update(2);
      bar.stop();
    }).not.toThrow();
  });
});

describe("spinner", () => {
  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("0.0s");
    expect(fmtDuration(3140)).toBe("3.1s");
    expect(fmtDuration(75_000)).toBe("1m 15s");
  });

  it("timer measures elapsed", async () => {
    setGlobalFlags({ quiet: true });
    const elapsed = timer();
    await new Promise((r) => setTimeout(r, 15));
    expect(elapsed()).toMatch(/^\d+\.\ds$/);
  });

  it("withSpinner passes through results and errors", async () => {
    setGlobalFlags({ quiet: true });
    await expect(withSpinner("work", async () => 42)).resolves.toBe(42);
    await expect(withSpinner("fail", async () => { throw new Error("nope"); })).rejects.toThrow("nope");
  });

  it("spinUpdate and celebrate are safe when quiet", () => {
    setGlobalFlags({ quiet: true });
    const s = spinner("x");
    expect(() => spinUpdate(s, "y")).not.toThrow();
    expect(() => celebrate("done", "1.0s")).not.toThrow();
  });
});
