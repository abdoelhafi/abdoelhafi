import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config, ROOT } from './config.js';
import * as store from './store.js';
import { projectDir } from './store.js';
import { generateJSON, providerInfo } from './llm.js';
import * as P from './prompts.js';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from './settings.js';
import * as eleven from './eleven.js';
import { generateImage } from './gemini-image.js';
import { py, probeDuration } from './proc.js';
import { wordsFromAlignment, resolveTimeline, lintTimeline } from './timeline.js';
import { stills, startRender, renderStatus } from './render.js';

const app = express();
app.use(express.json({ limit: '5mb' }));
const upload = multer({ dest: path.join(ROOT, 'data', 'tmp'), limits: { fileSize: 25 * 1024 * 1024 } });

app.use('/', express.static(path.join(ROOT, 'public')));
app.use('/engine', express.static(path.join(ROOT, 'engine')));
app.get('/vendor/gsap.min.js', (req, res) => res.sendFile(path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js')));
app.get('/docs/TIMELINE.md', (req, res) => res.type('text/plain').sendFile(path.join(ROOT, 'docs/TIMELINE.md')));
app.use('/api/projects/:id/files', (req, res, next) => {
  try { express.static(projectDir(req.params.id), { dotfiles: 'ignore' })(req, res, next); } catch (e) { next(e); }
});

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const baseUrl = () => `http://127.0.0.1:${config.port}`;
const fileUrl = (id, ...p) => `/api/projects/${id}/files/${p.map(encodeURIComponent).join('/')}`;

// ------------------------------------------------------------------ status + settings
app.get('/api/status', h(async (req, res) => {
  res.json({ ...providerInfo(), python: config.python, settings: getSettings() });
}));
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => res.json(saveSettings(req.body)));
app.post('/api/settings/reset', (req, res) => res.json(saveSettings(DEFAULT_SETTINGS)));

// ------------------------------------------------------------------ projects
app.get('/api/projects', (req, res) => res.json(store.listProjects()));
app.post('/api/projects', (req, res) => res.json(store.create(req.body || {})));
app.get('/api/projects/:id', (req, res) => res.json(withUrls(store.load(req.params.id))));
app.patch('/api/projects/:id', (req, res) => {
  const allowed = ['name', 'theme', 'step', 'notes'];
  res.json(withUrls(store.update(req.params.id, (p) => { for (const k of allowed) if (k in req.body) p[k] = req.body[k]; })));
});
app.delete('/api/projects/:id', (req, res) => { store.remove(req.params.id); res.json({ ok: true }); });

function withUrls(p) {
  return {
    ...p,
    pieces: p.pieces.map((x) => ({ ...x, url: fileUrl(p.id, 'pieces', x.file) })),
    assets: p.assets.map((a) => ({ ...a, uploads: (a.uploads || []).map((u) => ({ ...u, url: fileUrl(p.id, 'uploads', u.file) })) })),
    voice: p.voice ? { ...p.voice, url: fileUrl(p.id, 'vo', p.voice.file) } : null,
    renders: (p.renders || []).map((r) => ({ ...r, url: fileUrl(p.id, 'renders', r.file) })),
  };
}

// ------------------------------------------------------------------ 1. ideas
app.post('/api/projects/:id/ideas', h(async (req, res) => {
  const p = store.load(req.params.id);
  const theme = (req.body.theme || p.theme || '').trim();
  if (!theme) throw bad('Type a theme first.');
  const { system, prompt } = P.ideasPrompt({ theme, count: clamp(req.body.count || 15, 3, 25), settings: getSettings(), exclude: req.body.append ? p.ideas.map((i) => i.title) : [] });
  const out = await generateJSON({ task: 'ideas', system, prompt, webSearch: req.body.webSearch !== false });
  const ideas = (out.ideas || out || []).map((i, k) => ({ ...i, id: i.id || `idea-${k}`, verified: i.verified !== false && (i.sources || []).length >= 1 }));
  res.json(withUrls(store.update(p.id, (q) => { q.theme = theme; q.ideas = req.body.append ? [...q.ideas, ...ideas] : ideas; })));
}));

app.post('/api/projects/:id/idea', h(async (req, res) => {
  res.json(withUrls(store.update(req.params.id, (p) => {
    const idea = req.body.idea || p.ideas.find((i) => i.id === req.body.ideaId);
    if (!idea) throw bad('Idea not found');
    if (idea.verified === false && !req.body.force) throw bad('This idea is marked unverified. Check its facts first, or choose another.');
    p.idea = idea; p.step = 'script';
    if (!p.name || p.name === p.theme || p.name === 'Untitled video') p.name = idea.title;
  })));
}));

// ------------------------------------------------------------------ 2. script (+ 3. Gemini prompts)
app.post('/api/projects/:id/script', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.idea) throw bad('Choose an idea first.');
  const settings = getSettings();
  const { system, prompt } = P.scriptPrompt({ idea: p.idea, settings, notes: req.body.notes || '' });
  const script = await generateJSON({ task: 'script', system, prompt });
  res.json(withUrls(store.update(p.id, (q) => applyScript(q, script, settings))));
}));

app.put('/api/projects/:id/script', h(async (req, res) => {
  res.json(withUrls(store.update(req.params.id, (q) => applyScript(q, req.body.script, getSettings()))));
}));

function applyScript(p, script, settings) {
  if (!script?.lines?.length) throw bad('The script has no narration lines.');
  script.assets = (script.assets || []).map((a) => ({ ...a, id: store.slug(a.id || a.description).replace(/-/g, '_') }));
  const old = Object.fromEntries((p.assets || []).map((a) => [a.id, a]));
  p.script = script;
  p.assets = script.assets.map((a) => {
    const prev = old[a.id] || {};
    const prompts = P.imagePrompts(a, settings);
    return {
      ...a,
      prompt: prev.customPrompt ? prev.prompt : prompts.prompt,
      splitPrompt: a.split ? (prev.customSplitPrompt ? prev.splitPrompt : prompts.splitPrompt) : undefined,
      customPrompt: prev.customPrompt, customSplitPrompt: prev.customSplitPrompt,
      uploads: prev.uploads || [],
    };
  });
  p.scriptStats = scriptStats(script);
  if (p.step === 'script' || p.step === 'ideas') p.step = 'assets';
  return p;
}

function scriptStats(script) {
  const text = P.ttsText(script);
  const words = script.lines.map((l) => l.text).join(' ').split(/\s+/).filter(Boolean).length;
  const warnings = [];
  if (text.length > 1050) warnings.push(`Narration is ${text.length} characters; aim for under 1,050 to protect your ElevenLabs credits.`);
  if (script.lines.length !== 8) warnings.push(`${script.lines.length} lines (8 recommended).`);
  if ((script.punchWords || []).length > 2) warnings.push('More than 2 punch words; keep on-screen text minimal.');
  const flat = script.lines.map((l) => l.text).join(' ').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ');
  for (const s of script.scenes || []) {
    const cue = String(s.cue || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim();
    if (cue && !flat.includes(cue)) warnings.push(`Scene ${s.id}: cue "${s.cue}" is not in the narration text.`);
  }
  return { characters: text.length, words, estSeconds: Math.round(words / 2.6), warnings };
}

app.patch('/api/projects/:id/assets/:assetId', h(async (req, res) => {
  res.json(withUrls(store.update(req.params.id, (p) => {
    const a = findAsset(p, req.params.assetId);
    if ('prompt' in req.body) { a.prompt = req.body.prompt; a.customPrompt = true; }
    if ('splitPrompt' in req.body) { a.splitPrompt = req.body.splitPrompt; a.customSplitPrompt = true; }
    if ('split' in req.body) { a.split = !!req.body.split; if (a.split && !a.splitPrompt) a.splitPrompt = P.splitPrompt(); }
    if ('description' in req.body) a.description = req.body.description;
  })));
}));

app.post('/api/projects/:id/assets', h(async (req, res) => {
  // add an extra asset by hand
  res.json(withUrls(store.update(req.params.id, (p) => {
    const a = { id: store.slug(req.body.id || req.body.description).replace(/-/g, '_'), kind: req.body.kind || 'object', description: req.body.description || '', uploads: [] };
    if (p.assets.some((x) => x.id === a.id)) throw bad('An asset with that id exists');
    Object.assign(a, P.imagePrompts(a, getSettings()));
    p.assets.push(a);
  })));
}));

// ------------------------------------------------------------------ 4. uploads, Gemini generation, cut-out + checks
app.post('/api/projects/:id/assets/:assetId/upload', upload.single('image'), h(async (req, res) => {
  if (!req.file) throw bad('No image uploaded');
  const variant = req.body.variant === 'split' ? 'split' : 'full';
  const ext = (path.extname(req.file.originalname) || '.png').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png';
  const result = await ingestImage(req.params.id, req.params.assetId, variant, (dest) => fs.renameSync(req.file.path, dest), ext);
  res.json(result);
}));

app.post('/api/projects/:id/assets/:assetId/generate', h(async (req, res) => {
  const p = store.load(req.params.id);
  const a = findAsset(p, req.params.assetId);
  const variant = req.body.variant === 'split' ? 'split' : 'full';
  const prompt = req.body.prompt || (variant === 'split' ? a.splitPrompt : a.prompt);
  const refs = [];
  if (variant === 'split') {
    const full = [...(a.uploads || [])].reverse().find((u) => u.variant === 'full');
    if (!full) throw bad('Generate or upload the full-body image first, so the split keeps the same character.');
    refs.push({ path: projectDir(p.id, 'uploads', full.file), mime: mimeOf(full.file) });
  }
  const img = await generateImage(prompt, refs, a.kind === 'background' ? '16:9' : undefined);
  const ext = img.mime.includes('jpeg') ? '.jpg' : '.png';
  res.json(await ingestImage(p.id, a.id, variant, (dest) => fs.writeFileSync(dest, img.buffer), ext, { generated: true }));
}));

app.post('/api/projects/:id/assets/:assetId/recut', h(async (req, res) => {
  const p = store.load(req.params.id);
  const a = findAsset(p, req.params.assetId);
  const up = a.uploads.find((u) => u.file === req.body.file) || a.uploads[a.uploads.length - 1];
  if (!up) throw bad('Nothing uploaded yet');
  res.json(await cutUpload(p.id, a.id, up.file, up.variant, { method: req.body.method, threshold: req.body.threshold, autoRepaint: req.body.autoRepaint !== false }));
}));

async function ingestImage(id, assetId, variant, write, ext, extra = {}) {
  const p = store.load(id);
  findAsset(p, assetId);
  const file = `${assetId}-${variant}-${Date.now()}${ext}`;
  write(projectDir(id, 'uploads', file));
  store.update(id, (q) => { findAsset(q, assetId).uploads.push({ file, variant, at: new Date().toISOString(), ...extra }); });
  return cutUpload(id, assetId, file, variant, {});
}

async function cutUpload(id, assetId, file, variant, { method = 'auto', threshold = 30, autoRepaint = true }) {
  const p = store.load(id);
  const a = findAsset(p, assetId);
  const kind = a.kind === 'background' ? 'background' : variant === 'split' ? 'split' : a.kind;
  const name = variant === 'split' ? `${a.id}_part` : a.id;
  const outDir = projectDir(id, 'pieces');
  const tmp = projectDir(id, 'pieces', `.tmp-${Date.now()}`);
  const r = await py('cutout.py', ['--src', projectDir(id, 'uploads', file), '--out', tmp, '--name', name, '--kind', kind,
    '--expect', variant === 'split' ? P.SPLIT_PIECES.length : 0, '--method', method, '--threshold', threshold]);
  if (!r.pieces) throw new Error('Cut-out failed: ' + JSON.stringify(r).slice(0, 400));

  // name the pieces
  const real = r.pieces.filter((x) => !x.flags.includes('duplicate'));
  const names = {};
  if (kind === 'objects' && a.pieceNames?.length) {
    real.forEach((x, i) => { names[x.file] = a.pieceNames[i] || `${a.id}_extra_${i}`; });
  } else if (kind === 'character' || kind === 'object') {
    const main = real.reduce((m, x) => (!m || x.area > m.area ? x : m), null);
    real.forEach((x, i) => { names[x.file] = x === main ? a.id : `${a.id}_extra_${i}`; });
  } else if (kind === 'background') {
    names[r.pieces[0]?.file] = a.id;
  } else {
    real.forEach((x, i) => { names[x.file] = `${a.id}_part_${String(i).padStart(2, '0')}`; });
  }

  const updated = store.update(id, (q) => {
    const qa = findAsset(q, assetId);
    // a new cut of this asset+variant replaces the previous pieces
    const stale = q.pieces.filter((x) => x.assetId === assetId && x.variant === variant);
    for (const s of stale) fs.rmSync(path.join(outDir, s.file), { force: true });
    q.pieces = q.pieces.filter((x) => !(x.assetId === assetId && x.variant === variant));
    const stamp = Date.now().toString(36);
    for (const x of r.pieces) {
      const nm = names[x.file] || `${a.id}_dup_${x.file.replace(/\D/g, '')}`;
      const fn = `${nm}-${stamp}${path.extname(x.file)}`;
      fs.renameSync(path.join(tmp, x.file), path.join(outDir, fn));
      const extraPiece = /_extra_|_dup_/.test(nm);
      q.pieces.push({
        file: fn, name: uniqueName(q, nm), assetId, variant, upload: file, w: x.w, h: x.h, flags: x.flags,
        kind: kind === 'background' ? 'background' : a.kind, background: kind === 'background',
        use: !x.flags.includes('duplicate') && !extraPiece,
      });
    }
    const up = qa.uploads.find((u) => u.file === file);
    if (up) {
      up.checks = r.checks.map((c) => ({ ...c, fix: P.fixPrompt(c.code, qa, getSettings()) }));
      up.info = r.info; up.method = method; up.threshold = threshold;
    }
    qa.status = r.checks.some((c) => c.level === 'error') ? 'needs-fix' : 'ok';
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  // Fix Gemini's brick-red skin on split hands/legs in code instead of asking for a new image.
  if (kind === 'split' && autoRepaint) {
    const reds = updated.pieces.filter((x) => x.assetId === assetId && x.variant === 'split' && x.flags?.includes('red_skin'));
    if (reds.length) {
      const ref = updated.pieces.find((x) => x.assetId === assetId && x.variant === 'full' && x.use !== false);
      for (const x of reds) {
        const args = ['--piece', projectDir(id, 'pieces', x.file)];
        if (ref) args.push('--ref', projectDir(id, 'pieces', ref.file));
        x.repainted = await py('repaint.py', args).catch((e) => ({ ok: false, error: e.message }));
      }
      return withUrls(store.update(id, (q) => {
        for (const x of reds) {
          const y = q.pieces.find((z) => z.file === x.file);
          if (!y || !x.repainted?.ok) continue;
          y.flags = y.flags.filter((f) => f !== 'red_skin'); y.repainted = x.repainted; y.v = Date.now();
        }
        const up = findAsset(q, assetId).uploads.find((u) => u.file === file);
        if (up) up.checks = up.checks.map((c) => (c.code === 'red_skin' ? { ...c, level: 'info', message: `Red skin on ${reds.map((r) => r.name).join(', ')} was repainted automatically. If that red was clothing, untick “fix red skin” and press Re-cut.`, fix: '' } : c));
      }));
    }
  }
  return withUrls(updated);
}

function uniqueName(p, nm) {
  let n = nm, k = 2;
  while (p.pieces.some((x) => x.name === n)) n = `${nm}_${k++}`;
  return n;
}

app.patch('/api/projects/:id/pieces/:file', h(async (req, res) => {
  res.json(withUrls(store.update(req.params.id, (p) => {
    const x = p.pieces.find((q) => q.file === req.params.file);
    if (!x) throw bad('Piece not found');
    if ('name' in req.body) {
      const nm = store.slug(req.body.name).replace(/-/g, '_');
      if (p.pieces.some((q) => q !== x && q.name === nm && q.use !== false)) throw bad(`Another piece is already named "${nm}"`);
      x.name = nm;
    }
    if ('use' in req.body) x.use = !!req.body.use;
  })));
}));

app.post('/api/projects/:id/pieces/:file/repaint', h(async (req, res) => {
  const p = store.load(req.params.id);
  const x = p.pieces.find((q) => q.file === req.params.file);
  if (!x) throw bad('Piece not found');
  const head = p.pieces.find((q) => q.assetId === x.assetId && /head/.test(q.name)) || p.pieces.find((q) => q.assetId === x.assetId && q.variant === 'full');
  const args = ['--piece', projectDir(p.id, 'pieces', x.file)];
  if (req.body.colour) args.push('--colour', req.body.colour);
  else if (head && head !== x) args.push('--ref', projectDir(p.id, 'pieces', head.file));
  const r = await py('repaint.py', args);
  if (!r.ok) throw bad(r.error || 'Repaint failed');
  res.json(withUrls(store.update(p.id, (q) => {
    const y = q.pieces.find((z) => z.file === x.file);
    y.flags = (y.flags || []).filter((f) => f !== 'red_skin'); y.repainted = r; y.v = Date.now();
  })));
}));

app.post('/api/projects/:id/assets/:assetId/autolabel', h(async (req, res) => {
  const p = store.load(req.params.id);
  const a = findAsset(p, req.params.assetId);
  const variant = req.body.variant || 'split';
  const pieces = p.pieces.filter((x) => x.assetId === a.id && x.variant === variant);
  if (!pieces.length) throw bad('No pieces to label');
  const sheet = projectDir(p.id, 'stills', `sheet-${a.id}.jpg`);
  fs.mkdirSync(path.dirname(sheet), { recursive: true });
  await py('sheet.py', [sheet, ...pieces.map((x) => projectDir(p.id, 'pieces', x.file))]);
  const names = variant === 'split' ? P.SPLIT_NAMES.map((n) => `${a.id}_${n}`) : a.pieceNames || [];
  const { system, prompt } = P.labelPrompt({ asset: a, names, pieces });
  const out = await generateJSON({ task: 'label', system, prompt, images: [{ path: sheet, mime: 'image/jpeg' }], names, pieces });
  res.json(withUrls(store.update(p.id, (q) => {
    for (const l of out.labels || []) {
      const x = q.pieces.find((z) => z.file === pieces[l.n - 1]?.file);
      if (!x) continue;
      if (!l.name || l.name === 'skip') { x.use = false; continue; }
      const nm = store.slug(l.name).replace(/-/g, '_');
      x.name = q.pieces.some((z) => z !== x && z.name === nm) ? uniqueName(q, nm) : nm;
      x.use = true;
    }
  })));
}));

// ------------------------------------------------------------------ 5. voice (ElevenLabs)
app.get('/api/voice/quota', h(async (req, res) => res.json(await eleven.quota())));
app.get('/api/voice/voices', h(async (req, res) => res.json(await eleven.voices())));

app.post('/api/projects/:id/voice', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.script) throw bad('Write the script first.');
  const settings = getSettings();
  const text = P.ttsText(p.script);
  const opts = { text, voiceId: req.body.voiceId || config.elevenVoice, modelId: req.body.modelId || config.elevenModel, settings: settings.voice, format: config.elevenFormat };
  const key = eleven.ttsKey(opts);
  const isCached = !!eleven.cached(key);
  if (!req.body.confirm && !isCached) {
    let quota = null;
    try { quota = await eleven.quota(); } catch (e) { quota = { error: e.message }; }
    return res.json({ needsConfirm: true, characters: text.length, quota, text, voiceId: opts.voiceId, modelId: opts.modelId });
  }
  const r = await eleven.tts(opts);
  const mp3 = `vo-${key}.mp3`, al = `vo-${key}.json`;
  fs.copyFileSync(r.mp3, projectDir(p.id, 'vo', mp3));
  fs.copyFileSync(r.alignment, projectDir(p.id, 'vo', al));
  const duration = await probeDuration(projectDir(p.id, 'vo', mp3));
  res.json(withUrls(store.update(p.id, (q) => {
    q.voice = { file: mp3, alignment: al, characters: text.length, duration, key, voiceId: opts.voiceId, modelId: opts.modelId, fromCache: r.fromCache, at: new Date().toISOString() };
    if (q.step === 'assets' || q.step === 'voice') q.step = 'video';
  })));
}));

app.get('/api/projects/:id/words', h(async (req, res) => {
  const p = store.load(req.params.id);
  res.json(p.voice ? wordsFromAlignment(readAlignment(p)) : []);
}));

const readAlignment = (p) => JSON.parse(fs.readFileSync(projectDir(p.id, 'vo', p.voice.alignment), 'utf8'));

// ------------------------------------------------------------------ 6. timeline, preview, stills, render
function library(p) {
  const lib = {};
  for (const x of p.pieces) {
    if (x.use === false || !x.name) continue;
    lib[x.name] = { src: fileUrl(p.id, 'pieces', x.file) + (x.v ? `?v=${x.v}` : ''), w: x.w, h: x.h, kind: x.kind };
  }
  return lib;
}

app.post('/api/projects/:id/timeline/generate', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.script) throw bad('Write the script first.');
  if (!p.voice) throw bad('Generate the narration first: the timeline is cut on its word timestamps.');
  const words = wordsFromAlignment(readAlignment(p));
  const { system, prompt } = P.timelinePrompt({ script: p.script, words, library: library(p), settings: getSettings(), duration: p.voice.duration, notes: req.body.notes || '' });
  const tl = await generateJSON({ task: 'timeline', system, prompt });
  const check = checkTimeline(p, tl);
  res.json({ project: withUrls(store.update(p.id, (q) => { q.timeline = tl; q.timelineCheck = check; })), check });
}));

app.put('/api/projects/:id/timeline', h(async (req, res) => {
  const p = store.load(req.params.id);
  const tl = typeof req.body.timeline === 'string' ? JSON.parse(req.body.timeline) : req.body.timeline;
  const check = checkTimeline(p, tl);
  res.json({ project: withUrls(store.update(p.id, (q) => { q.timeline = tl; q.timelineCheck = check; })), check });
}));

function checkTimeline(p, tl) {
  if (!tl?.scenes?.length) throw bad('The timeline has no scenes.');
  const words = p.voice ? wordsFromAlignment(readAlignment(p)) : [];
  const { timeline, problems } = resolveTimeline(tl, { words, duration: p.voice ? p.voice.duration + 1.5 : null });
  return { problems: [...problems, ...lintTimeline(timeline, library(p))], duration: timeline.duration, scenes: timeline.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end })) };
}

app.get('/api/projects/:id/timeline/resolved', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.timeline) return res.json({ error: 'No timeline yet.' });
  const words = p.voice ? wordsFromAlignment(readAlignment(p)) : [];
  const { timeline, problems } = resolveTimeline(p.timeline, { words, duration: p.voice ? p.voice.duration + 1.5 : null });
  const s = getSettings();
  res.json({
    ...timeline, problems,
    library: library(p),
    palette: { ...(s.style.palette || {}), ...(timeline.palette || {}) },
    brand: { name: s.brand.name, logoSvg: s.brand.showLogo ? s.brand.logoSvg : '' },
    audio: p.voice ? fileUrl(p.id, 'vo', p.voice.file) : null,
  });
}));

app.post('/api/projects/:id/stills', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.timeline) throw bad('No timeline yet.');
  const r = await stills(baseUrl(), p.id, req.body.times);
  res.json({ ...r, files: r.files.map((f) => ({ ...f, url: fileUrl(p.id, 'stills', f.file) + `?v=${Date.now()}` })) });
}));

app.post('/api/projects/:id/render', h(async (req, res) => {
  const p = store.load(req.params.id);
  if (!p.timeline) throw bad('No timeline yet.');
  res.json(startRender(baseUrl(), p.id, { voicePath: p.voice ? projectDir(p.id, 'vo', p.voice.file) : null }));
}));

app.get('/api/projects/:id/render', h(async (req, res) => {
  const st = renderStatus(req.params.id);
  if (st.state === 'done' && st.output) {
    store.update(req.params.id, (p) => {
      p.renders = p.renders || [];
      if (!p.renders.some((r) => r.file === st.output)) p.renders.unshift({ file: st.output, at: new Date().toISOString() });
    });
    st.url = fileUrl(req.params.id, 'renders', st.output);
  }
  res.json(st);
}));

// ------------------------------------------------------------------ errors
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message, raw: err.raw });
});

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
function findAsset(p, id) { const a = p.assets.find((x) => x.id === id); if (!a) throw bad(`Asset "${id}" not found`); return a; }
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || a));
const mimeOf = (f) => (/\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.webp$/i.test(f) ? 'image/webp' : 'image/png');

app.listen(config.port, () => {
  const i = providerInfo();
  console.log(`Cut-Out Studio on http://localhost:${config.port}`);
  console.log(`LLM: ${i.provider} (${i.model}) · Gemini images: ${i.geminiImageReady ? 'on' : 'off (manual upload)'} · ElevenLabs key: ${i.elevenReady ? 'set' : 'not set'}`);
});
