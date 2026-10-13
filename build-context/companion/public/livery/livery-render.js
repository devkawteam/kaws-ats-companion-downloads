/* KAW Livery Wizard renderer. Author: Kaw.
   Draws a design (a stack of layers) onto any 2D canvas context at any size. Every position and size is
   stored relative to the texture (x, y in 0..1, sizes as a fraction of the texture height), so the small
   on-screen preview and the full 4096 px export come out the same. Patterns are seeded, so they repeat
   exactly. Works in the browser (window.KAWLiveryRender) and in Node (tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWLiveryRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PATTERNS = ['camo', 'carbon', 'flames', 'checker', 'chevrons'];
  const BLENDS = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten'];
  const FONTS = ['Arial Black', 'Impact', 'Arial', 'Georgia', 'Trebuchet MS', 'Courier New', 'Segoe UI', 'Verdana'];

  // Small deterministic random generator (mulberry32).
  function rng(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);

  let nextId = 1;
  const DEFAULTS = {
    fill: () => ({ mode: 'solid', c1: '#1f4fbf', c2: '#0b1530', angle: 90 }),
    stripe: () => ({ color: '#ffd200', x: 0.5, y: 0.6, width: 0.04, length: 1.2, angle: 0, count: 1, gap: 0.03 }),
    pattern: () => ({ kind: 'camo', c1: '#4b5320', c2: '#2f3518', c3: '#8a7f5a', scale: 0.08, seed: 7, angle: 0, x: 0, y: 0 }),
    text: () => ({ text: 'KAW', font: 'Arial Black', size: 0.12, color: '#ffffff', outline: '#000000', outlineWidth: 0.08, x: 0.5, y: 0.5, angle: 0, mirror: false, italic: false }),
    image: () => ({ src: '', x: 0.5, y: 0.5, scale: 0.3, angle: 0, mirror: false })
  };
  const NAMES = { fill: 'Background', stripe: 'Stripe', pattern: 'Pattern', text: 'Text', image: 'Logo / image' };

  function makeLayer(type, props = {}) {
    if (!DEFAULTS[type]) throw new Error(`Unknown layer type ${type}`);
    const l = { type, name: NAMES[type], visible: true, opacity: 1, blend: 'source-over', ...DEFAULTS[type](), ...props, type };
    if (typeof l.id !== 'string' || !l.id) l.id = `L${Date.now().toString(36)}${(nextId++).toString(36)}`;
    return l;
  }

  // Clean up a design loaded from a file: known types only, numbers clamped, colours checked.
  function normalizeDesign(d) {
    const layers = Array.isArray(d?.layers) ? d.layers : [];
    return {
      layers: layers.filter(l => l && DEFAULTS[l.type]).slice(0, 64).map(l => {
        const base = makeLayer(l.type);
        const out = { ...base, ...l, id: typeof l.id === 'string' ? l.id.slice(0, 40) : base.id, name: String(l.name || base.name).slice(0, 40) };
        out.visible = l.visible !== false; out.opacity = clamp(num(l.opacity, 1), 0, 1);
        out.blend = BLENDS.includes(l.blend) ? l.blend : 'source-over';
        for (const k of ['c1', 'c2', 'c3', 'color', 'outline']) if (k in base) out[k] = hex(l[k], base[k]);
        for (const k of ['x', 'y', 'width', 'length', 'gap', 'size', 'scale', 'outlineWidth', 'angle', 'seed', 'count']) if (k in base) out[k] = num(l[k], base[k]);
        if (out.type === 'pattern' && !PATTERNS.includes(out.kind)) out.kind = 'camo';
        if (out.type === 'fill' && !['solid', 'linear', 'radial'].includes(out.mode)) out.mode = 'solid';
        if (out.type === 'stripe') out.count = clamp(Math.round(out.count), 1, 12);
        if (out.type === 'text') { out.text = String(l.text ?? '').slice(0, 80); out.font = FONTS.includes(l.font) ? l.font : 'Arial Black'; }
        if (out.type === 'image') out.src = /^data:image\/(png|jpeg|webp|gif);base64,/.test(l.src || '') ? l.src : '';
        out.scale = out.type === 'pattern' ? clamp(out.scale, 0.01, 1) : out.scale;
        return out;
      })
    };
  }

  // ---------------------------------------------------------------- patterns (W x H texture space)
  function drawPattern(ctx, l, W, H) {
    const r = rng(l.seed), s = clamp(num(l.scale, 0.08), 0.01, 1) * H;
    const diag = Math.hypot(W, H);
    ctx.save();
    ctx.translate(W / 2 + num(l.x, 0) * W, H / 2 + num(l.y, 0) * H);
    ctx.rotate(num(l.angle, 0) * Math.PI / 180);
    const x0 = -diag / 2, y0 = -diag / 2, span = diag;
    if (l.kind === 'checker') {
      ctx.fillStyle = l.c1; ctx.fillRect(x0, y0, span, span);
      ctx.fillStyle = l.c2;
      const n = Math.ceil(span / s);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) ctx.fillRect(x0 + i * s, y0 + j * s, s + 0.5, s + 0.5);
    } else if (l.kind === 'carbon') {
      // Twill weave: alternating cells with opposite shading.
      ctx.fillStyle = l.c1; ctx.fillRect(x0, y0, span, span);
      const c = s / 2, n = Math.ceil(span / c);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = x0 + i * c, y = y0 + j * c, flip = ((i >> 0) + (j >> 1)) % 2;
        const g = ctx.createLinearGradient(x, y, flip ? x + c : x, flip ? y : y + c);
        g.addColorStop(0, l.c2); g.addColorStop(0.5, l.c3); g.addColorStop(1, l.c2);
        ctx.fillStyle = g; ctx.fillRect(x + c * 0.04, y + c * 0.04, c * 0.92, c * 0.92);
      }
    } else if (l.kind === 'chevrons') {
      ctx.fillStyle = l.c1; ctx.fillRect(x0, y0, span, span);
      ctx.fillStyle = l.c2;
      for (let y = y0 - s; y < y0 + span + s; y += s * 2) {
        ctx.beginPath(); ctx.moveTo(x0, y);
        for (let x = x0; x <= x0 + span + s; x += s) ctx.lineTo(x, y + ((Math.round((x - x0) / s)) % 2 ? s : 0));
        for (let x = x0 + Math.ceil(span / s + 1) * s; x >= x0; x -= s) ctx.lineTo(x, y + s + ((Math.round((x - x0) / s)) % 2 ? s : 0));
        ctx.closePath(); ctx.fill();
      }
    } else if (l.kind === 'flames') {
      // Classic hot-rod flames licking from the left edge; c1 tip, c2 core, c3 outline.
      const count = Math.max(3, Math.round(span / (s * 1.6)));
      for (let k = 0; k < count; k++) {
        const y = y0 + (k + 0.5) * span / count + (r() - 0.5) * s, len = span * (0.25 + r() * 0.35), w = s * (0.6 + r() * 0.6);
        const path = () => {
          ctx.beginPath(); ctx.moveTo(x0, y - w);
          const lobes = 3 + Math.floor(r() * 3); let cx = x0;
          const steps = [];
          for (let i = 1; i <= lobes; i++) steps.push([cx + len * i / lobes, (r() - 0.5) * w * 1.5]);
          for (const [x, dy] of steps) { ctx.quadraticCurveTo(x - len / lobes * 0.5, y - w * (1 - (x - x0) / len) + dy, x, y + dy * 0.4); cx = x; }
          for (const [x, dy] of steps.reverse()) ctx.quadraticCurveTo(x - len / lobes * 0.3, y + w * (1 - (x - x0) / len) + dy, x - len / lobes, y + w * (1 - (x - len / lobes - x0) / len));
          ctx.closePath();
        };
        const g = ctx.createLinearGradient(x0, 0, x0 + len, 0);
        g.addColorStop(0, l.c2); g.addColorStop(1, l.c1);
        path(); ctx.fillStyle = g; ctx.fill();
        ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = l.c3; ctx.stroke();
      }
    } else {
      // Woodland camo: seeded overlapping blobs in three tones on the first colour.
      ctx.fillStyle = l.c1; ctx.fillRect(x0, y0, span, span);
      const n = Math.min(6000, Math.round((span / s) ** 2 * 0.9));
      const tones = [l.c2, l.c3, l.c1];
      for (let i = 0; i < n; i++) {
        const cx = x0 + r() * span, cy = y0 + r() * span, rad = s * (0.35 + r() * 0.65);
        ctx.fillStyle = tones[i % 3];
        ctx.beginPath();
        const pts = 7;
        for (let p = 0; p <= pts; p++) {
          const a = p / pts * Math.PI * 2, rr = rad * (0.6 + r() * 0.6);
          if (p === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7);
          else ctx.quadraticCurveTo(cx + Math.cos(a - 0.45) * rr * 1.25, cy + Math.sin(a - 0.45) * rr * 0.9, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7);
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawLayer(ctx, l, W, H, images) {
    if (l.type === 'fill') {
      if (l.mode === 'solid') ctx.fillStyle = l.c1;
      else if (l.mode === 'radial') { const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2); g.addColorStop(0, l.c1); g.addColorStop(1, l.c2); ctx.fillStyle = g; }
      else {
        const a = num(l.angle, 90) * Math.PI / 180, dx = Math.cos(a) * W / 2, dy = Math.sin(a) * H / 2;
        const g = ctx.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy); g.addColorStop(0, l.c1); g.addColorStop(1, l.c2); ctx.fillStyle = g;
      }
      ctx.fillRect(0, 0, W, H);
    } else if (l.type === 'stripe') {
      ctx.save(); ctx.translate(l.x * W, l.y * H); ctx.rotate(num(l.angle, 0) * Math.PI / 180);
      ctx.fillStyle = l.color;
      const w = l.width * H, len = l.length * W, n = clamp(Math.round(l.count), 1, 12), gap = l.gap * H;
      const total = n * w + (n - 1) * gap;
      for (let i = 0; i < n; i++) ctx.fillRect(-len / 2, -total / 2 + i * (w + gap), len, w);
      ctx.restore();
    } else if (l.type === 'pattern') {
      drawPattern(ctx, l, W, H);
    } else if (l.type === 'text') {
      if (!l.text) return;
      const px = Math.max(1, l.size * H);
      ctx.save(); ctx.translate(l.x * W, l.y * H); ctx.rotate(num(l.angle, 0) * Math.PI / 180); if (l.mirror) ctx.scale(-1, 1);
      ctx.font = fontOf(l, px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (l.outlineWidth > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = l.outlineWidth * px; ctx.strokeStyle = l.outline; ctx.strokeText(l.text, 0, 0); }
      ctx.fillStyle = l.color; ctx.fillText(l.text, 0, 0);
      ctx.restore();
    } else if (l.type === 'image') {
      const img = images?.get?.(l.src);
      if (!img || !img.width) return;
      const h = l.scale * H, w = h * img.width / img.height;
      ctx.save(); ctx.translate(l.x * W, l.y * H); ctx.rotate(num(l.angle, 0) * Math.PI / 180); if (l.mirror) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  // Draw the whole design. Transparent areas show the in-game base colour.
  function render(ctx, design, W, H, images) {
    ctx.clearRect(0, 0, W, H);
    for (const l of design?.layers || []) {
      if (!l.visible || l.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp(num(l.opacity, 1), 0, 1);
      ctx.globalCompositeOperation = BLENDS.includes(l.blend) ? l.blend : 'source-over';
      drawLayer(ctx, l, W, H, images);
      ctx.restore();
    }
  }

  // Rough bounding box (texture-relative) of a movable layer, for the selection outline.
  const fontOf = (l, px) => `${l.italic ? 'italic ' : ''}900 ${px}px "${l.font}", sans-serif`;
  function bounds(l, W, H, images, ctx) {
    if (l.type === 'stripe') { const n = clamp(Math.round(l.count), 1, 12); return { x: l.x, y: l.y, w: l.length, h: (n * l.width + (n - 1) * l.gap) * 1, angle: l.angle }; }
    if (l.type === 'text') {
      let w = l.text.length * 0.62 * l.size * H;
      if (ctx?.measureText) { ctx.save(); ctx.font = fontOf(l, Math.max(1, l.size * H)); w = ctx.measureText(l.text).width; ctx.restore(); }
      return { x: l.x, y: l.y, w: (w + l.outlineWidth * l.size * H) / W, h: l.size, angle: l.angle };
    }
    if (l.type === 'image') { const img = images?.get?.(l.src); const ar = img?.width ? img.width / img.height : 1; return { x: l.x, y: l.y, w: (l.scale * H * ar) / W, h: l.scale, angle: l.angle }; }
    return null;
  }

  return { render, drawLayer, makeLayer, normalizeDesign, bounds, rng, PATTERNS, BLENDS, FONTS, DEFAULTS };
});
