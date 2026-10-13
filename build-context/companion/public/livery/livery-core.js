/* KAW Livery Wizard core. Author: Kaw.
   Turns painted images into a real American Truck Simulator paint-job mod, entirely on this PC:
   - DXT5 (BC3) DDS textures with a full mip chain (a real encoder, not a renamed PNG)
   - binary .tobj texture objects, SII/SUI definitions, manifest, icon material
   - a ZIP the game can load from Documents/American Truck Simulator/mod
   File layout and formats follow the community-verified Paint Job Packer (MIT, Carsmaniac) and
   the SCS modding wiki. Works in the browser (window.KAWLivery) and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWLivery = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const enc = new TextEncoder();

  // ---------------------------------------------------------------- DXT5 / DDS
  const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  const from565 = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];

  // One 4x4 block (16 RGBA texels) -> 16 bytes of BC3.
  function encodeBlock(px, out, o) {
    // ---- alpha: 8-value mode (alpha0 > alpha1) using the block's min/max
    let amin = 255, amax = 0;
    for (let i = 0; i < 16; i++) { const a = px[i * 4 + 3]; if (a < amin) amin = a; if (a > amax) amax = a; }
    out[o] = amax; out[o + 1] = amin;
    if (amax > amin) {
      const pal = [amax, amin];
      for (let i = 1; i < 7; i++) pal.push(Math.round(((7 - i) * amax + i * amin) / 7));
      let bits = 0n;
      for (let i = 0; i < 16; i++) {
        const a = px[i * 4 + 3];
        let best = 0, bd = 1e9;
        for (let k = 0; k < 8; k++) { const d = Math.abs(pal[k] - a); if (d < bd) { bd = d; best = k; } }
        bits |= BigInt(best) << BigInt(3 * i);
      }
      for (let b = 0; b < 6; b++) out[o + 2 + b] = Number((bits >> BigInt(8 * b)) & 0xffn);
    } else for (let b = 0; b < 6; b++) out[o + 2 + b] = 0;
    // ---- colour: bounding box endpoints, inset 1/16 to reduce error, 4-colour interpolation
    let r0 = 255, g0 = 255, b0 = 255, r1 = 0, g1 = 0, b1 = 0;
    for (let i = 0; i < 16; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
      if (r < r0) r0 = r; if (g < g0) g0 = g; if (b < b0) b0 = b;
      if (r > r1) r1 = r; if (g > g1) g1 = g; if (b > b1) b1 = b;
    }
    const ir = (r1 - r0) >> 4, ig = (g1 - g0) >> 4, ib = (b1 - b0) >> 4;
    let c0 = to565(Math.min(255, r1 - ir), Math.min(255, g1 - ig), Math.min(255, b1 - ib));
    let c1 = to565(r0 + ir, g0 + ig, b0 + ib);
    if (c0 < c1) { const t = c0; c0 = c1; c1 = t; }
    out[o + 8] = c0 & 255; out[o + 9] = c0 >> 8; out[o + 10] = c1 & 255; out[o + 11] = c1 >> 8;
    let idx = 0;
    if (c0 !== c1) {
      const e0 = from565(c0), e1 = from565(c1);
      const pal = [e0, e1, e0.map((v, k) => (2 * v + e1[k]) / 3), e0.map((v, k) => (v + 2 * e1[k]) / 3)];
      for (let i = 15; i >= 0; i--) {
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
        let best = 0, bd = 1e12;
        for (let k = 0; k < 4; k++) { const p = pal[k]; const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < bd) { bd = d; best = k; } }
        idx = (idx << 2) | best;
      }
    }
    out[o + 12] = idx & 255; out[o + 13] = (idx >>> 8) & 255; out[o + 14] = (idx >>> 16) & 255; out[o + 15] = (idx >>> 24) & 255;
  }

  function encodeLevel(rgba, w, h) {
    const bw = Math.max(1, (w + 3) >> 2), bh = Math.max(1, (h + 3) >> 2);
    const out = new Uint8Array(bw * bh * 16);
    const px = new Uint8Array(64);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const sx = Math.min(w - 1, bx * 4 + x), sy = Math.min(h - 1, by * 4 + y);
        const s = (sy * w + sx) * 4, d = (y * 4 + x) * 4;
        px[d] = rgba[s]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s + 2]; px[d + 3] = rgba[s + 3];
      }
      encodeBlock(px, out, (by * bw + bx) * 16);
    }
    return out;
  }

  // 2x2 box filter for the next mip level.
  function downsample(rgba, w, h) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
    const out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
      const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1), y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
      out[(y * nw + x) * 4 + c] = (rgba[(y0 * w + x0) * 4 + c] + rgba[(y0 * w + x1) * 4 + c] + rgba[(y1 * w + x0) * 4 + c] + rgba[(y1 * w + x1) * 4 + c] + 2) >> 2;
    }
    return { rgba: out, w: nw, h: nh };
  }

  function ddsHeader(w, h, mips) {
    const b = new DataView(new ArrayBuffer(128));
    b.setUint32(0, 0x20534444, true);                 // "DDS "
    b.setUint32(4, 124, true);
    b.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, true); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|MIPMAPCOUNT|LINEARSIZE
    b.setUint32(12, h, true); b.setUint32(16, w, true);
    b.setUint32(20, Math.max(1, (w + 3) >> 2) * Math.max(1, (h + 3) >> 2) * 16, true);
    b.setUint32(28, mips, true);
    b.setUint32(76, 32, true); b.setUint32(80, 0x4, true); // pixel format: FOURCC
    b.setUint32(84, 0x35545844, true);                     // "DXT5"
    b.setUint32(108, 0x1000 | 0x8 | 0x400000, true);       // TEXTURE|COMPLEX|MIPMAP
    return new Uint8Array(b.buffer);
  }

  // rgba: Uint8Array/Uint8ClampedArray (w*h*4). Returns a complete .dds file.
  function encodeDds(rgba, w, h, { mips = true, onProgress } = {}) {
    if (!(w > 0 && h > 0) || rgba.length < w * h * 4) throw new Error('Image data does not match its size.');
    const levels = [];
    let cur = { rgba, w, h };
    const count = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    for (let i = 0; i < count; i++) {
      levels.push(encodeLevel(cur.rgba, cur.w, cur.h));
      onProgress?.((i + 1) / count);
      if (i + 1 < count) cur = downsample(cur.rgba, cur.w, cur.h);
    }
    const header = ddsHeader(w, h, count);
    const out = new Uint8Array(header.length + levels.reduce((a, l) => a + l.length, 0));
    out.set(header, 0);
    let off = header.length;
    for (const l of levels) { out.set(l, off); off += l.length; }
    return out;
  }

  // ---------------------------------------------------------------- .tobj (binary)
  const TOBJ_HEADER = [0x01, 0x0a, 0xb1, 0x70, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x03, 0x03, 0x03, 0x00, 0x02, 0x02, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00];
  function tobj(ddsPath) {
    const p = enc.encode(ddsPath.startsWith('/') ? ddsPath : '/' + ddsPath);
    const out = new Uint8Array(40 + 8 + p.length);
    out.set(TOBJ_HEADER, 0);
    new DataView(out.buffer).setUint32(40, p.length, true);
    out.set(p, 48);
    return out;
  }

  // ---------------------------------------------------------------- ZIP (stored)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(data) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files, date = new Date()) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const locals = [], centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = centrals.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ---------------------------------------------------------------- mod files
  const sanitize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w .()&'-]/g, '').trim().slice(0, 60);
  const sii = s => String(s).replace(/["\\]/g, '').replace(/[\u0000-\u001f]/g, ' ');
  // SII tokens: max 12 characters of a-z, 0-9, _.
  function token(base, used = new Set()) {
    let t = String(base || 'kaw').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 12) || 'kaw';
    let n = 0;
    while (used.has(t)) { n++; const s = String(n); t = t.slice(0, 12 - s.length) + s; }
    used.add(t);
    return t;
  }
  const colour = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '(1, 1, 1)'; const v = parseInt(m[1], 16); return `(${[(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => (c / 255).toFixed(3).replace(/\.?0+$/, '') || '0').join(', ')})`; };

  /* spec = {
       name, author, version, description, price, unlock, baseColor ('#rrggbb'), baseColorUnlocked,
       vehicles: [{ vehicle (catalog entry), parts: { [partKey]: Uint8Array dds } }]
         partKey: 'main' | 'cabin:<code>' | 'acc:<group name>'
       modImageJpg: Uint8Array (276x162), iconDds: Uint8Array (256x64 DXT5)
     } -> [{ name, data }] */
  function buildMod(spec) {
    const name = sanitize(spec.name) || 'KAW Paint Job';
    const author = sanitize(spec.author) || 'KAW';
    const used = new Set();
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const id = token((slug.startsWith('kaw') ? '' : 'kaw') + slug, used);
    const files = [];
    const add = (n, data) => files.push({ name: n, data });
    add('manifest.sii', `SiiNunit\n{\nmod_package: .package_name\n{\n\tpackage_version: "${sii(spec.version || '1.0')}"\n\tdisplay_name: "${sii(name)}"\n\tauthor: "${sii(author)}"\n\n\tcategory[]: "paint_job"\n\tmp_mod_optional: true\n\n\ticon: "Image.jpg"\n\tdescription_file: "Description.txt"\n}\n}\n`);
    add('Description.txt', `${sii(spec.description || name)}\n\nMade with the KAW Livery Wizard (KAW'S ATS Playground Companion).\nVehicles: ${spec.vehicles.map(v => v.vehicle.name).join(', ')}\n`);
    if (spec.modImageJpg) add('Image.jpg', spec.modImageJpg);
    if (spec.iconDds) {
      add(`${name}/Icon.dds`, spec.iconDds);
      add(`material/ui/accessory/${id}_icon.tobj`, tobj(`${name}/Icon.dds`));
      add(`material/ui/accessory/${id}_icon.mat`, `material: "ui"\n{\n\ttexture: "${id}_icon.tobj"\n\ttexture_name: "texture"\n}\n`);
    }
    for (const { vehicle: v, parts } of spec.vehicles) {
      const vdir = `${name}/${sanitize(v.name)}`;
      const defDir = `def/vehicle/${v.type}/${v.path}/paint_job`;
      const settings = [
        `\tname: "${sii(name)}"`, `\tprice: ${Math.max(0, Math.round(Number(spec.price) || 0))}`, `\tunlock: ${Math.max(0, Math.round(Number(spec.unlock) || 0))}`,
        `\ticon: "${id}_icon"`, '\tairbrush: true', `\tbase_color: ${colour(spec.baseColor)}`,
        ...(spec.baseColorUnlocked || v.colourPicker ? ['\tbase_color_locked: false'] : []),
        ...(v.altUv ? ['\talternate_uvset: true'] : [])
      ].join('\n') + '\n';
      add(`${defDir}/${id}_settings.sui`, settings);
      const texture = (fileBase, dds) => { add(`${vdir}/${fileBase}.dds`, dds); add(`${vdir}/${fileBase}.tobj`, tobj(`${vdir}/${fileBase}.dds`)); return `/${vdir}/${fileBase}.tobj`; };
      // One definition per cabin (or one for the whole vehicle).
      const cabinParts = (v.separate && v.cabins?.length) ? v.cabins.filter(c => parts[`cabin:${c.code}`]).map(c => ({ key: `cabin:${c.code}`, cabin: c })) : (parts.main ? [{ key: 'main', cabin: null }] : []);
      if (!cabinParts.length) throw new Error(`Paint at least the main part of the ${v.name}.`);
      const accGroups = Object.keys(v.accessories || {}).filter(g => parts[`acc:${g}`]);
      for (const cp of cabinParts) {
        const indiv = token(id + (cp.cabin ? cp.cabin.code : ''), used);
        const mask = texture(cp.cabin ? `${sanitize(cp.cabin.name) || cp.cabin.code}` : 'Main', parts[cp.key]);
        const suitable = cp.cabin ? cp.cabin.internal.map(n => `\tsuitable_for[]: "${n}.${v.path}.cabin"`).join('\n') + '\n' : '';
        add(`${defDir}/${indiv}.sii`, `SiiNunit\n{\naccessory_paint_job_data: ${indiv}.${v.path}.paint_job\n{\n@include "${id}_settings.sui"\n${suitable}\tpaint_job_mask: "${mask}"\n}\n}\n`);
        // Accessory overrides are matched by file name = paint job token.
        if (accGroups.length) {
          const blocks = accGroups.map((g, i) => {
            const m = `/${vdir}/${sanitize(g)}.tobj`;
            return `simple_paint_job_data: .ovr${i}\n{\n\tpaint_job_mask: "${m}"\n${v.accessories[g].map(a => `\tacc_list[]: "${a}"`).join('\n')}\n}`;
          }).join('\n\n');
          add(`${defDir}/accessory/${indiv}.sii`, `SiiNunit\n{\n${blocks}\n}\n`);
        }
      }
      for (const g of accGroups) texture(sanitize(g), parts[`acc:${g}`]);
    }
    return files;
  }

  return { encodeDds, encodeBlock, tobj, zip, crc32, buildMod, token, sanitize, colour, ddsHeader };
});
