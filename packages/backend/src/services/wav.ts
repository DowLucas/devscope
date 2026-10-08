/**
 * Makes the speech services' WAV safe to play to the very end.
 *
 * - Kokoro streams its WAV, so the RIFF and data sizes are the "unknown"
 *   placeholder 0xFFFFFFFF and a LIST chunk sits before the data. Players then
 *   have to guess where the audio ends; the rewritten file states it.
 * - A player that exits as soon as the last sample is handed over lets some
 *   outputs (Bluetooth headphones in particular, ~200-300 ms behind) drop the
 *   tail when the stream closes. Trailing silence keeps the last word whole.
 *
 * Anything that is not 16-bit PCM RIFF/WAVE is returned unchanged.
 */
export function finishWav(audio: ArrayBuffer, padMs: number): ArrayBuffer {
  const view = new DataView(audio);
  if (audio.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") return audio;

  let fmt: { channels: number; rate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= audio.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= audio.byteLength) {
      if (view.getUint16(body, true) !== 1) return audio; // not PCM
      fmt = { channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt || fmt.bits !== 16 || fmt.channels < 1 || fmt.rate < 1) return audio;
      // A streamed size (0xFFFFFFFF) or a short body: the bytes present are the audio.
      const blockAlign = fmt.channels * 2;
      let length = Math.min(size, audio.byteLength - body);
      length -= length % blockAlign;
      const pad = Math.round((Math.max(0, padMs) / 1000) * fmt.rate) * blockAlign;
      return pcmWav(new Uint8Array(audio, body, length), fmt.channels, fmt.rate, pad);
    }
    offset = body + size + (size & 1);
  }
  return audio;
}

function tag(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}

/** A canonical 44-byte-header PCM WAV: the samples, then `padBytes` of silence. */
function pcmWav(samples: Uint8Array, channels: number, rate: number, padBytes: number): ArrayBuffer {
  const dataLength = samples.byteLength + padBytes;
  const out = new ArrayBuffer(44 + dataLength);
  const v = new DataView(out);
  const put = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + dataLength, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, dataLength, true);
  new Uint8Array(out, 44).set(samples); // the padding stays zero: silence
  return out;
}
