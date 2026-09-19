import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";

export const WEAK_PATTERNS = [
  /REPLACE_ME/i,
  /changeme/i,
  /super-secret-jwt-key/i,
  /admin123/,
  /^dev-.*-token-12345/,
  /_fake_/i,
  /^laststate$/,
  /^minio12345$/,
  /^change-me$/,
  /^password$/i,
];

export function isWeak(value: string | undefined): boolean {
  if (!value) return true;
  return WEAK_PATTERNS.some((re) => re.test(value));
}

export function genHex(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export function genBase64(bytes = 32): string {
  return randomBytes(bytes).toString("base64");
}

export interface SecretSpec {
  key: string;
  gen: () => string;
}

export const SECRET_SPECS: SecretSpec[] = [
  { key: "POSTGRES_PASSWORD", gen: () => genHex(24) },
  { key: "MINIO_ROOT_PASSWORD", gen: () => genBase64(18) },
  { key: "TRACE_BOOTSTRAP_TOKEN", gen: () => `lst_ingest_${genHex(24)}` },
  { key: "TRACE_JWT_SECRET", gen: () => genBase64(32) },
  { key: "TRACE_SECRETS_KEY", gen: () => genBase64(32) },
  { key: "TRACE_ADMIN_PASSWORD", gen: () => genBase64(18) },
  { key: "TRACE_S3_SECRET_KEY", gen: () => genBase64(18) },
  { key: "LASTSTATE_INGEST_TOKEN", gen: () => genHex(24) },
  { key: "LASTSTATE_ADMIN_TOKEN", gen: () => genHex(24) },
  { key: "LASTSTATE_COMPANY_TOKEN", gen: () => `lst_ingest_${genHex(24)}` },
  { key: "STRIPE_WEBHOOK_SECRET", gen: () => genHex(24) },
  { key: "MP_WEBHOOK_SECRET", gen: () => genHex(24) },
  { key: "CRYPTO_WEBHOOK_SECRET", gen: () => genHex(24) },
  { key: "NOWPAYMENTS_IPN_SECRET", gen: () => genHex(24) },
  { key: "TRACE_BILLING_HMAC_SECRET", gen: () => genHex(24) },
  { key: "GF_SECURITY_ADMIN_PASSWORD", gen: () => genBase64(18) },
];

export const PROD_REQUIRED = [
  "POSTGRES_PASSWORD",
  "TRACE_JWT_SECRET",
  "TRACE_SECRETS_KEY",
  "LASTSTATE_INGEST_TOKEN",
  "LASTSTATE_ADMIN_TOKEN",
];

export function loadEnvFile(path = ".env"): Record<string, string> {
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) return {};
  return parseDotenv(readFileSync(file, "utf8"));
}

export function generateSecrets(opts: { onlyMissing?: boolean; envPath?: string } = {}): { key: string; action: "generated" | "kept" }[] {
  const envPath = resolve(process.cwd(), opts.envPath ?? ".env");
  const cur: Record<string, string> = existsSync(envPath)
    ? parseDotenv(readFileSync(envPath, "utf8"))
    : {};
  const results: { key: string; action: "generated" | "kept" }[] = [];
  for (const spec of SECRET_SPECS) {
    const v = cur[spec.key];
    if (v && !isWeak(v) && opts.onlyMissing) {
      results.push({ key: spec.key, action: "kept" });
      continue;
    }
    if (v && !isWeak(v) && !opts.onlyMissing) {
      // --force not set semantics: default regenerates weak only; keep strong unless forced elsewhere
      results.push({ key: spec.key, action: "kept" });
      continue;
    }
    cur[spec.key] = spec.gen();
    results.push({ key: spec.key, action: "generated" });
  }
  const lines = Object.entries(cur).map(([k, v]) => `${k}=${v}`);
  writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
  try {
    // chmod best-effort on windows ignored
  } catch { /* noop */ }
  return results;
}

export interface PreflightIssue {
  key: string;
  problem: "missing" | "placeholder" | "weak";
  hint: string;
}

export function preflight(opts: { env?: Record<string, string | undefined>; deployEnv?: string } = {}): PreflightIssue[] {
  const env = opts.env ?? { ...process.env, ...loadEnvFile() };
  const issues: PreflightIssue[] = [];
  const deployEnv = opts.deployEnv ?? env.DEPLOY_ENV ?? env.TRACE_DEPLOYMENT ?? "local";
  const isProd = /prod/i.test(deployEnv ?? "local");

  for (const [k, v] of Object.entries(env)) {
    if (v && /REPLACE_ME/.test(v)) {
      issues.push({ key: k, problem: "placeholder", hint: "replace REPLACE_ME_* via 'laststate config generate-secrets'" });
    }
  }
  if (isProd) {
    for (const k of PROD_REQUIRED) {
      const v = env[k];
      if (!v) issues.push({ key: k, problem: "missing", hint: "required in production" });
      else if (isWeak(v)) issues.push({ key: k, problem: "weak", hint: "known-weak dev default — rotate" });
    }
  } else {
    for (const [k, v] of Object.entries(env)) {
      if (isWeak(v) && SECRET_SPECS.some((s) => s.key === k)) {
        issues.push({ key: k, problem: "weak", hint: "dev default ok locally, rotate before sharing" });
      }
    }
  }
  return issues;
}
