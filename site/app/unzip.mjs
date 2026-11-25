// A small zip reader for the You page: a zip of QR pictures or key texts, one per vault, read in the browser.
// It reads the central directory and inflates with the platform's DecompressionStream('deflate-raw'), so there is
// no dependency. Stored (0) and deflated (8) entries only; no encryption, no zip64. Runs in browsers and Node 18+.
// By crm.dev.a@AgentiCCells.dinis, 2026-11-25. Apache-2.0.

// A hand-over zip is a few pictures; refuse anything bigger. Caps from security.b's review 036 (25 Nov 2026).
export const MAX_ENTRIES = 200, MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_ENTRY = 5 * 1024 * 1024;

export function isZip(bytes) { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }

// Inflate, counting bytes as they come: stop as soon as the output passes the limit (a zip bomb declares small sizes).
async function inflate(data, limit) {
  const r = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break;
    n += value.length; if (n > limit) { await r.cancel().catch(() => {}); throw new Error('an entry inflates to more than it declares or is allowed'); }
    parts.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}

// A name to show: no control or bidi characters (U+202A-202E, U+2066-2069 can make a name read backwards), at most 80.
export function safeName(name) {
  const t = String(name).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return (t.length > 80 ? t.slice(0, 77) + '...' : t) || 'a file';
}

// unzip(Uint8Array) -> [{ name, bytes }] in the zip's order, without folders, dot files or macOS's __MACOSX copies.
export async function unzip(bytes) {
  if (bytes.length > MAX_FILE) throw new Error('the zip is too big for a hand-over (over 20 MB)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end record)');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error(`the zip has ${count} files; at most ${MAX_ENTRIES}`);
  const out = [], dec = new TextDecoder(); let total = 0;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('the zip is damaged (central directory)');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + xlen + clen;
    const base = safeName(name.split('/').pop());
    if (name.endsWith('/') || !name.split('/').pop() || base.startsWith('.') || name.startsWith('__MACOSX/')) continue;
    if (flags & 1) throw new Error(`${base} is encrypted in the zip`);
    if (method !== 0 && method !== 8) throw new Error(`${base} uses a zip method this page cannot read (${method})`);
    if (usize > MAX_ENTRY) throw new Error(`${base} is too big for a hand-over (over 5 MB)`);
    if (total + usize > MAX_TOTAL) throw new Error('the zip is too big for a hand-over (over 20 MB unpacked)');
    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error('the zip is damaged (local header)');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), data = bytes.subarray(start, start + csize);
    if (method === 0 && csize !== usize) throw new Error(`${base} is damaged in the zip (sizes differ)`);
    const got = method === 0 ? data.slice() : await inflate(data, Math.min(usize, MAX_ENTRY, MAX_TOTAL - total));
    if (got.length !== usize) throw new Error(`${base} is damaged in the zip (it is not the size it declares)`);
    total += got.length; out.push({ name: base, bytes: got });
  }
  return out;
}
