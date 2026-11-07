/* Cut-out animation engine.
 * Builds a paused GSAP timeline from a resolved timeline JSON (all times in seconds).
 * The same page plays live in the browser (preview) and is seeked frame by frame by Playwright (render).
 * See docs/TIMELINE.md for the format.
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1080, H = 1920;
  const PALETTE = {
    navy: '#24324F', dnavy: '#18213A', mustard: '#E1A73A', brick: '#C2502F', cream: '#F1E6CC',
    paper: '#F3EAD6', ink: '#1B2238', teal: '#3E6B6B', wood: '#7A5236', grey: '#9AA0A8', black: '#0A0A0A', white: '#FFFFFF',
    sand: '#EDE3CE', plum: '#6E4C5C', sky: '#C9D2DE',
  };
  let pal = { ...PALETTE };
  const col = (c, d) => { const v = c ?? d; return pal[v] || v; };

  // Deterministic randomness so preview and render match.
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const el = (tag, cls, parent, style) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    if (parent) parent.appendChild(e);
    return e;
  };
  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  // ---------- paper backgrounds drawn in SVG (jagged scissor edges + drop shadows)
  function jag(x, y, w, h, j = 7, step = 36) {
    const p = [];
    for (let i = 0; i < w; i += step) p.push([x + i, y + (rnd() - 0.5) * j]);
    for (let i = 0; i < h; i += step) p.push([x + w + (rnd() - 0.5) * j, y + i]);
    for (let i = w; i > 0; i -= step) p.push([x + i, y + h + (rnd() - 0.5) * j]);
    for (let i = h; i > 0; i -= step) p.push([x + (rnd() - 0.5) * j, y + i]);
    return p.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
  }
  function makeSvg(parent, id) {
    const s = svgEl('svg', { class: 'bg', width: W, height: H, viewBox: `0 0 ${W} ${H}` }, parent);
    s.id = id;
    const d = svgEl('defs', {}, s);
    d.innerHTML = `<filter id="sh-${id}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="#0b0f1c" flood-opacity=".35"/></filter>`;
    s._sh = `url(#sh-${id})`;
    return s;
  }
  const R = (s, x, y, w, h, fill, { j = 7, sh = true, op = 1 } = {}) =>
    svgEl('polygon', { points: jag(x, y, w, h, j), fill, opacity: op, ...(sh ? { filter: s._sh } : {}) }, s);
  const P = (s, pts, fill, sh = true) => svgEl('polygon', { points: pts, fill, ...(sh ? { filter: s._sh } : {}) }, s);
  const C = (s, cx, cy, r, fill, sh = true) => svgEl('circle', { cx, cy, r, fill, ...(sh ? { filter: s._sh } : {}) }, s);
  function raysInto(g, n, r, fill) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = a + Math.PI / n;
      svgEl('polygon', { points: `0,0 ${Math.cos(a) * r},${Math.sin(a) * r} ${Math.cos(b) * r},${Math.sin(b) * r}`, fill }, g);
    }
  }
  function skyline(s, y0, c, minH, maxH) {
    let x = -20;
    while (x < W + 20) { const w = 60 + rnd() * 90, h = minH + rnd() * (maxH - minH); R(s, x, y0 - h, w, h + 400, c, { j: 5 }); x += w - 8; }
  }

  const BACKGROUNDS = {
    plain(s, c) { R(s, -20, -20, W + 40, H + 40, col(c.base, 'sand'), { sh: false }); },
    radial(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, 'sand'), { sh: false });
      C(s, 540, c.cy || 960, 520, col(c.ring1, '#E6D6B4'), false); C(s, 540, c.cy || 960, 330, col(c.ring2, '#E1CC9F'), false);
    },
    spotlight(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, 'navy'), { sh: false });
      C(s, 540, 1000, 520, col(c.ring1, '#2E3E63'), false); C(s, 540, 1000, 380, col(c.ring2, '#34466F'), false);
      R(s, -30, 1500, W + 60, 460, col(c.floor, '#3A2A22'), { j: 9 }); R(s, -30, 1500, W + 60, 26, col(c.edge, '#5A3A2A'), { j: 4 });
    },
    sunburst(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, 'mustard'), { sh: false });
      const g = svgEl('g', { transform: `translate(540 ${c.cy || 900})` }, s);
      raysInto(g, 24, 1600, col(c.rays, 'rgba(255,240,200,.35)'));
      R(s, -30, 1560, W + 60, 400, col(c.floor, 'brick'), { j: 8 });
    },
    'window-city'(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, '#2B3A5C'), { sh: false });
      R(s, 70, 250, 940, 860, '#13192B', { j: 4 });
      const sky = c.sky || ['#F1E6CC', '#EBC873', 'mustard', '#D9803A', 'brick'];
      [262, 330, 430, 560, 700].forEach((y, i) => R(s, 90, y, 900, 1080 - y, col(sky[i % sky.length]), { sh: false, j: 3 }));
      C(s, 640, 700, 120, col(c.sun, '#F6EAC0'), false);
      skyline(s, 880, col(c.city1, 'plum'), 140, 330); skyline(s, 960, col(c.city2, '#3A3350'), 90, 260); skyline(s, 1040, col(c.city3, 'dnavy'), 60, 200);
      [90, 390, 690, 980].forEach((x) => R(s, x - 12, 250, 24, 860, col(c.frame, 'cream'), { j: 2 }));
      R(s, 70, 1090, 940, 34, col(c.frame, 'cream'), { j: 2 }); R(s, 70, 240, 940, 24, col(c.frame, 'cream'), { j: 2 });
      R(s, -30, 1330, W + 60, 640, col(c.floor, '#1E2846'), { j: 6 }); R(s, -30, 1320, W + 60, 22, '#3A4A70', { j: 3 });
    },
    office(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, '#EFE4CB'), { sh: false });
      [120, 600].forEach((x) => {
        R(s, x, 230, 360, 520, col(c.window, 'sky'), { j: 4 });
        for (let y = 250; y < 730; y += 34) R(s, x + 12, y, 336, 16, '#F7F1E1', { sh: false, j: 2 });
      });
      R(s, -30, 1050, W + 60, 40, '#B98A3E', { j: 3 }); R(s, -30, 1090, W + 60, 330, col(c.wall, 'mustard'), { j: 5 });
      R(s, -30, 1420, W + 60, 560, col(c.floor, 'wood'), { j: 6 });
    },
    stage(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, '#141B2E'), { sh: false });
      P(s, '380,-20 700,-20 1000,1800 80,1800', 'rgba(241,230,204,.10)', false);
      P(s, '470,-20 610,-20 760,1800 320,1800', 'rgba(241,230,204,.10)', false);
      R(s, -40, -20, 190, H + 40, col(c.curtain, '#8E2F22'), { j: 10 }); R(s, 930, -20, 190, H + 40, col(c.curtain, '#8E2F22'), { j: 10 });
      R(s, -40, -20, W + 80, 150, col(c.valance, '#A33A2A'), { j: 10 });
      R(s, -30, 1650, W + 60, 330, col(c.floor, '#2A1E1A'), { j: 6 });
    },
    expo(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, '#1E2A47'), { sh: false });
      for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) C(s, 90 + i * 225, 90 + k * 120, 38, col(c.lights, 'cream'), false);
      const booths = c.booths || ['brick', 'mustard', 'navy', 'teal', 'brick'];
      for (let i = 0; i < 5; i++) {
        const x = -30 + i * 230;
        R(s, x, 520, 215, 560, col(booths[i % booths.length]), { j: 6 }); R(s, x + 25, 560, 165, 120, col(c.sign, 'cream'), { j: 4 });
        R(s, x + 15, 920, 185, 160, '#11182B', { j: 4 });
      }
      R(s, -30, 1070, W + 60, 900, col(c.floor, '#5A6683'), { j: 6 }); P(s, '420,1070 660,1070 1120,1960 -40,1960', col(c.carpet, 'brick'), false);
    },
    skyline(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, 'dnavy'), { sh: false });
      for (let i = 0; i < 40; i++) C(s, rnd() * W, rnd() * 900, 2 + rnd() * 4, col(c.stars, 'cream'), false);
      C(s, 800, 330, 110, col(c.moon, '#F6EAC0'), false);
      skyline(s, 1250, col(c.city1, 'plum'), 250, 600); skyline(s, 1380, col(c.city2, 'navy'), 150, 450);
      R(s, -30, 1500, W + 60, 460, col(c.floor, '#11182B'), { j: 6 });
    },
    landscape(s, c) {
      R(s, -20, -20, W + 40, H + 40, col(c.base, '#BFD3D6'), { sh: false });
      C(s, 760, 520, 150, col(c.sun, 'mustard'), false);
      svgEl('path', { d: 'M-40 1150 Q 270 930 560 1120 T 1120 1060 V 1960 H -40Z', fill: col(c.hill1, 'teal'), filter: s._sh }, s);
      svgEl('path', { d: 'M-40 1350 Q 360 1170 700 1330 T 1120 1290 V 1960 H -40Z', fill: col(c.hill2, '#556B3E'), filter: s._sh }, s);
      R(s, -30, 1600, W + 60, 360, col(c.floor, '#8A6A3E'), { j: 8 });
    },
  };

  // ---------- helpers
  function heightFor(def, lib) {
    if (def.h) return def.h;
    if (def.piece && lib[def.piece]) return (def.w * lib[def.piece].h) / lib[def.piece].w;
    return def.w;
  }

  // Wraps every visual: .el (position + enter/exit/actions) > .in (loops) > content
  function makeElement(def, parent, lib) {
    const w = def.w || 300, h = heightFor({ ...def, w }, lib);
    const outer = el('div', 'el', parent, { left: def.x - w / 2 + 'px', top: def.y - h / 2 + 'px', width: w + 'px', height: h + 'px', zIndex: def.z ?? '' });
    const origin = def.origin === 'bottom' ? '50% 100%' : def.origin === 'top' ? '50% 0%' : '50% 50%';
    outer.style.transformOrigin = origin;
    const inner = el('div', 'in', outer, { transformOrigin: origin });
    outer._w = w; outer._h = h; outer._inner = inner;
    return outer;
  }

  function contentFor(def, outer, lib, ctx) {
    const inner = outer._inner;
    if (def.piece) {
      const L = lib[def.piece];
      const img = el('img', 'pc', inner);
      if (!L) { inner.classList.add('missing'); inner.textContent = def.piece; ctx.warn(`missing piece "${def.piece}"`); return; }
      img.src = L.src;
      if (def.flip) img.style.transform = 'scaleX(-1)';
      return;
    }
    if (def.text != null) {
      const st = def.style || 'strip';
      const t = el('div', 'txt txt-' + st, inner);
      t.innerHTML = String(def.text).split('\n').map(escapeHtml).join('<br>');
      if (def.size) t.style.fontSize = def.size + 'px';
      if (def.color) t.style.color = col(def.color);
      if (def.bg) t.style.background = col(def.bg);
      outer.style.height = 'auto';
      outer.style.width = 'max-content';
      outer.style.top = def.y + 'px';
      outer.style.transform = '';
      outer._textCenter = true;
      return;
    }
    if (def.shape) {
      const s = el('div', 'shape', inner, { background: col(def.fill, 'cream'), borderRadius: def.shape === 'circle' ? '50%' : (def.radius || 0) + 'px' });
      if (def.shadow !== false) s.style.boxShadow = '0 10px 12px rgba(0,0,0,.3)';
    }
  }
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- enter / exit / loops / actions
  const OFF = 1400;
  function enterTween(tl, e, en, t0, sfx) {
    const type = en.type || 'pop', d = en.duration ?? defaultDur(type), at = en.at ?? t0;
    tl.set(e, { visibility: 'hidden' }, 0).set(e, { visibility: 'visible' }, at);
    const ease = en.ease;
    switch (type) {
      case 'fade': tl.fromTo(e, { opacity: 0 }, { opacity: 1, duration: d, ease: ease || 'power1.out' }, at); break;
      case 'pop': tl.fromTo(e, { scale: 0 }, { scale: 1, duration: d, ease: ease || 'back.out(2.2)' }, at); sfx('pop', at); break;
      case 'grow': tl.fromTo(e, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, duration: d, ease: ease || 'power3.out' }, at); sfx('pop', at, 0.6); break;
      case 'zoom-in': tl.fromTo(e, { scale: 1.25, opacity: 0 }, { scale: 1, opacity: 1, duration: d, ease: ease || 'power2.out' }, at); break;
      case 'stamp':
        tl.fromTo(e, { scale: 2.6, opacity: 0 }, { scale: 1, opacity: 1, duration: d, ease: ease || 'power4.in' }, at);
        e._stampAt = at + d; sfx('thump', at + d * 0.9); break;
      case 'drop': tl.fromTo(e, { y: -OFF }, { y: 0, duration: d, ease: ease || 'bounce.out' }, at); sfx('whoosh', at, 0.4, 0.35); sfx('thump', at + d * 0.45, 0.6); break;
      case 'spin': tl.fromTo(e, { rotation: '-=360', scale: 0 }, { rotation: '+=360', scale: 1, duration: d, ease: ease || 'power2.out' }, at); sfx('whoosh', at, 0.5); break;
      case 'slide-left': tl.fromTo(e, { x: -OFF }, { x: 0, duration: d, ease: ease || 'power3.out' }, at); sfx('whoosh', at, 0.45, 0.4); break;
      case 'slide-right': tl.fromTo(e, { x: OFF }, { x: 0, duration: d, ease: ease || 'power3.out' }, at); sfx('whoosh', at, 0.45, 0.4); break;
      case 'slide-up': tl.fromTo(e, { y: OFF }, { y: 0, duration: d, ease: ease || 'back.out(1.3)' }, at); sfx('whoosh', at, 0.45, 0.4); break;
      case 'slide-down': tl.fromTo(e, { y: -OFF }, { y: 0, duration: d, ease: ease || 'power3.out' }, at); sfx('whoosh', at, 0.45, 0.4); break;
      case 'none': break;
      default: tl.fromTo(e, { scale: 0 }, { scale: 1, duration: d, ease: 'back.out(2)' }, at);
    }
  }
  function defaultDur(type) {
    return { fade: 0.4, pop: 0.45, grow: 0.5, 'zoom-in': 0.4, stamp: 0.28, drop: 0.8, spin: 0.9, 'slide-up': 0.7 }[type] ?? 0.6;
  }
  function exitTween(tl, e, ex, sfx) {
    const type = ex.type || 'fade', d = ex.duration ?? (type === 'wind' ? 1.4 : 0.5), at = ex.at;
    switch (type) {
      case 'fade': tl.to(e, { opacity: 0, duration: d, ease: 'power1.in' }, at); break;
      case 'shrink': tl.to(e, { scale: 0, duration: d, ease: 'back.in(2)' }, at); sfx('pop', at, 0.4); break;
      case 'fly-left': tl.to(e, { x: -OFF, duration: d, ease: 'power3.in' }, at); sfx('whoosh', at, 0.45); break;
      case 'fly-right': tl.to(e, { x: OFF, duration: d, ease: 'power3.in' }, at); sfx('whoosh', at, 0.45); break;
      case 'fly-up': tl.to(e, { y: -OFF - 400, duration: d, ease: 'power2.in' }, at); sfx('whoosh', at, 0.45); break;
      case 'fly-down': case 'fall': tl.to(e, { y: OFF, rotation: type === 'fall' ? (rnd() - 0.5) * 120 : 0, duration: d, ease: 'power1.in' }, at); sfx('whoosh', at, 0.35); break;
      case 'wind': tl.to(e, { x: OFF, y: -200 + rnd() * 300, rotation: 40 + rnd() * 60, duration: d, ease: 'power2.in' }, at); sfx('wind', at - 0.2, 0.7); break;
      default: tl.to(e, { opacity: 0, duration: d }, at);
    }
    tl.set(e, { visibility: 'hidden' }, at + d);
  }
  function loopTween(tl, inner, lp, from, to) {
    const type = lp.type, a = lp.amount, per = lp.period;
    const start = lp.from ?? from, end = lp.to ?? to, span = Math.max(0.1, end - start);
    const yoyo = (vars, half) => {
      // an odd repeat count ends the loop back at rest
      let r = Math.max(1, Math.floor(span / half) - 1);
      if (r % 2 === 0) r -= 1;
      tl.to(inner, { ...vars, duration: half, yoyo: true, repeat: Math.max(1, r), ease: 'sine.inOut' }, start);
    };
    switch (type) {
      case 'bob': yoyo({ y: -(a ?? 14) }, (per ?? 1.2) / 2); break;
      case 'float': yoyo({ y: -(a ?? 24), rotation: (a ?? 24) / 8 }, (per ?? 2.4) / 2); break;
      case 'sway': yoyo({ rotation: a ?? 2 }, (per ?? 1) / 2); break;
      case 'wobble': yoyo({ rotation: a ?? 6 }, (per ?? 0.4) / 2); break;
      case 'breathe': yoyo({ scaleY: 1 + (a ?? 0.012) }, (per ?? 2.4) / 2); break;
      case 'pulse': yoyo({ scale: 1 + (a ?? 0.06) }, (per ?? 0.8) / 2); break;
      case 'spin': tl.to(inner, { rotation: `+=${(a ?? 90) * span}`, duration: span, ease: 'none' }, start); break;
      case 'tug': {
        // deterministic pattern so several elements with the same tug move together
        const amp = a ?? 70, st = per ?? 0.42, k = [1, 0.85, 1.2, 1.05, 0.9]; let i = 0;
        for (let t = start; t < end - st; t += st, i++) {
          const s = (i % 2 ? 1 : -1) * k[i % k.length];
          tl.to(inner, { x: s * amp, rotation: (s * amp) / 12, duration: st, ease: 'sine.inOut' }, t);
        }
        tl.to(inner, { x: 0, rotation: 0, duration: st }, Math.max(start, end - st));
        break;
      }
      case 'drift': tl.to(inner, { x: a ?? 40, duration: span, ease: 'none' }, start); break;
    }
  }
  function actionTween(tl, e, ac, sfx, ctx) {
    const at = ac.at, d = ac.duration;
    switch (ac.type) {
      case 'pulse': tl.to(e, { scale: ac.scale ?? 1.25, duration: d ?? 0.25, yoyo: true, repeat: 1, ease: 'power2.out' }, at); sfx('pop', at, 0.7); break;
      case 'shake': tl.to(e, { x: `+=${ac.amount ?? 18}`, duration: 0.05, yoyo: true, repeat: ac.repeat ?? 5 }, at); sfx('clack', at); break;
      case 'jump': tl.to(e, { y: `-=${ac.amount ?? 80}`, duration: (d ?? 0.4) / 2, yoyo: true, repeat: 1, ease: 'power2.out' }, at); sfx('pop', at, 0.5); break;
      case 'spin': tl.to(e, { rotation: `+=${ac.amount ?? 360}`, duration: d ?? 0.8, ease: 'power2.inOut' }, at); sfx('whoosh', at, 0.4); break;
      case 'move': {
        const to = ac.to || {}, v = {};
        if (to.x != null) v.x = to.x - ctx.def.x;
        if (to.y != null) v.y = to.y - ctx.def.y;
        if (to.scale != null) v.scale = to.scale;
        if (to.rotation != null) v.rotation = to.rotation;
        if (to.opacity != null) v.opacity = to.opacity;
        tl.to(e, { ...v, duration: d ?? 0.6, ease: ac.ease || 'power2.inOut' }, at);
        if (ac.sfx !== false && (Math.abs(v.x || 0) > 300 || Math.abs(v.y || 0) > 300)) sfx('whoosh', at, 0.35);
        break;
      }
      case 'scale': tl.to(e, { scale: ac.to ?? 1.3, duration: d ?? 0.5, ease: ac.ease || 'back.out(2)' }, at); sfx('pop', at, 0.5); break;
      case 'rotate': tl.to(e, { rotation: ac.to ?? 10, duration: d ?? 0.4, ease: ac.ease || 'power2.out' }, at); break;
      case 'flash': tl.fromTo(e, { filter: 'brightness(3)' }, { filter: 'brightness(1)', duration: d ?? 0.5 }, at); break;
      case 'hide': tl.set(e, { visibility: 'hidden' }, at); break;
      case 'show': tl.set(e, { visibility: 'visible' }, at); break;
    }
  }

  // ---------- effects
  const EFFECTS = {
    rays(def, outer, tl, ctx) {
      const r = def.r || def.w / 2 || 350;
      outer.style.width = outer.style.height = r * 2 + 'px';
      outer.style.left = def.x - r + 'px'; outer.style.top = def.y - r + 'px';
      const s = svgEl('svg', { width: r * 2, height: r * 2, viewBox: `${-r} ${-r} ${r * 2} ${r * 2}` }, outer._inner);
      raysInto(s, def.count || 18, r, col(def.color, 'rgba(241,200,100,.55)'));
      if (!def.loop) loopTween(tl, outer._inner, { type: 'spin', amount: def.speed ?? 10 }, ctx.scene.start, ctx.scene.end);
    },
    sparkles(def, outer, tl, ctx) {
      const at = def.at ?? ctx.enterAt;
      outer.style.width = (def.w || 500) + 'px'; outer.style.height = (def.h || 400) + 'px';
      outer.style.left = def.x - (def.w || 500) / 2 + 'px'; outer.style.top = def.y - (def.h || 400) / 2 + 'px';
      for (let i = 0; i < (def.count || 7); i++) {
        const d = el('div', 'spark', outer._inner, { left: rnd() * 90 + '%', top: rnd() * 90 + '%', fontSize: 40 + rnd() * 40 + 'px', color: col(def.color, '#F6E3A0') });
        d.textContent = '✦';
        tl.fromTo(d, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, yoyo: true, repeat: 3, ease: 'power2.out' }, at + i * 0.12);
      }
      ctx.sfx('chime', at, 0.8);
    },
    burst(def, outer, tl, ctx) {
      // pieces (e.g. business cards) fly out of a point and fall
      outer.style.width = outer.style.height = '0px'; outer.style.left = def.x + 'px'; outer.style.top = def.y + 'px';
      const times = def.times || [def.at ?? ctx.enterAt];
      const L = ctx.lib[def.piece];
      times.forEach((t0) => {
        for (let i = 0; i < (def.count || 4); i++) {
          const size = def.size || 150;
          const c = L ? el('img', 'pc', outer._inner, { position: 'absolute', width: size + 'px', left: -size / 2 + 'px', top: -size / 3 + 'px' })
            : el('div', 'shape', outer._inner, { position: 'absolute', width: size + 'px', height: size * 0.6 + 'px', left: -size / 2 + 'px', background: col(def.fill, 'cream'), boxShadow: '0 8px 10px rgba(0,0,0,.3)' });
          if (L) c.src = L.src;
          const ang = rnd() * 1.6 - 0.8 + (i % 2 ? Math.PI : 0);
          const dx = Math.cos(ang) * (260 + rnd() * 200), dy = -180 - rnd() * 260;
          tl.fromTo(c, { x: 0, y: 0, rotation: 0, opacity: 0, scale: 0.4 }, { x: dx, y: dy, rotation: (rnd() - 0.5) * 300, opacity: 1, scale: 1, duration: 0.5, ease: 'power2.out' }, t0 + i * 0.06)
            .to(c, { y: H, rotation: '+=200', duration: 1.4, ease: 'power1.in' }, t0 + 0.5 + i * 0.06);
        }
        ctx.sfx('rustle', t0);
      });
    },
    'question-marks'(def, outer, tl, ctx) {
      const at = def.at ?? ctx.enterAt, n = def.count || 3;
      outer.style.left = def.x + 'px'; outer.style.top = def.y + 'px'; outer.style.width = outer.style.height = '0px';
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.7, rr = def.r || 300;
        const q = el('div', 'qm', outer._inner, { left: Math.cos(a) * rr - 75 + 'px', top: Math.sin(a) * rr - 85 + 'px' });
        q.textContent = def.char || '?';
        tl.fromTo(q, { scale: 0, rotation: -20 }, { scale: 1, rotation: (i - (n - 1) / 2) * 10, duration: 0.4, ease: 'back.out(3)' }, at + i * 0.25);
        ctx.sfx('pop', at + i * 0.25, 0.8, null, 560 + i * 80);
      }
    },
    'scan-beam'(def, outer, tl, ctx) {
      const at = def.at ?? ctx.enterAt, d = def.duration ?? 0.7, w = def.w || 580, h = def.h || 290;
      Object.assign(outer.style, { left: def.x - w / 2 + 'px', top: def.y - h / 2 + 'px', width: w + 'px', height: h + 'px' });
      const b = el('div', 'beam', outer._inner, { background: col(def.color, 'rgba(225,167,58,.85)') });
      tl.set(b, { opacity: 0 }, 0).to(b, { opacity: 1, duration: 0.1 }, at).fromTo(b, { y: 0 }, { y: h, duration: d, ease: 'sine.inOut' }, at).to(b, { opacity: 0, duration: 0.1 }, at + d);
      ctx.sfx('beep', at);
    },
    strings(def, outer, tl, ctx) {
      const at = def.at ?? ctx.enterAt;
      Object.assign(outer.style, { left: 0, top: 0, width: W + 'px', height: H + 'px' });
      const s = svgEl('svg', { width: W, height: H }, outer._inner);
      const from = ctx.defs[def.from] || { x: def.x, y: def.y };
      (def.to || []).forEach((id, i) => {
        const t = ctx.defs[id]; if (!t) return;
        const l = svgEl('line', { x1: from.x, y1: from.y, x2: t.x, y2: t.y, stroke: col(def.color, 'brick'), 'stroke-width': def.width || 7, 'stroke-linecap': 'round' }, s);
        const len = Math.hypot(t.x - from.x, t.y - from.y);
        l.setAttribute('stroke-dasharray', len); l.setAttribute('stroke-dashoffset', len);
        tl.to(l, { attr: { 'stroke-dashoffset': 0 }, duration: 0.6, ease: 'power2.out' }, at + i * 0.12);
      });
    },
    notes(def, outer, tl, ctx) {
      const at = def.at ?? ctx.enterAt, n = def.count || 5;
      Object.assign(outer.style, { left: 0, top: 0, width: W + 'px', height: H + 'px' });
      const spots = def.spots || [[150, 560], [800, 520], [120, 1500], [860, 1450], [480, 350], [540, 1650]];
      for (let i = 0; i < n; i++) {
        const [x, y] = spots[i % spots.length];
        const nt = el('div', 'note', outer._inner, { left: x - 95 + 'px', top: y - 60 + 'px' });
        nt.innerHTML = '<i style="top:30px;width:140px"></i><i style="top:56px;width:110px"></i><i style="top:82px;width:125px"></i>';
        tl.fromTo(nt, { scale: 0, rotation: (rnd() - 0.5) * 30 }, { scale: 1, duration: 0.35, ease: 'back.out(2)' }, at + i * 0.18);
        ctx.sfx('pop', at + i * 0.18, 0.5, null, 700);
        if (def.flyAt != null) tl.to(nt, { y: -1400 - rnd() * 300, x: (rnd() - 0.5) * 400, rotation: (rnd() - 0.5) * 200, opacity: 0, duration: 1.6, ease: 'power1.in' }, def.flyAt + i * 0.1);
      }
      if (def.flyAt != null) ctx.sfx('whoosh', def.flyAt, 0.5, 0.9);
    },
    ticker(def, outer, tl, ctx) {
      // a paper card that flips through values (A..Z, years, prices)
      const at = def.at ?? ctx.enterAt, step = def.step ?? 0.045, w = def.w || 250, h = def.h || 160;
      Object.assign(outer.style, { left: def.x - w / 2 + 'px', top: def.y - h / 2 + 'px', width: w + 'px', height: h + 'px', perspective: '800px' });
      const card = el('div', 'tick', outer._inner, { fontSize: (def.size || h * 0.7) + 'px', lineHeight: h + 'px', color: col(def.color, 'brick'), background: col(def.bg, '#F6EFD9') });
      const values = Array.isArray(def.values) ? def.values : String(def.values || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').split('');
      card.textContent = values[0];
      values.forEach((v, i) => {
        const t = at + i * step;
        tl.set(card, { textContent: v }, t);
        tl.fromTo(card, { rotationX: -80 }, { rotationX: 0, duration: step, ease: 'none' }, t);
        ctx.sfx('tick', t, 0.9);
      });
    },
    list(def, outer, tl, ctx) {
      // UI rows growing in (a phone contact list, a ledger)
      const at = def.at ?? ctx.enterAt, w = def.w || 320, h = def.h || 600, n = def.rows || 8;
      Object.assign(outer.style, { left: def.x - w / 2 + 'px', top: def.y - h / 2 + 'px', width: w + 'px', height: h + 'px' });
      for (let i = 0; i < n; i++) {
        const r = el('div', 'row', outer._inner, { top: 20 + i * (h - 40) / n + 'px', width: 45 + rnd() * 40 + '%', background: col(def.color, '#C9CDD6') });
        tl.from(r, { scaleX: 0, transformOrigin: '0 50%', duration: 0.25 }, at + i * 0.1);
      }
    },
    contact(def, outer, tl, ctx) {
      // a contact card UI for a phone screen: avatar, name, subtitle, note chip
      const w = def.w || 342, h = def.h || 706;
      Object.assign(outer.style, { left: def.x - w / 2 + 'px', top: def.y - h / 2 + 'px', width: w + 'px', height: h + 'px' });
      const ui = el('div', 'contact', outer._inner, { width: w + 'px', height: h + 'px' });
      const initials = def.initials || String(def.title || '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
      ui.innerHTML = `<div class="c-top" style="background:${col(def.headerColor, 'black')}"></div>
        <div class="c-av" style="background:${col(def.avatarColor, 'mustard')}">${escapeHtml(initials)}</div>
        <div class="c-name">${escapeHtml(def.title || '')}</div><div class="c-sub">${escapeHtml(def.subtitle || '')}</div>
        ${def.note ? `<div class="c-note">${escapeHtml(def.note)}${def.note2 ? `<br><span>${escapeHtml(def.note2)}</span>` : ''}</div>` : ''}
        <div class="row" style="top:${h * 0.74}px;width:70%"></div><div class="row" style="top:${h * 0.8}px;width:55%"></div>`;
      const chip = ui.querySelector('.c-note');
      if (chip && def.noteAt != null) { tl.fromTo(chip, { scale: 0 }, { scale: 1, transformOrigin: '0 0', duration: 0.4, ease: 'back.out(2)' }, def.noteAt); ctx.sfx('pop', def.noteAt, 0.8, null, 650); }
    },
    logo(def, outer, tl, ctx) {
      const w = def.w || 360;
      Object.assign(outer.style, { left: def.x - w / 2 + 'px', width: w + 'px', height: 'auto' });
      outer._inner.innerHTML = ctx.brand.logoSvg || `<div class="txt txt-label">${escapeHtml(ctx.brand.name || '')}</div>`;
      const s = outer._inner.querySelector('svg'); if (s) { s.style.width = '100%'; s.style.height = 'auto'; s.style.display = 'block'; }
      requestAnimationFrame(() => { outer.style.top = def.y - outer.offsetHeight / 2 + 'px'; });
      outer.style.top = def.y - (s ? (w * 945) / 3032 : 60) / 2 + 'px';
      if (!def.enter) { tl.set(outer, { visibility: 'hidden' }, 0).set(outer, { visibility: 'visible' }, ctx.enterAt).fromTo(outer, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4 }, ctx.enterAt); }
      ctx.sfx('chime', ctx.enterAt, 0.9);
    },
  };

  // ---------- build
  function build(T, opts = {}) {
    const stage = document.getElementById('stage');
    stage.innerHTML = '';
    seed = T.seed || 11;
    pal = { ...PALETTE, ...(T.palette || {}) };
    const lib = T.library || {};
    const brand = T.brand || {};
    const warnings = [];
    const sfxEvents = [];
    const sfx = (type, t, gain = 1, dur = null, freq = null) => { if (t >= 0) sfxEvents.push({ type, t: +t.toFixed(3), gain, ...(dur ? { dur } : {}), ...(freq ? { freq } : {}) }); };
    const tl = gsap.timeline({ paused: true });

    (T.scenes || []).forEach((S, si) => {
      const scene = el('div', 'scene', stage);
      scene.id = 'scene-' + (S.id || si);
      tl.set(scene, { visibility: 'visible' }, S.start).set(scene, { visibility: 'hidden' }, S.end);
      if (si > 0 && S.transition !== 'none') sfx('whoosh', S.start, 0.5, 0.6);
      if (si === 0) sfx('whoosh', 0.0, 0.6, 0.4);
      const cam = el('div', 'cam', scene);
      const fixed = el('div', 'fixed', scene);

      // background
      const bg = S.background || { preset: 'plain' };
      if (bg.image && lib[bg.image]) {
        const img = el('img', 'bgimg', cam);
        img.src = lib[bg.image].src;
        const dir = bg.pan || 'zoom';
        const span = S.end - S.start;
        if (dir === 'left') tl.fromTo(img, { xPercent: 4 }, { xPercent: -4, duration: span, ease: 'none' }, S.start);
        else if (dir === 'right') tl.fromTo(img, { xPercent: -4 }, { xPercent: 4, duration: span, ease: 'none' }, S.start);
        else if (dir !== 'none') tl.fromTo(img, { scale: 1.0 }, { scale: 1.08, duration: span, ease: 'none' }, S.start);
      } else if (bg.color) {
        el('div', 'bg', cam, { background: col(bg.color) });
      } else {
        if (bg.image) warnings.push(`missing background image "${bg.image}", drew "${bg.fallback || 'plain'}" instead`);
        const s = makeSvg(cam, 'bg-' + si);
        (BACKGROUNDS[bg.preset] || BACKGROUNDS[bg.fallback] || BACKGROUNDS.plain)(s, bg.colors || {});
      }

      // camera
      (S.camera || []).forEach((c) => {
        if (c.shake) { tl.to(cam, { y: `+=${c.shake}`, duration: 0.05, yoyo: true, repeat: c.repeat ?? 3 }, c.at); return; }
        const origin = c.origin ? `${c.origin[0]}px ${c.origin[1]}px` : '540px 960px';
        const to = { duration: c.duration ?? S.end - c.at, ease: c.ease || 'power2.inOut', transformOrigin: origin };
        for (const k of ['scale', 'x', 'y', 'rotation']) if (c.to && c.to[k] != null) to[k] = c.to[k];
        if (c.from) tl.fromTo(cam, { ...c.from, transformOrigin: origin }, to, c.at);
        else tl.to(cam, to, c.at);
      });

      // elements
      const defs = {};
      (S.elements || []).forEach((d) => { if (d.id) defs[d.id] = d; });
      (S.elements || []).forEach((d, i) => {
        const parent = d.fixed ? fixed : cam;
        const outer = makeElement(d, parent, lib);
        if (d.z == null) outer.style.zIndex = 10 + i;
        const ctx = { def: d, lib, defs, scene: S, brand, sfx, warn: (m) => warnings.push(`${S.id}: ${m}`), enterAt: d.enter?.at ?? d.at ?? S.start };
        if (d.effect) {
          const fx = EFFECTS[d.effect];
          if (!fx) { warnings.push(`${S.id}: unknown effect "${d.effect}"`); return; }
          fx(d, outer, tl, ctx);
        } else {
          contentFor(d, outer, lib, ctx);
        }
        const base = { rotation: d.rotation || 0, opacity: d.opacity ?? 1 };
        if (outer._textCenter) { base.xPercent = -50; base.yPercent = -50; }
        gsap.set(outer, base);
        if (outer._textCenter) outer.style.left = d.x + 'px';
        if (d.enter) {
          enterTween(tl, outer, d.enter, S.start, d.sfx === false ? () => {} : sfx);
          if (d.text != null && d.sfx !== false && !['stamp', 'fade', 'none'].includes(d.enter.type)) sfx('pop', d.enter.at ?? S.start, 0.6, null, 420);
          if (outer._stampAt && d.shake !== false) tl.to(cam, { y: '+=14', duration: 0.05, yoyo: true, repeat: 3 }, outer._stampAt);
        }
        (d.loops || (d.loop ? [d.loop] : [])).forEach((lp) => loopTween(tl, outer._inner, lp, d.enter?.at ?? S.start, d.exit?.at ?? S.end));
        (d.actions || []).forEach((ac) => actionTween(tl, outer, ac, d.sfx === false ? () => {} : sfx, ctx));
        if (d.exit) exitTween(tl, outer, d.exit, d.sfx === false ? () => {} : sfx);
      });
      (S.sfx || []).forEach((s) => sfx(s.type, s.at, s.gain ?? 1, s.dur, s.freq));
    });

    // paper grain over everything
    const g = svgEl('svg', { class: 'grain', width: W, height: H }, stage);
    g.innerHTML = '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .4  0 0 0 -.9 .62"/></filter><rect width="1080" height="1920" filter="url(#grain)"/>';

    const duration = T.duration || Math.max(...(T.scenes || [{ end: 1 }]).map((s) => s.end));
    tl.to({}, { duration: 0.01 }, Math.max(0, duration - 0.01));
    const events = dedupe(sfxEvents.filter((e) => e.t < duration));
    return { tl, duration, warnings, sfxEvents: events };
  }

  function dedupe(ev) {
    ev.sort((a, b) => a.t - b.t);
    const out = [];
    for (const e of ev) {
      const prev = out.findLast?.((o) => o.type === e.type) ?? [...out].reverse().find((o) => o.type === e.type);
      if (prev && e.t - prev.t < (e.type === 'tick' ? 0.02 : 0.08)) continue;
      out.push(e);
    }
    return out;
  }

  window.CutoutEngine = { build, BACKGROUNDS: Object.keys(BACKGROUNDS), EFFECTS: Object.keys(EFFECTS), PALETTE };
})();
