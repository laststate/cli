import { describe, it, expect } from "vitest";
import { isWeak, preflight, SECRET_SPECS } from "../src/lib/env-manager.js";

describe("env-manager", () => {
  it("flags placeholders and weak defaults", () => {
    expect(isWeak("REPLACE_ME_foo")).toBe(true);
    expect(isWeak("admin123")).toBe(true);
    expect(isWeak("super-secret-jwt-key")).toBe(true);
    expect(isWeak("a3f9c1e27b5d4890e6f2a4b7c9d301234")).toBe(false);
  });

  it("preflight fails on placeholders", () => {
    const issues = preflight({ env: { POSTGRES_PASSWORD: "REPLACE_ME_x" }, deployEnv: "local" });
    expect(issues.some((i) => i.problem === "placeholder")).toBe(true);
  });

  it("preflight requires prod keys", () => {
    const issues = preflight({ env: {}, deployEnv: "production" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.key === "POSTGRES_PASSWORD")).toBe(true);
  });

  it("has specs for all critical secrets", () => {
    const keys = SECRET_SPECS.map((s) => s.key);
    for (const k of ["POSTGRES_PASSWORD", "TRACE_JWT_SECRET", "LASTSTATE_INGEST_TOKEN", "LASTSTATE_ADMIN_TOKEN"]) {
      expect(keys).toContain(k);
    }
  });
});
