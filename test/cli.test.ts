import { describe, it, expect } from "vitest";
import { validateProjectConfig, validateRelayConfigYaml } from "../src/lib/validate.js";
import { createProgram } from "../src/cli.js";

describe("validate", () => {
  it("fails without config", () => {
    const checks = validateProjectConfig(null);
    expect(checks[0].state).toBe("fail");
  });

  it("passes with minimal config", () => {
    const checks = validateProjectConfig({ project: "x", lep_version: 2, trace_url: "http://localhost:8080", ingest_token: "dev-abc" });
    expect(checks.every((c) => c.state !== "fail")).toBe(true);
  });

  it("rejects literal relay tokens", () => {
    const bad = "destinations:\n  - id: t\n    auth:\n      token: lst_ingest_abc123\n";
    const checks = validateRelayConfigYaml(bad);
    expect(checks.some((c) => c.state === "fail")).toBe(true);
    const good = "admin:\n  token: env:LASTSTATE_ADMIN_TOKEN\n";
    expect(validateRelayConfigYaml(good).every((c) => c.state !== "fail")).toBe(true);
  });
});

describe("cli wiring", () => {
  it("registers all commands", () => {
    const p = createProgram();
    const names = p.commands.map((c) => c.name());
    for (const expected of ["init", "build", "flash", "test", "mock", "ingest", "analyze", "symbolicate", "config", "up", "down", "ps", "logs", "status", "sim", "deploy", "doctor", "update"]) {
      expect(names).toContain(expected);
    }
  });

  it("has global flags", () => {
    const p = createProgram();
    const opts = p.options.map((o) => o.long);
    expect(opts).toContain("--json");
    expect(opts).toContain("--yes");
    expect(opts).toContain("--verbose");
  });

  it("prints the ascii banner before commands, once for brand", async () => {
    const logs: string[] = [];
    const orig = console.log;
    // The banner honors CI=true (always set on GitHub Actions), so clear it
    // here to exercise the interactive path deterministically.
    const savedCI = process.env.CI;
    delete process.env.CI;
    console.log = (...a: unknown[]) => {
      logs.push(a.join(" "));
    };
    try {
      await createProgram().parseAsync(["--no-color", "config", "paths"], { from: "user" });
    } finally {
      console.log = orig;
      if (savedCI === undefined) delete process.env.CI;
      else process.env.CI = savedCI;
    }
    expect(logs.join("\n")).toMatch(/[\u2800-\u28ff]/);
  });

  it("suppresses the banner with --json / --no-banner", async () => {
    for (const extra of ["--json", "--no-banner", "--quiet"]) {
      const logs: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => {
        logs.push(a.join(" "));
      };
      try {
        await createProgram().parseAsync([extra, "config", "paths"], { from: "user" });
      } finally {
        console.log = orig;
      }
      expect(logs.join("\n")).not.toMatch(/[\u2800-\u28ff]/);
    }
  });

  it("suppresses the banner when CI=true", async () => {
    const savedCI = process.env.CI;
    process.env.CI = "true";
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => {
      logs.push(a.join(" "));
    };
    try {
      await createProgram().parseAsync(["config", "paths"], { from: "user" });
    } finally {
      console.log = orig;
      if (savedCI === undefined) delete process.env.CI;
      else process.env.CI = savedCI;
    }
    expect(logs.join("\n")).not.toMatch(/[\u2800-\u28ff]/);
  });
});
