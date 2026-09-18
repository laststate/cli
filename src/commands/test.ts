export async function test(opts: { verbose?: boolean }) {
  console.log("\n  Running LastState integration checks...\n");
  // Tri-state: only the filesystem probe actually runs. The rest are
  // documented expectations, NOT verified — marked skip, never pass.
  const checks: Array<[string, "pass" | "fail" | "skip", string]> = [
    ["laststate.yaml exists", "fail", "run 'laststate init' first"],
    ["latch include path", "skip", "static scaffold — include/laststate/latch.h not probed"],
    ["LEP v2 wire format", "skip", "static scaffold — validate against protocol/test-vectors"],
    ["spool persistence", "skip", "static scaffold — needs target storage ports"],
    ["transport registration", "skip", "static scaffold — register a transport before ls_boot()"],
  ];
  // lightweight filesystem probe
  try {
    const { existsSync } = await import("node:fs");
    checks[0][1] = (existsSync("laststate.yaml") || existsSync("latch/include/laststate/latch.h")) ? "pass" : "fail";
  } catch {}
  let ok = true;
  for (const [label, state, hint] of checks) {
    const icon = state === "pass" ? "✓" : state === "fail" ? "✗" : "-";
    const extra = opts.verbose ? ` — ${hint}` : "";
    console.log(`  ${icon} ${label}${extra}`);
    if (state === "fail") ok = false;
  }
  console.log("");
  if (!ok) {
    console.log("  Some checks need attention. See https://docs.laststate.io/quickstart\n");
    process.exitCode = 1;
  } else {
    console.log("  Static checks passed (- = not probed by this scaffold). Trigger a fault and run 'laststate analyze <file.lep>'\n");
  }
}
