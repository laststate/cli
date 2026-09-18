import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function hexDump(buf: Buffer, max = 64): string {
  return buf.subarray(0, max).toString("hex").match(/.{1,32}/g)?.join(" ") ?? "";
}

export async function analyze(file: string, opts: { outputFormat?: string }) {
  const path = isAbsolute(file) ? file : resolve(process.cwd(), file);
  if (!existsSync(path)) {
    console.error(`  File not found: ${path}`);
    process.exitCode = 1;
    return;
  }
  const buf = readFileSync(path);
  const format = opts.outputFormat ?? "text";
  // LEP magic LSTP = 4c 53 54 50
  const magic = buf.subarray(0, 4).toString("ascii");
  const isLep = magic === "LSTP";
  const version = buf.length > 4 ? buf[4] : 0;

  const result: Record<string, unknown> = {
    file: path,
    size: buf.length,
    hex_preview: hexDump(buf, 48),
    lep_detected: isLep,
    lep_version: isLep ? version : null,
    magic: isLep ? magic : buf.subarray(0, 4).toString("hex"),
  };

  if (isLep) {
    // header 24 bytes, CRC at 20-23
    const headerCrc = buf.readUInt32LE(20);
    result.header_crc = `0x${headerCrc.toString(16).padStart(8, "0")}`;
    result.note = "Use 'latch-dump --hex' or 'latch-dump --json' for full TLV walk";
  } else {
    result.hint = "Not an LEP envelope (magic != LSTP). Check framing (COBS/Latch-stream).";
  }

  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\n  LastState analyze:", path);
    console.log(`  Size: ${buf.length} bytes`);
    console.log(`  Magic: ${result.magic} ${isLep ? "(LEP ✓)" : "(not LEP)"}`);
    if (isLep) console.log(`  Version: v${version}  CRC: ${result.header_crc}`);
    console.log(`  Preview: ${result.hex_preview}`);
    if (result.hint) console.log(`  Hint: ${result.hint}`);
    if (result.note) console.log(`  ${result.note}`);
    console.log("");
  }
}
