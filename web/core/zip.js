// Zip files: read preset packs people download (stored or deflated entries), and write the
// batch Lightroom imports in one go. Uses the platform's DecompressionStream for inflating.

export class ZipError extends Error {}

const LIMITS = { entries: 5000, bytes: 100 * 1024 * 1024 };

let table;
export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a zip (stored, UTF-8 names) from [{ name, data: Uint8Array | string }]. */
export function writeZip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals = [], centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true);      // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

/** Read a zip into [{ name, data: Uint8Array }]. Folders are skipped; size limits guard against zip bombs. */
export async function readZip(bytes, limits = LIMITS) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new ZipError("Not a zip file");
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("Zip64 archives aren't supported");
  if (count > limits.entries) throw new ZipError(`Zip has more than ${limits.entries} files`);

  const decoder = new TextDecoder("utf-8");
  const out = [];
  let p = cdOffset, total = 0;
  for (let e = 0; e < count; e++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError("Damaged zip (central directory)");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (flags & 1) throw new ZipError(`"${name}" is password-protected`);
    total += size;
    if (total > limits.bytes) throw new ZipError("Zip unpacks to more than 100 MB");
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipError("Damaged zip (local header)");
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (raw.length !== compressed) throw new ZipError("Damaged zip (truncated)");
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, size);
    else throw new ZipError(`"${name}" uses an unsupported compression method`);
    if (data.length !== size) throw new ZipError(`"${name}" didn't unpack to its stated size`);
    out.push({ name, data });
  }
  return out;
}

async function inflate(raw, expected) {
  let decompressor;
  try {
    decompressor = new DecompressionStream("deflate-raw");
  } catch {
    throw new ZipError("This system can't unpack compressed zips; unzip it first and add the folder");
  }
  const stream = new Blob([raw]).stream().pipeThrough(decompressor);
  const reader = stream.getReader();
  const parts = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > expected) { await reader.cancel(); throw new ZipError("A file in the zip is larger than it claims"); }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError("Damaged zip (bad compressed data)");
  }
  return concat(parts);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
