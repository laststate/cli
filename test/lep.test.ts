import { describe, it, expect } from "vitest";
import { decodeLep, deframe, buildMinimalLep, cobsEncode, LEP_HEADER_SIZE } from "../src/lib/lep.js";

describe("lep decode", () => {
  it("decodes a minimal valid envelope", () => {
    const buf = buildMinimalLep({ version: 2, eventType: 1, arch: 1 });
    const d = decodeLep(new Uint8Array(buf));
    expect(d.magicOk).toBe(true);
    expect(d.version).toBe(2);
    expect(d.eventName).toBe("CRASH");
    expect(d.archName).toBe("cortex-m");
    expect(d.headerCrcOk).toBe(true);
    expect(d.payloadCrcOk).toBe(true);
    expect(d.ok).toBe(true);
    expect(d.tlvs.length).toBeGreaterThan(0);
  });

  it("rejects bad magic", () => {
    const d = decodeLep(new Uint8Array(Buffer.from("NOPE1234")));
    expect(d.magicOk).toBe(false);
    expect(d.ok).toBe(false);
  });

  it("rejects header CRC mismatch", () => {
    const buf = buildMinimalLep();
    buf[20] ^= 0xff;
    const d = decodeLep(new Uint8Array(buf));
    expect(d.headerCrcOk).toBe(false);
    expect(d.ok).toBe(false);
  });

  it("rejects unsupported version", () => {
    const buf = buildMinimalLep({ version: 9 });
    const d = decodeLep(new Uint8Array(buf));
    expect(d.versionOk).toBe(false);
    expect(d.ok).toBe(false);
  });

  it("rejects TLV type 0", () => {
    const payload = Buffer.from([0x00, 0x00, 0x01, 0x00, 0xff]);
    const buf = buildMinimalLep({ payload });
    const d = decodeLep(new Uint8Array(buf));
    expect(d.ok).toBe(false);
    expect(d.errors.join(" ")).toMatch(/type 0/i);
  });

  it("detects truncation", () => {
    const buf = buildMinimalLep().subarray(0, 10);
    const d = decodeLep(new Uint8Array(buf));
    expect(d.ok).toBe(false);
  });

  it("deframes latch-stream and cobs", () => {
    const lep = buildMinimalLep();
    // latch-stream: LS ver flags len LEP CRC
    const framed = Buffer.alloc(8 + lep.length + 4);
    framed.write("LS", 0, "ascii");
    framed[2] = 1; framed[3] = 0;
    framed.writeUInt32LE(lep.length, 4);
    Buffer.from(lep).copy(framed, 8);
    const r1 = deframe(new Uint8Array(framed));
    expect(r1.framing).toBe("latch-stream");
    expect(decodeLep(r1.payload).ok).toBe(true);

    const cobs = Buffer.concat([cobsEncode(lep), Buffer.from([0x00])]);
    const r2 = deframe(new Uint8Array(cobs));
    expect(r2.framing).toBe("cobs");
    expect(decodeLep(r2.payload).ok).toBe(true);
  });

  it("header is 24 bytes", () => {
    expect(LEP_HEADER_SIZE).toBe(24);
  });
});
