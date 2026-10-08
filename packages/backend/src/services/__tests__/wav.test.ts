import { describe, expect, test } from "bun:test";
import { finishWav } from "../wav";

/** A 16-bit mono WAV: `samples` frames of value 1000, optionally streamed like Kokoro's. */
function wav(samples: number, opts: { rate?: number; streamed?: boolean; list?: boolean } = {}): ArrayBuffer {
  const rate = opts.rate ?? 24000;
  const list = opts.list ? 34 : 0; // "LIST" + size + 26 bytes
  const out = new ArrayBuffer(44 + list + samples * 2);
  const v = new DataView(out);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, opts.streamed ? 0xffffffff : 36 + list + samples * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  let at = 36;
  if (list) {
    put(at, "LIST");
    v.setUint32(at + 4, 26, true);
    at += 34;
  }
  put(at, "data");
  v.setUint32(at + 4, opts.streamed ? 0xffffffff : samples * 2, true);
  for (let i = 0; i < samples; i++) v.setInt16(at + 8 + i * 2, 1000, true);
  return out;
}

const dataSize = (b: ArrayBuffer) => new DataView(b).getUint32(40, true);

describe("finishWav", () => {
  test("appends the requested silence and states the new size", () => {
    const out = finishWav(wav(2400), 400); // 0.1 s of audio + 0.4 s pad at 24 kHz
    expect(dataSize(out)).toBe((2400 + 9600) * 2);
    expect(new DataView(out).getUint32(4, true)).toBe(36 + dataSize(out));
    const v = new DataView(out);
    expect(v.getInt16(44, true)).toBe(1000); // audio kept
    expect(v.getInt16(44 + 2400 * 2, true)).toBe(0); // silence after it
    expect(out.byteLength).toBe(44 + dataSize(out));
  });

  test("a streamed WAV (Kokoro: 0xFFFFFFFF sizes, LIST chunk) gets real sizes and a 44-byte header", () => {
    const out = finishWav(wav(4800, { streamed: true, list: true }), 0);
    expect(dataSize(out)).toBe(4800 * 2);
    expect(out.byteLength).toBe(44 + 4800 * 2);
    expect(new DataView(out).getInt16(44, true)).toBe(1000);
  });

  test("padding 0 keeps the audio length", () => {
    expect(dataSize(finishWav(wav(100), 0))).toBe(200);
  });

  test("a body shorter than its header claims keeps whole frames only", () => {
    const b = wav(10);
    const truncated = b.slice(0, b.byteLength - 1);
    expect(dataSize(finishWav(truncated, 0))).toBe(18);
  });

  test("anything else passes through untouched", () => {
    const notWav = new Uint8Array([82, 73, 70, 70]).buffer;
    expect(finishWav(notWav, 400)).toBe(notWav);
    const floatWav = wav(10);
    new DataView(floatWav).setUint16(20, 3, true); // IEEE float
    expect(finishWav(floatWav, 400)).toBe(floatWav);
  });
});
