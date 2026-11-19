import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { ZipError, crc32, readZip, writeZip } from "../web/core/zip.js";

const text = (bytes) => new TextDecoder().decode(bytes);

test("write → read round trip with unicode names", async () => {
  const zip = writeZip([{ name: "Café · Ciné/夜.xmp", data: "<x>ünï</x>" }, { name: "b.xmp", data: new Uint8Array([1, 2, 3]) }]);
  const files = await readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ["Café · Ciné/夜.xmp", "b.xmp"]);
  assert.equal(text(files[0].data), "<x>ünï</x>");
  assert.deepEqual([...files[1].data], [1, 2, 3]);
});

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

/** A zip with one deflated entry, optionally using a data descriptor like Finder's Compress does. */
function deflatedZip(name, content, { descriptor = false, flags = 0, method = 8, claimedSize } = {}) {
  const data = new TextEncoder().encode(content);
  const packed = method === 8 ? deflateRawSync(data) : data;
  const nameBytes = new TextEncoder().encode(name);
  const size = claimedSize ?? data.length;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags | (descriptor ? 8 : 0), 6); local.writeUInt16LE(method, 8);
  if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(size, 22); }
  local.writeUInt16LE(nameBytes.length, 26);
  const desc = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) { desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(packed.length, 8); desc.writeUInt32LE(size, 12); }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags | (descriptor ? 8 : 0), 8);
  central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(nameBytes.length, 28);
  const body = Buffer.concat([local, nameBytes, packed, desc]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nameBytes.length, 12); end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, central, nameBytes, end]));
}

test("reads deflated entries, with and without data descriptors", async () => {
  for (const descriptor of [false, true]) {
    const [file] = await readZip(deflatedZip("p.xmp", "hello ".repeat(500), { descriptor }));
    assert.equal(text(file.data), "hello ".repeat(500));
  }
});

test("reads zips made by macOS tools (ditto, zip)", { skip: process.platform !== "darwin" && "macOS only" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "lrmask-zip-"));
  try {
    mkdirSync(join(dir, "Pack/Sub"), { recursive: true });
    writeFileSync(join(dir, "Pack/One.xmp"), "<one/>".repeat(200));
    writeFileSync(join(dir, "Pack/Sub/Two.xmp"), "<two/>");
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", join(dir, "Pack"), join(dir, "ditto.zip")]);
    execFileSync("zip", ["-qr", "zip.zip", "Pack"], { cwd: dir });
    for (const name of ["ditto.zip", "zip.zip"]) {
      const files = await readZip(new Uint8Array(readFileSync(join(dir, name))));
      const byName = Object.fromEntries(files.map((f) => [f.name, text(f.data)]));
      assert.equal(byName["Pack/One.xmp"], "<one/>".repeat(200), name);
      assert.equal(byName["Pack/Sub/Two.xmp"], "<two/>", name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses damaged, encrypted, oversized and unsupported zips with a clear error", async () => {
  await assert.rejects(readZip(new TextEncoder().encode("not a zip at all")), ZipError);
  const good = deflatedZip("p.xmp", "x".repeat(1000));
  await assert.rejects(readZip(good.subarray(0, good.length - 30)), ZipError);
  await assert.rejects(readZip(deflatedZip("p.xmp", "x", { flags: 1 })), /password/);
  await assert.rejects(readZip(deflatedZip("p.xmp", "x", { method: 12 })), /compression/);
  await assert.rejects(readZip(deflatedZip("p.xmp", "x".repeat(10), { claimedSize: 200 * 1024 * 1024 })), /100 MB/);
  // Says 10 bytes, inflates to 100 000: stopped early.
  await assert.rejects(readZip(deflatedZip("p.xmp", "x".repeat(100000), { claimedSize: 10 })), ZipError);
  const many = writeZip(Array.from({ length: 30 }, (_, i) => ({ name: `${i}.xmp`, data: "x" })));
  await assert.rejects(readZip(many, { entries: 10, bytes: 1e9 }), /more than 10/);
  const corrupt = deflatedZip("p.xmp", "y".repeat(5000));
  corrupt.fill(0xff, 40, 60);
  await assert.rejects(readZip(corrupt), ZipError);
});
