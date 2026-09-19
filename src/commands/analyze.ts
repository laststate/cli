import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { isAbsolute, resolve, basename } from "node:path";
import { decodeLep, deframe, type LepDecode } from "../lib/lep.js";
import { hex } from "../lib/crc32.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";
import { printTable } from "../ui/table.js";

export interface AnalyzeOpts {
  outputFormat?: string;
  json?: boolean;
  deframe?: string;
  validateVectors?: boolean;
  tlv?: boolean;
}

function renderDecode(file: string, d: LepDecode, framing: string) {
  console.log(`\n  LastState analyze: ${file}`);
  console.log(`  Size: ${d.size} bytes   Framing: ${framing}`);
  if (!d.magicOk) {
    console.log(`  Magic: ${d.magic} (not LEP)`);
    console.log(`  Hint: Not an LEP envelope (magic != LSTP). Check framing (COBS/Latch-stream).`);
    console.log("");
    return;
  }
  console.log(`  Magic: LSTP (LEP ✓)   Version: v${d.version}${d.versionOk ? "" : " UNSUPPORTED"}`);
  console.log(`  Event: ${d.eventName} (${d.eventType})   Arch: ${d.archName} (${d.arch})   Flags: [${d.flagNames.join(",") || "none"}] (0x${(d.flags ?? 0).toString(16)})`);
  console.log(`  Seq: ${d.seq}   Event-ID: ${d.eventId} (${d.eventId !== null ? hex(d.eventId) : "?"})   Payload: ${d.payloadLen} bytes`);
  console.log(`  Header CRC: ${d.headerCrcStored} ${d.headerCrcOk ? "✓" : "✗ MISMATCH (stored vs " + d.headerCrcComputed + ")"}`);
  console.log(`  Payload CRC: ${d.payloadCrcStored} ${d.payloadCrcOk ? "✓" : "✗ MISMATCH"}`);
  console.log(`  Preview: ${d.hexPreview}`);
  if (d.tlvs.length > 0) {
    console.log(`  TLVs (${d.tlvs.length}):`);
    printTable(
      ["Type", "Name", "Len", "Value (hex/ascii)"],
      d.tlvs.map((t) => [`${t.type}`, t.name, `${t.len}`, `${t.valueHex.slice(0, 32)}  ${t.valueAscii.slice(0, 24)}`]),
    );
  } else {
    console.log(`  TLVs: none decoded`);
  }
  for (const w of d.warnings) console.log(`  Warn: ${w}`);
  for (const e of d.errors) console.log(`  ${"✗"} ${e}`);
  if (d.ok) log.ok("Envelope valid");
  else log.err("Envelope INVALID — see errors above");
  console.log("");
}

export async function analyze(file: string, rawOpts: AnalyzeOpts) {
  const asJson = isJson() || rawOpts.json || rawOpts.outputFormat === "json";
  const files: string[] = [];
  const abs = isAbsolute(file) ? file : resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    const msg = `File not found: ${abs}`;
    if (asJson) emitJson({ ok: false, error: msg });
    else { log.err(msg); process.exitCode = 1; }
    return;
  }
  if (statSync(abs).isDirectory()) {
    for (const f of readdirSync(abs)) {
      if (/\.lep$/i.test(f) || /\.hex$/i.test(f) || /\.bin$/i.test(f)) files.push(resolve(abs, f));
    }
    if (files.length === 0) {
      const msg = `No .lep/.hex/.bin files in ${abs}`;
      if (asJson) emitJson({ ok: false, error: msg });
      else { log.err(msg); process.exitCode = 1; }
      return;
    }
  } else {
    files.push(abs);
  }

  const results = [];
  for (const f of files) {
    let raw: Uint8Array;
    try {
      const text = readFileSync(f, "utf8").trim();
      if (/^[0-9a-fA-F\s\r\n]+$/.test(text) && text.replace(/\s/g, "").length >= 8 && !text.includes("LSTP")) {
        const clean = text.replace(/[^0-9a-fA-F]/g, "");
        const buf = Buffer.from(clean, "hex");
        raw = new Uint8Array(buf);
      } else {
        raw = new Uint8Array(readFileSync(f));
      }
    } catch {
      raw = new Uint8Array(readFileSync(f));
    }
    const { framing, payload } = deframe(raw);
    const d = decodeLep(payload);
    results.push({ file: f, framing, ...d, ok: d.ok });
    if (!asJson) renderDecode(f, d, framing);
  }

  if (asJson) {
    emitJson(files.length === 1 ? { ...results[0], file: basename(files[0]) } : { ok: results.every((r) => r.ok), count: results.length, results });
  } else if (files.length > 1) {
    const okCount = results.filter((r) => r.ok).length;
    header("Summary");
    log.info(`${okCount}/${results.length} envelopes valid`);
    console.log("");
    if (okCount !== results.length) process.exitCode = 1;
  } else if (!results[0].ok) {
    process.exitCode = 1;
  }
}
