// Livery Wizard core: real DXT5 DDS, binary tobj, ZIP and ATS paint-job mod layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const L = require('../public/livery/livery-core');

// Reference DXT5 block decoder (independent of the encoder) for round-trip checks.
function decodeBlock(b, o) {
  const a0 = b[o], a1 = b[o + 1];
  const ap = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) ap.push(Math.round(((7 - i) * a0 + i * a1) / 7));
  else { for (let i = 1; i < 5; i++) ap.push(Math.round(((5 - i) * a0 + i * a1) / 5)); ap.push(0, 255); }
  let abits = 0n; for (let i = 0; i < 6; i++) abits |= BigInt(b[o + 2 + i]) << BigInt(8 * i);
  const c0 = b[o + 8] | (b[o + 9] << 8), c1 = b[o + 10] | (b[o + 11] << 8);
  const f = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
  const e0 = f(c0), e1 = f(c1);
  const cp = [e0, e1, e0.map((v, k) => (2 * v + e1[k]) / 3), e0.map((v, k) => (v + 2 * e1[k]) / 3)];
  const idx = (b[o + 12] | (b[o + 13] << 8) | (b[o + 14] << 16) | (b[o + 15] << 24)) >>> 0;
  const px = [];
  for (let i = 0; i < 16; i++) { const c = cp[(idx >>> (2 * i)) & 3]; px.push(c[0], c[1], c[2], ap[Number((abits >> BigInt(3 * i)) & 7n)]); }
  return px;
}

function image(w, h) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = x < w / 2 ? 230 : 20; d[i + 1] = (y * 255 / h) | 0; d[i + 2] = 60; d[i + 3] = x % 64 < 32 ? 255 : 0; // stripes in alpha
  }
  return d;
}

test('DDS header is a valid DXT5 file with the full mip chain', () => {
  const dds = L.encodeDds(image(64, 32), 64, 32);
  const v = new DataView(dds.buffer);
  assert.equal(String.fromCharCode(...dds.subarray(0, 4)), 'DDS ');
  assert.equal(v.getUint32(4, true), 124);
  assert.equal(v.getUint32(12, true), 32); assert.equal(v.getUint32(16, true), 64);
  assert.equal(v.getUint32(28, true), 7, '64x32 -> 7 mip levels down to 1x1');
  assert.equal(String.fromCharCode(...dds.subarray(84, 88)), 'DXT5');
  assert.equal(v.getUint32(80, true), 4, 'FOURCC pixel format');
  // 64x32: 16x8 blocks, then 8x4, 4x2, 2x1, 1x1, 1x1, 1x1 -> (128+32+8+2+1+1+1)*16
  assert.equal(dds.length, 128 + (128 + 32 + 8 + 2 + 1 + 1 + 1) * 16);
});

test('DXT5 round-trip keeps colour and alpha close to the source', () => {
  const w = 64, h = 64, src = image(w, h);
  const dds = L.encodeDds(src, w, h, { mips: false });
  let maxColour = 0, maxAlpha = 0;
  for (let by = 0; by < h / 4; by++) for (let bx = 0; bx < w / 4; bx++) {
    const px = decodeBlock(dds, 128 + (by * (w / 4) + bx) * 16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const s = ((by * 4 + y) * w + bx * 4 + x) * 4, d = (y * 4 + x) * 4;
      for (let c = 0; c < 3; c++) maxColour = Math.max(maxColour, Math.abs(px[d + c] - src[s + c]));
      maxAlpha = Math.max(maxAlpha, Math.abs(px[d + 3] - src[s + 3]));
    }
  }
  assert.ok(maxColour <= 24, `colour error ${maxColour}`);
  assert.ok(maxAlpha <= 2, `alpha error ${maxAlpha}`);
  // Solid block: exact.
  const solid = new Uint8Array(16 * 4).fill(0); for (let i = 0; i < 16; i++) solid.set([255, 0, 0, 255], i * 4);
  const out = new Uint8Array(16); L.encodeBlock(solid, out, 0);
  assert.deepEqual(decodeBlock(out, 0).slice(0, 4), [255, 0, 0, 255]);
});

test('tobj is the 48-byte binary header plus the absolute texture path', () => {
  const t = L.tobj('KAW Flames/Peterbilt 579/Main.dds');
  assert.deepEqual([...t.subarray(0, 4)], [0x01, 0x0a, 0xb1, 0x70]);
  assert.equal(new DataView(t.buffer).getUint32(40, true), '/KAW Flames/Peterbilt 579/Main.dds'.length);
  assert.equal(new DataView(t.buffer).getUint32(44, true), 0);
  assert.equal(new TextDecoder().decode(t.subarray(48)), '/KAW Flames/Peterbilt 579/Main.dds');
  // Same bytes as Paint Job Packer's constant header.
  assert.equal(Buffer.from(t.subarray(0, 40)).toString('hex'), '010ab170000000000000000000000000000000000100020002000303030002020001000000010000');
});

test('ZIP is readable: entries, sizes and CRCs check out', () => {
  const files = [{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }];
  const z = Buffer.from(L.zip(files));
  const eocd = z.length - 22;
  assert.equal(z.readUInt32LE(eocd), 0x06054b50);
  assert.equal(z.readUInt16LE(eocd + 10), 2);
  let cd = z.readUInt32LE(eocd + 16);
  for (const f of files) {
    assert.equal(z.readUInt32LE(cd), 0x02014b50);
    const nameLen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
    assert.equal(z.toString('utf8', cd + 46, cd + 46 + nameLen), f.name);
    const size = z.readUInt32LE(off + 18), data = z.subarray(off + 30 + z.readUInt16LE(off + 26), off + 30 + z.readUInt16LE(off + 26) + size);
    assert.equal(z.readUInt32LE(off + 14), zlib.crc32(data), 'CRC matches zlib');
    assert.deepEqual([...data], [...(typeof f.data === 'string' ? Buffer.from(f.data) : f.data)]);
    cd += 46 + nameLen;
  }
});

test('mod layout: truck with cabins, alt UV, tokens and trailer accessories', () => {
  const dds = L.encodeDds(new Uint8Array(16 * 16 * 4).fill(200), 16, 16);
  const p579 = { name: 'Peterbilt 579', path: 'peterbilt.579', type: 'truck', altUv: true, separate: true, cabins: [{ code: 'a', name: 'Hi Rise Sleeper', internal: ['exclusive'] }, { code: 'b', name: 'Stand Up Sleeper', internal: ['standard'] }], accessories: { FlowBelow: ['mudflaps.aero_pnt'] } };
  const box = { name: 'SCS Box Trailer', path: 'scs.box', type: 'trailer_owned', altUv: false, separate: false, cabins: [], accessories: { 'Body (53 feet)': ['body.dryvan_53', 'body.reefer_53'], 'Trailer Front': ['f_body.paint'] } };
  const files = L.buildMod({ name: 'KAW Flames!', author: 'Kaw', price: 5000, baseColor: '#ff8000', iconDds: dds, modImageJpg: new Uint8Array([0xff, 0xd8, 0xff]), vehicles: [
    { vehicle: p579, parts: { 'cabin:a': dds, 'cabin:b': dds, 'acc:FlowBelow': dds } },
    { vehicle: box, parts: { main: dds, 'acc:Body (53 feet)': dds } }
  ] });
  const names = files.map(f => f.name);
  const text = n => { const f = files.find(x => x.name === n); assert.ok(f, `missing ${n}`); return String(f.data); };
  assert.ok(names.includes('manifest.sii') && names.includes('Description.txt') && names.includes('Image.jpg'));
  assert.match(text('manifest.sii'), /category\[\]: "paint_job"/);
  const sui = text('def/vehicle/truck/peterbilt.579/paint_job/kawflames_settings.sui');
  assert.match(sui, /alternate_uvset: true/); assert.match(sui, /airbrush: true/); assert.match(sui, /base_color: \(1, 0\.502, 0\)/);
  const cabA = text('def/vehicle/truck/peterbilt.579/paint_job/kawflamesa.sii');
  assert.match(cabA, /accessory_paint_job_data: kawflamesa\.peterbilt\.579\.paint_job/);
  assert.match(cabA, /suitable_for\[\]: "exclusive\.peterbilt\.579\.cabin"/);
  assert.match(cabA, /paint_job_mask: "\/KAW Flames\/Peterbilt 579\/Hi Rise Sleeper\.tobj"/);
  assert.match(text('def/vehicle/truck/peterbilt.579/paint_job/accessory/kawflamesa.sii'), /acc_list\[\]: "mudflaps\.aero_pnt"/);
  assert.ok(names.includes('KAW Flames/Peterbilt 579/FlowBelow.dds'));
  const trailerAcc = text('def/vehicle/trailer_owned/scs.box/paint_job/accessory/kawflames1.sii');
  assert.match(trailerAcc, /paint_job_mask: "\/KAW Flames\/SCS Box Trailer\/Body \(53 feet\)\.tobj"/);
  assert.doesNotMatch(trailerAcc, /Trailer Front/, 'unpainted accessory groups are left out');
  for (const n of names.filter(n => /def\/.*\.sii$/.test(n))) {
    const unit = /: ([a-z0-9_]+)\./.exec(text(n))?.[1];
    if (unit) assert.ok(unit.length <= 12, `token ${unit} too long`);
  }
  assert.throws(() => L.buildMod({ name: 'x', vehicles: [{ vehicle: box, parts: {} }] }), /Paint at least/);
});
