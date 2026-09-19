import { crc32, hex } from "./crc32.js";

export const LEP_MAGIC = "LSTP";
export const LEP_MAGIC_BYTES = [0x4c, 0x53, 0x54, 0x50];
export const LEP_HEADER_SIZE = 24;

export const EVENT_TYPES: Record<number, string> = {
  1: "CRASH",
  2: "ERROR",
  3: "MESSAGE",
  4: "HEALTH",
  5: "RESET",
  6: "LOG",
  7: "PERIPH",
  8: "COREDUMP",
};

export const ARCHES: Record<number, string> = {
  0: "unknown",
  1: "cortex-m",
  2: "riscv",
  3: "xtensa",
  4: "linux",
  5: "riscv64",
};

export const FLAG_NAMES: Record<number, string> = {
  0: "AUTH",
  1: "ENC",
  2: "AEAD",
  3: "TRUNC",
  4: "COMPRESSED",
};

export const TLV_NAMES: Record<number, string> = {
  1: "DEVICE_ID",
  2: "FIRMWARE_VERSION",
  3: "BUILD_ID",
  4: "CPU_CONTEXT",
  5: "FAULT_INFO",
  6: "BREADCRUMB",
  7: "METRIC",
  8: "LOG_LINE",
  9: "RESET_REASON",
  10: "BOOT_COUNT",
  11: "UPTIME",
  12: "STACK_DUMP",
  13: "MEMORY_REGION",
  14: "REGISTER_BLOCK",
  15: "TIMESTAMP",
  16: "SEQUENCE",
  17: "FINGERPRINT",
  18: "ATTACHMENT_REF",
  19: "ENCRYPTED_BLOB",
  20: "HMAC",
  21: "COMPRESSION_INFO",
  22: "VENDOR",
};

export interface Tlv {
  type: number;
  name: string;
  len: number;
  valueHex: string;
  valueAscii: string;
  vendor?: boolean;
  probe?: boolean;
  attach?: boolean;
}

export interface LepDecode {
  ok: boolean;
  size: number;
  magic: string;
  magicOk: boolean;
  version: number | null;
  versionOk: boolean;
  eventType: number | null;
  eventName: string | null;
  arch: number | null;
  archName: string | null;
  flags: number | null;
  flagNames: string[];
  seq: number | null;
  eventId: number | null;
  payloadLen: number | null;
  headerCrcStored: string | null;
  headerCrcComputed: string | null;
  headerCrcOk: boolean | null;
  payloadCrcStored: string | null;
  payloadCrcComputed: string | null;
  payloadCrcOk: boolean | null;
  totalExpected: number | null;
  truncated: boolean;
  tlvs: Tlv[];
  errors: string[];
  warnings: string[];
  hexPreview: string;
}

export function hexDump(buf: Uint8Array, max = 48): string {
  const slice = buf.subarray(0, max);
  const hexStr = Buffer.from(slice).toString("hex");
  return hexStr.match(/.{1,32}/g)?.join(" ") ?? "";
}

function asciiSafe(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("ascii")
    .replace(/[^\x20-\x7e]/g, ".");
}

export function decodeLep(input: Uint8Array): LepDecode {
  const buf = Buffer.from(input);
  const errors: string[] = [];
  const warnings: string[] = [];
  const base: LepDecode = {
    ok: false,
    size: buf.length,
    magic: "",
    magicOk: false,
    version: null,
    versionOk: false,
    eventType: null,
    eventName: null,
    arch: null,
    archName: null,
    flags: null,
    flagNames: [],
    seq: null,
    eventId: null,
    payloadLen: null,
    headerCrcStored: null,
    headerCrcComputed: null,
    headerCrcOk: null,
    payloadCrcStored: null,
    payloadCrcComputed: null,
    payloadCrcOk: null,
    totalExpected: null,
    truncated: false,
    tlvs: [],
    errors,
    warnings,
    hexPreview: hexDump(buf),
  };
  if (buf.length < 4) {
    errors.push("file too small (<4 bytes), not an LEP envelope");
    return base;
  }
  base.magic = buf.subarray(0, 4).toString("ascii");
  base.magicOk = base.magic === LEP_MAGIC;
  if (!base.magicOk) {
    base.magic = buf.subarray(0, 4).toString("hex");
    errors.push("magic != LSTP — check framing (COBS / Latch-Stream / len-prefix)");
    return base;
  }
  if (buf.length < LEP_HEADER_SIZE) {
    errors.push(`truncated header (${buf.length} < 24 bytes)`);
    base.truncated = true;
    return base;
  }
  const version = buf[4];
  const eventType = buf[5];
  const arch = buf[6];
  const flags = buf[7];
  const seq = buf.readUInt32LE(8);
  const eventId = buf.readUInt32LE(12);
  const payloadLen = buf.readUInt32LE(16);
  const headerCrcStored = buf.readUInt32LE(20);
  const headerCrcComputed = crc32(buf, 0, 20);

  base.version = version;
  base.versionOk = version === 1 || version === 2;
  base.eventType = eventType;
  base.eventName = EVENT_TYPES[eventType] ?? `UNKNOWN(${eventType})`;
  base.arch = arch;
  base.archName = ARCHES[arch] ?? `unknown(${arch})`;
  base.flags = flags;
  base.flagNames = Object.entries(FLAG_NAMES)
    .filter(([bit]) => flags & (1 << Number(bit)))
    .map(([, n]) => n);
  base.seq = seq;
  base.eventId = eventId;
  base.payloadLen = payloadLen;
  base.headerCrcStored = hex(headerCrcStored);
  base.headerCrcComputed = hex(headerCrcComputed);
  base.headerCrcOk = headerCrcStored === headerCrcComputed;

  if (!base.versionOk) errors.push(`unsupported version ${version} (expected 1|2)`);
  if (flags & ~0x1f) errors.push(`unknown flags 0x${flags.toString(16)} (mask 0x1F)`);
  if (!base.headerCrcOk)
    errors.push(`header CRC mismatch (stored ${base.headerCrcStored} != computed ${base.headerCrcComputed})`);

  const totalExpected = LEP_HEADER_SIZE + payloadLen + 4;
  base.totalExpected = totalExpected;
  if (buf.length < totalExpected) {
    base.truncated = true;
    errors.push(`truncated payload (have ${buf.length}, need ${totalExpected})`);
    return base;
  }
  if (buf.length > totalExpected) {
    warnings.push(`trailing ${buf.length - totalExpected} byte(s) after envelope`);
  }

  const payload = buf.subarray(LEP_HEADER_SIZE, LEP_HEADER_SIZE + payloadLen);
  const payloadCrcStored = buf.readUInt32LE(LEP_HEADER_SIZE + payloadLen);
  const payloadCrcComputed = crc32(payload);
  base.payloadCrcStored = hex(payloadCrcStored);
  base.payloadCrcComputed = hex(payloadCrcComputed);
  base.payloadCrcOk = payloadCrcStored === payloadCrcComputed;
  if (!base.payloadCrcOk)
    errors.push(`payload CRC mismatch (stored ${base.payloadCrcStored} != computed ${base.payloadCrcComputed})`);

  // TLV walk: type u16LE + len u16LE + value
  let off = 0;
  const tlvs: Tlv[] = [];
  while (off + 4 <= payload.length) {
    const type = payload.readUInt16LE(off);
    const len = payload.readUInt16LE(off + 2);
    if (type === 0) {
      errors.push(`TLV type 0 illegal at offset ${off}`);
      break;
    }
    if (off + 4 + len > payload.length) {
      errors.push(`TLV overrun at offset ${off} (type ${type}, len ${len})`);
      break;
    }
    const val = payload.subarray(off + 4, off + 4 + len);
    tlvs.push({
      type,
      name: TLV_NAMES[type] ?? (type >= 0x8000 ? `VENDOR(0x${type.toString(16)})` : `UNKNOWN(0x${type.toString(16)})`),
      len,
      valueHex: val.subarray(0, 32).toString("hex"),
      valueAscii: asciiSafe(val.subarray(0, 32)),
      vendor: type >= 0x8000,
      probe: type >= 0x30 && type < 0x40,
      attach: type === 0x20,
    });
    off += 4 + len;
  }
  if (off !== payload.length) {
    warnings.push(`TLV walk ended at ${off}/${payload.length} — possible padding`);
  }
  base.tlvs = tlvs;
  base.ok = errors.length === 0;
  return base;
}

/** Try to strip COBS / Latch-Stream / len-prefix framing to find an LSTP envelope. */
export function deframe(input: Uint8Array): { framing: string; payload: Uint8Array } {
  const buf = Buffer.from(input);
  // 1. raw LSTP at 0
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === LEP_MAGIC) {
    return { framing: "raw", payload: buf };
  }
  // 2. Latch-Stream: 'LS' ver flags lep_len u32LE LEP CRC32
  if (buf.length >= 8 && buf[0] === 0x4c && buf[1] === 0x53) {
    const lepLen = buf.readUInt32LE(4);
    if (buf.length >= 8 + lepLen && buf.subarray(8, 12).toString("ascii") === LEP_MAGIC) {
      return { framing: "latch-stream", payload: buf.subarray(8, 8 + lepLen + 4) };
    }
  }
  // 3. COBS: scan for 0x00 terminator, decode, look for LSTP
  const zero = buf.indexOf(0x00);
  if (zero > 0) {
    const frame = buf.subarray(0, zero);
    try {
      const decoded = cobsDecode(frame);
      if (decoded.length >= 4 && decoded.subarray(0, 4).toString("ascii") === LEP_MAGIC) {
        return { framing: "cobs", payload: decoded };
      }
    } catch {
      // fall through
    }
  }
  // 4. len-prefix u32LE
  if (buf.length >= 8) {
    const len = buf.readUInt32LE(0);
    if (len > 0 && len <= 4 * 1024 * 1024 && buf.length >= 4 + len && buf.subarray(4, 8).toString("ascii") === LEP_MAGIC) {
      return { framing: "len-prefix", payload: buf.subarray(4, 4 + len) };
    }
  }
  return { framing: "unknown", payload: buf };
}

export function cobsDecode(input: Uint8Array): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const code = input[i++];
    if (code === 0) break;
    const end = i + code - 1;
    if (end > input.length) throw new Error("COBS overrun");
    for (; i < end; i++) out.push(input[i]);
    if (code < 0xff && i < input.length) out.push(0);
  }
  return Buffer.from(out);
}

export function cobsEncode(input: Uint8Array): Buffer {
  const out: number[] = [];
  let blockStart = 0;
  let codeIdx = 0;
  out.push(0);
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 0) {
      out[codeIdx] = i - blockStart + 1;
      blockStart = i + 1;
      codeIdx = out.length;
      out.push(0);
    } else {
      out.push(input[i]);
      if (out.length - codeIdx === 0xff) {
        out[codeIdx] = 0xff;
        blockStart = i + 1;
        codeIdx = out.length;
        out.push(0);
      }
    }
  }
  out[codeIdx] = input.length - blockStart + 1;
  return Buffer.from(out);
}

/** Build a minimal valid LEP envelope (for tests / mock). */
export function buildMinimalLep(opts: { version?: number; eventType?: number; arch?: number; payload?: Uint8Array; seq?: number; eventId?: number } = {}): Buffer {
  const version = opts.version ?? 2;
  const eventType = opts.eventType ?? 1;
  const arch = opts.arch ?? 1;
  const payload = Buffer.from(opts.payload ?? Buffer.from([0x01, 0x00, 0x04, 0x00, 0x41, 0x42, 0x43, 0x00]));
  const header = Buffer.alloc(LEP_HEADER_SIZE);
  header.write("LSTP", 0, "ascii");
  header[4] = version;
  header[5] = eventType;
  header[6] = arch;
  header[7] = 0;
  header.writeUInt32LE(opts.seq ?? 1, 8);
  header.writeUInt32LE(opts.eventId ?? 0x1234, 12);
  header.writeUInt32LE(payload.length, 16);
  header.writeUInt32LE(crc32(header.subarray(0, 20)), 20);
  const tail = Buffer.alloc(4);
  tail.writeUInt32LE(crc32(payload), 0);
  return Buffer.concat([header, payload, tail]);
}
