// Cut-Out Studio front end: a five-step wizard over the JSON API.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { status: null, project: null, step: null, stills: null, renderTimer: null };

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
  const res = await fetch(path, init);
  const j = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok || j?.error) throw new Error(j?.error || `${res.status}`);
  return j;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), err ? 7000 : 3000);
}

/** Run an async action with a busy button and error toast. */
async function act(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add('busy'); }
  try { return await fn(); } catch (e) { toast(e.message, true); throw e; } finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}

function confirmBox(title, html, yes = 'Continue') {
  const d = $('#confirm');
  $('#confirmTitle').textContent = title; $('#confirmBody').innerHTML = html; $('#confirmYes').textContent = yes;
  d.showModal();
  return new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'yes'), { once: true }));
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1200); }
}

// ------------------------------------------------------------------ boot, sidebar
async function boot() {
  state.status = await api('/api/status');
  renderStatus();
  await refreshProjects();
  const id = location.hash.slice(1);
  if (id) await openProject(id).catch(() => (location.hash = ''));
}

function renderStatus() {
  const s = state.status;
  const d = (on) => `<span class="dot ${on ? 'on' : 'off'}"></span>`;
  $('#status').innerHTML = `<div>LLM: <b>${esc(s.provider)}</b> · ${esc(s.model)}</div>
    <div>${d(s.geminiImageReady)}Gemini images ${s.geminiImageReady ? 'API on' : 'manual'}</div>
    <div>${d(s.elevenReady)}ElevenLabs key ${s.elevenReady ? 'set' : 'not set'}</div>
    <div>${d(s.cloud?.enabled && !s.cloud?.lastError)}${s.cloud?.enabled ? (s.cloud.lastError ? 'Supabase save failing' : 'Saved to Supabase') : 'Not saved to the cloud (export to keep work)'}</div>`;
}

async function refreshProjects() {
  const list = await api('/api/projects');
  $('#projects').innerHTML = list.map((p) => `<a href="#${esc(p.id)}" data-id="${esc(p.id)}" class="${state.project?.id === p.id ? 'active' : ''}">${esc(p.name)}<small>${esc(p.step)} · ${new Date(p.updatedAt).toLocaleDateString()}</small></a>`).join('');
}

$('#projects').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-id]'); if (!a) return;
  e.preventDefault(); openProject(a.dataset.id);
});

$('#newProject').onclick = async () => {
  const p = await api('/api/projects', { body: { name: 'Untitled video' } });
  await refreshProjects(); await openProject(p.id);
  setTimeout(() => $('#theme')?.focus(), 50);
};

async function openProject(id, step) {
  state.project = await api(`/api/projects/${id}`);
  state.stills = null;
  location.hash = id;
  $('#empty').hidden = true; $('#workspace').hidden = false;
  $('#projectName').value = state.project.name;
  $('#exportProject').href = `/api/projects/${encodeURIComponent(id)}/export`;
  $$('#projects a').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
  go(step || state.project.step || 'ideas');
}

$('#importProject').onclick = () => $('#importFile').click();
$('#importFile').onchange = (e) => act($('#importProject'), async () => {
  const file = e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('file', file);
  const r = await api('/api/projects/import', { body: fd });
  e.target.value = '';
  await refreshProjects(); await openProject(r.project.id);
  toast(`Imported “${r.project.name}”${r.settingsRestored ? ' (brand settings restored too)' : ''}`);
});

$('#projectName').onchange = async (e) => {
  state.project = await api(`/api/projects/${state.project.id}`, { method: 'PATCH', body: { name: e.target.value } });
  refreshProjects();
};
$('#deleteProject').onclick = async () => {
  if (!(await confirmBox('Delete this video?', `<p>“${esc(state.project.name)}” and all its uploads, voice and renders will be deleted.</p>`, 'Delete'))) return;
  await api(`/api/projects/${state.project.id}`, { method: 'DELETE' });
  state.project = null; location.hash = '';
  $('#workspace').hidden = true; $('#empty').hidden = false; refreshProjects();
};

$('#steps').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) go(li.dataset.step); });

const ORDER = ['ideas', 'script', 'assets', 'voice', 'video'];
function go(step) {
  state.step = step;
  const p = state.project;
  const done = { ideas: !!p.idea, script: !!p.script, assets: p.pieces.some((x) => x.use !== false), voice: !!p.voice, video: (p.renders || []).length > 0 };
  $$('#steps li').forEach((li) => { li.classList.toggle('active', li.dataset.step === step); li.classList.toggle('done', !!done[li.dataset.step]); });
  clearInterval(state.renderTimer);
  ({ ideas: ideasPanel, script: scriptPanel, assets: assetsPanel, voice: voicePanel, video: videoPanel })[step]();
}
const setProject = (p) => { state.project = p; refreshProjects(); };
const panel = (html) => { $('#panel').innerHTML = html; return $('#panel'); };
const next = (step, label) => `<div class="toolbar" style="margin-top:8px"><span class="grow"></span><button class="btn primary" data-go="${step}">${label} →</button></div>`;
$('#panel').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

// ------------------------------------------------------------------ 1. ideas
function ideasPanel() {
  const p = state.project;
  const el = panel(`
    <div class="card">
      <h2>What should the videos be about?</h2>
      <p class="hint">A theme, e.g. “curiosity stories about deals and networking”. The ${esc(state.status.provider)} model searches the web, checks the facts and returns story ideas in the story-bank format. Unverified ideas are greyed out.</p>
      <div class="toolbar">
        <input id="theme" class="theme-input grow" style="flex:1;min-width:240px" value="${esc(p.theme)}" placeholder="curiosity stories about deals and networking">
        <label class="row">Ideas <input id="count" type="number" min="3" max="25" value="15" style="width:70px"></label>
        <label class="row"><input id="web" type="checkbox" checked> Fact-check with web search</label>
        <button id="genIdeas" class="btn primary">${p.ideas.length ? 'New ideas' : 'Find ideas'}</button>
        ${p.ideas.length ? '<button id="moreIdeas" class="btn">Add more</button>' : ''}
      </div>
    </div>
    <div class="ideas">${p.ideas.map(ideaCard).join('') || ''}</div>
    ${p.idea ? next('script', 'Continue to the script') : ''}`);
  const gen = (append) => async (e) => act(e.currentTarget, async () => {
    setProject(await api(`/api/projects/${p.id}/ideas`, { body: { theme: $('#theme').value, count: +$('#count').value, webSearch: $('#web').checked, append } }));
    ideasPanel(); toast('Ideas ready');
  });
  $('#genIdeas', el).onclick = gen(false);
  if ($('#moreIdeas', el)) $('#moreIdeas', el).onclick = gen(true);
  $('#theme', el).onkeydown = (e) => { if (e.key === 'Enter') $('#genIdeas').click(); };
  $$('[data-use]', el).forEach((b) => (b.onclick = () => act(b, async () => {
    const idea = p.ideas.find((i) => i.id === b.dataset.use);
    let force = false;
    if (idea.verified === false) {
      if (!(await confirmBox('Use an unverified idea?', `<p>${esc(idea.check || 'Its facts could not be verified.')}</p><p>Check the sources before publishing.</p>`, 'Use anyway'))) return;
      force = true;
    }
    setProject(await api(`/api/projects/${p.id}/idea`, { body: { ideaId: idea.id, force } }));
    $('#projectName').value = state.project.name;
    go('script');
  })));
}

function ideaCard(i) {
  const chosen = state.project.idea?.id === i.id;
  return `<article class="idea ${chosen ? 'chosen' : ''} ${i.verified === false ? 'unverified' : ''}">
    <div class="toolbar"><span class="tag">${esc(i.theme || '')}</span>${i.verified === false ? '<span class="tag err">unverified</span>' : '<span class="tag ok">sourced</span>'}${chosen ? '<span class="tag warn">chosen</span>' : ''}</div>
    <h3>${esc(i.title)}</h3>
    <div><div class="lbl">First 3 seconds</div><div class="hook">${esc(i.hook)}</div></div>
    <div><div class="lbl">Story beats</div><ol>${(i.beats || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ol></div>
    <div><div class="lbl">Cut-out visuals</div>${esc(i.visuals)}</div>
    <div><div class="lbl">Brand moment</div>${esc(i.ukeepMoment)}</div>
    <div class="src"><div class="lbl">Sources</div>${(i.sources || []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label || s.url)}</a>`).join(' · ')}</div>
    ${i.check ? `<div class="check">Check: ${esc(i.check)}</div>` : ''}
    <div class="foot"><button class="btn ${chosen ? '' : 'primary'} small" data-use="${esc(i.id)}">${chosen ? 'Chosen' : 'Use this idea'}</button></div>
  </article>`;
}

// ------------------------------------------------------------------ 2. script
function scriptPanel() {
  const p = state.project;
  if (!p.idea) return panel(`<div class="card"><h2>Pick an idea first</h2>${next('ideas', 'Back to ideas')}</div>`);
  const s = p.script;
  const el = panel(`
    <div class="card">
      <div class="toolbar"><div class="grow"><span class="lbl">Idea</span><h2 style="margin:0">${esc(p.idea.title)}</h2></div></div>
      <p class="hint">${esc(p.idea.hook)}</p>
      <div class="toolbar">
        <input id="notes" class="grow" style="flex:1;min-width:240px" placeholder="Optional notes for the writer (tone, things to include or avoid)">
        <button id="genScript" class="btn primary">${s ? 'Rewrite script' : 'Write script'}</button>
      </div>
    </div>
    ${s ? `
    <div class="card">
      <div class="toolbar"><h3 class="grow">Narration (Eleven v4, one request)</h3>
        <div class="stats"><span><b>${p.scriptStats?.characters ?? '?'}</b> characters</span><span><b>${p.scriptStats?.words ?? '?'}</b> words</span><span>≈ <b>${p.scriptStats?.estSeconds ?? '?'}</b> s</span></div></div>
      ${(p.scriptStats?.warnings || []).length ? `<ul class="warnings">${p.scriptStats.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <label style="margin:10px 0">Hook text on screen (frame 1) <input id="hookText" value="${esc((s.hookText || '').replace(/\n/g, '\\n'))}"></label>
      <div class="lines">${s.lines.map((l, k) => `<div class="line"><span class="n">${k + 1}</span>
        <input class="tagin" data-k="${k}" data-f="tag" value="${esc(l.tag)}" title="Voice direction (audio tag, not spoken)">
        <textarea rows="2" data-k="${k}" data-f="text">${esc(l.text)}</textarea></div>`).join('')}</div>
      <div class="toolbar" style="margin-top:10px">
        <span class="hint" style="margin:0">Punch words: ${(s.punchWords || []).map((w) => `<b>${esc(w.text)}</b> on “${esc(w.cue)}”`).join(', ') || 'none'}</span>
        <span class="grow"></span><button id="saveScript" class="btn">Save changes</button></div>
    </div>
    <div class="card">
      <h3>Scenes</h3>
      <table class="plan"><thead><tr><th>Starts on</th><th>Picture</th><th>Assets</th><th>Background</th></tr></thead><tbody>
      ${(s.scenes || []).map((c) => `<tr><td><b>${esc(c.cue)}</b><br><span class="mono">${esc(c.id)}</span></td><td>${esc(c.picture)}<br><span class="hint">${esc(c.motion || '')}</span></td><td class="mono">${esc((c.assets || []).join(', '))}</td><td class="mono">${esc(c.background)}</td></tr>`).join('')}
      </tbody></table>
      ${s.factNotes ? `<p class="hint" style="margin-top:10px">Facts: ${esc(s.factNotes)}</p>` : ''}
      ${s.caption ? `<p class="hint">Caption: ${esc(s.caption)} ${esc((s.hashtags || []).join(' '))}</p>` : ''}
      <details><summary>Edit everything as JSON</summary>
        <textarea id="scriptJson" class="json" spellcheck="false">${esc(JSON.stringify(s, null, 2))}</textarea>
        <div class="toolbar" style="margin-top:8px"><span class="grow"></span><button id="saveJson" class="btn">Save JSON</button></div>
      </details>
    </div>
    ${next('assets', 'Continue to images')}` : ''}`);

  $('#genScript', el).onclick = (e) => act(e.currentTarget, async () => {
    if (s && !(await confirmBox('Rewrite the script?', '<p>The current script will be replaced. Uploaded images for assets with the same id are kept.</p>', 'Rewrite'))) return;
    setProject(await api(`/api/projects/${p.id}/script`, { body: { notes: $('#notes').value } }));
    scriptPanel(); toast('Script ready');
  });
  if (!s) return;
  $('#saveScript', el).onclick = (e) => act(e.currentTarget, async () => {
    const sc = structuredClone(s);
    sc.hookText = $('#hookText').value.replace(/\\n/g, '\n');
    $$('[data-k]', el).forEach((i) => (sc.lines[+i.dataset.k][i.dataset.f] = i.value));
    setProject(await api(`/api/projects/${p.id}/script`, { method: 'PUT', body: { script: sc } }));
    scriptPanel(); toast('Saved');
  });
  $('#saveJson', el).onclick = (e) => act(e.currentTarget, async () => {
    let sc; try { sc = JSON.parse($('#scriptJson').value); } catch (err) { throw new Error('Invalid JSON: ' + err.message); }
    setProject(await api(`/api/projects/${p.id}/script`, { method: 'PUT', body: { script: sc } }));
    scriptPanel(); toast('Saved');
  });
}

// ------------------------------------------------------------------ 3. images
function assetsPanel() {
  const p = state.project;
  if (!p.script) return panel(`<div class="card"><h2>Write the script first</h2>${next('script', 'Back to the script')}</div>`);
  const gem = state.status.geminiImageReady;
  const el = panel(`
    <div class="card">
      <h2>Images</h2>
      <p class="hint">Copy each prompt into <b>one Gemini chat</b> (so faces and style stay consistent), download the image and drop it on its slot. The app cuts it into transparent pieces and checks it. ${gem ? 'Or press “Generate” to have the Gemini API make it.' : 'To generate them here instead, set GEMINI_API_KEY.'} If a face drifts, re-upload the first image in Gemini and say “Keep this exact character”.</p>
      <div class="stats"><span><b>${p.assets.filter((a) => a.uploads?.length).length}</b> / ${p.assets.length} assets uploaded</span><span><b>${p.pieces.filter((x) => x.use !== false).length}</b> pieces in the library</span></div>
    </div>
    ${p.assets.map(assetCard).join('')}
    ${next('voice', 'Continue to the voice')}`);
  wireAssets(el);
}

function assetCard(a) {
  const p = state.project;
  const pieces = p.pieces.filter((x) => x.assetId === a.id);
  const ups = a.uploads || [];
  const lastFull = [...ups].reverse().find((u) => u.variant === 'full');
  const lastSplit = [...ups].reverse().find((u) => u.variant === 'split');
  const gem = state.status.geminiImageReady;
  const slot = (variant, label, prompt, last) => `
    <div class="prompt"><label>${label}</label><textarea data-prompt="${variant}" data-asset="${esc(a.id)}">${esc(prompt)}</textarea>
      <button class="btn small copy" data-copy>Copy</button></div>
    <div class="toolbar" style="margin-top:6px">
      <div class="drop grow" data-drop="${variant}" data-asset="${esc(a.id)}">Drop the ${variant === 'split' ? 'split pieces' : 'image'} here or click to upload<input type="file" accept="image/*" hidden></div>
      ${gem ? `<button class="btn small" data-gen="${variant}" data-asset="${esc(a.id)}">Generate</button>` : ''}
    </div>
    ${last ? uploadResult(a, last) : ''}`;
  return `<div class="card" id="asset-${esc(a.id)}">
    <div class="asset-head"><h3>${esc(a.id)}</h3><span class="tag">${esc(a.kind)}</span>
      ${a.status === 'ok' ? '<span class="tag ok">ok</span>' : a.status === 'needs-fix' ? '<span class="tag err">needs a fix</span>' : '<span class="tag">waiting</span>'}
      ${a.pieceNames ? `<span class="hint" style="margin:0">pieces: ${esc(a.pieceNames.join(', '))}</span>` : ''}
      <span class="grow"></span>
      ${a.kind === 'character' ? `<label class="row"><input type="checkbox" data-split="${esc(a.id)}" ${a.split ? 'checked' : ''}> Split into body pieces</label>` : ''}
    </div>
    <p class="hint">${esc(a.description)}</p>
    <div class="asset">
      <div>${slot('full', a.kind === 'background' ? 'Gemini prompt (wide 16:9)' : 'Gemini prompt', a.prompt, lastFull)}</div>
      <div>${a.split ? slot('split', 'Then, in the same chat: split prompt', a.splitPrompt, lastSplit) : piecesBlock(a, pieces.filter((x) => x.variant === 'full'))}</div>
    </div>
    ${a.split ? piecesBlock(a, pieces.filter((x) => x.variant === 'full')) + piecesBlock(a, pieces.filter((x) => x.variant === 'split'), 'split') : ''}
  </div>`;
}

function uploadResult(a, u) {
  return `<div class="thumbs"><a href="${esc(u.url)}" target="_blank"><img src="${esc(u.url)}" alt="upload"></a>
    <div style="flex:1;min-width:200px">
      <ul class="checks">${(u.checks || []).map((c) => `<li class="${c.level}">${esc(c.message)}${c.fix ? `<div class="fix"><button class="btn small" data-copytext="${esc(c.fix)}">Copy fix prompt</button></div>` : ''}</li>`).join('') || '<li class="info">No problems found.</li>'}</ul>
      ${a.kind !== 'background' ? `<div class="toolbar"><select data-method><option value="auto">colour distance</option><option value="grey" ${u.method === 'grey' ? 'selected' : ''}>grey range</option></select>
        <label class="row">threshold <input type="number" data-thr value="${u.threshold || 30}" min="5" max="80" style="width:64px"></label>
        ${u.variant === 'split' ? '<label class="row"><input type="checkbox" data-autofix checked> fix red skin</label>' : ''}
        <button class="btn small" data-recut="${esc(a.id)}" data-file="${esc(u.file)}">Re-cut</button></div>` : ''}
    </div></div>`;
}

function piecesBlock(a, pieces, variant = 'full') {
  if (!pieces.length) return variant === 'split' ? '' : '<p class="hint">Pieces appear here after the upload.</p>';
  const canLabel = variant === 'split' || a.kind === 'objects';
  return `<div><div class="toolbar"><span class="lbl grow">Pieces${variant === 'split' ? ' (split)' : ''}: name them as the animator will use them</span>
    ${canLabel ? `<button class="btn small" data-label="${esc(a.id)}" data-variant="${variant}">Label with AI</button>` : ''}</div>
    <div class="pieces">${pieces.map((x) => `<div class="piece ${x.use === false ? 'off' : ''}">
      <div class="img"><img src="${esc(x.url)}${x.v ? `?v=${x.v}` : ''}" alt="${esc(x.name)}" loading="lazy"></div>
      <input type="text" value="${esc(x.name)}" data-rename="${esc(x.file)}" aria-label="piece name">
      <div class="meta"><label class="row" style="font-size:11px"><input type="checkbox" data-use="${esc(x.file)}" ${x.use !== false ? 'checked' : ''}> use</label><span>${x.w}×${x.h}</span></div>
      ${x.flags?.length ? `<div class="flags">${x.flags.map((f) => `<span class="tag ${f === 'red_skin' ? 'warn' : ''}">${esc(f.replace('_', ' '))}</span>`).join('')}</div>` : ''}
      ${x.flags?.includes('red_skin') ? `<button class="btn small" data-repaint="${esc(x.file)}">Fix red skin</button>` : ''}
    </div>`).join('')}</div></div>`;
}

function wireAssets(el) {
  const p = state.project;
  const rerender = (proj) => { setProject(proj); const y = scrollY; assetsPanel(); scrollTo(0, y); };
  $$('[data-copy]', el).forEach((b) => (b.onclick = () => copy(b.previousElementSibling.value, b)));
  $$('[data-copytext]', el).forEach((b) => (b.onclick = () => copy(b.dataset.copytext, b)));
  $$('[data-prompt]', el).forEach((t) => (t.onchange = async () => {
    const body = t.dataset.prompt === 'split' ? { splitPrompt: t.value } : { prompt: t.value };
    setProject(await api(`/api/projects/${p.id}/assets/${t.dataset.asset}`, { method: 'PATCH', body }));
    toast('Prompt saved');
  }));
  $$('[data-split]', el).forEach((c) => (c.onchange = async () => rerender(await api(`/api/projects/${p.id}/assets/${c.dataset.split}`, { method: 'PATCH', body: { split: c.checked } }))));
  $$('[data-drop]', el).forEach((d) => {
    const input = $('input', d);
    const send = (file) => act(null, async () => {
      d.textContent = 'Cutting out…';
      const fd = new FormData(); fd.append('image', file); fd.append('variant', d.dataset.drop);
      rerender(await api(`/api/projects/${p.id}/assets/${d.dataset.asset}/upload`, { body: fd }));
      toast('Cut out and checked');
    }).catch(() => assetsPanel());
    d.onclick = () => input.click();
    input.onchange = () => input.files[0] && send(input.files[0]);
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) send(f); };
  });
  $$('[data-gen]', el).forEach((b) => (b.onclick = () => act(b, async () => {
    const prompt = $(`[data-prompt="${b.dataset.gen}"][data-asset="${b.dataset.asset}"]`, el).value;
    rerender(await api(`/api/projects/${p.id}/assets/${b.dataset.asset}/generate`, { body: { variant: b.dataset.gen, prompt } }));
    toast('Generated, cut out and checked');
  })));
  $$('[data-recut]', el).forEach((b) => (b.onclick = () => act(b, async () => {
    const box = b.closest('.toolbar');
    rerender(await api(`/api/projects/${p.id}/assets/${b.dataset.recut}/recut`, { body: { file: b.dataset.file, method: $('[data-method]', box).value, threshold: +$('[data-thr]', box).value, autoRepaint: $('[data-autofix]', box)?.checked ?? true } }));
  })));
  $$('[data-rename]', el).forEach((i) => (i.onchange = () => act(null, async () => rerender(await api(`/api/projects/${p.id}/pieces/${encodeURIComponent(i.dataset.rename)}`, { method: 'PATCH', body: { name: i.value } }))).catch(() => assetsPanel())));
  $$('[data-use]', el).forEach((c) => (c.onchange = async () => rerender(await api(`/api/projects/${p.id}/pieces/${encodeURIComponent(c.dataset.use)}`, { method: 'PATCH', body: { use: c.checked } }))));
  $$('[data-repaint]', el).forEach((b) => (b.onclick = () => act(b, async () => { rerender(await api(`/api/projects/${p.id}/pieces/${encodeURIComponent(b.dataset.repaint)}/repaint`, { body: {} })); toast('Skin repainted'); })));
  $$('[data-label]', el).forEach((b) => (b.onclick = () => act(b, async () => { rerender(await api(`/api/projects/${p.id}/assets/${b.dataset.label}/autolabel`, { body: { variant: b.dataset.variant } })); toast('Labelled'); })));
}

// ------------------------------------------------------------------ 4. voice
function voicePanel() {
  const p = state.project;
  if (!p.script) return panel(`<div class="card"><h2>Write the script first</h2>${next('script', 'Back to the script')}</div>`);
  const text = p.script.lines.map((l) => `[${l.tag}] ${l.text}`).join('\n\n');
  const el = panel(`
    <div class="card">
      <h2>Voice</h2>
      <p class="hint">The whole script goes to ElevenLabs in one request (consistent tone and pacing), with character timestamps so scenes cut on the spoken words. Audio is cached: the same script never costs credits twice. You confirm the character count before anything is spent.</p>
      <textarea readonly rows="10" class="mono">${esc(text)}</textarea>
      <div class="toolbar" style="margin-top:10px">
        <span class="stats"><span><b>${text.length}</b> characters</span></span>
        <button id="quota" class="btn small">Check my credits</button><span id="quotaOut" class="hint" style="margin:0"></span>
        <span class="grow"></span>
        <label class="row">Voice <input id="voiceId" list="voiceList" value="${esc(p.voice?.voiceId || 'JBFqnCBsd6RMkjVDRZzb')}" style="width:220px" class="mono" title="ElevenLabs voice id (George by default)"></label>
        <datalist id="voiceList"></datalist>
        <button id="genVoice" class="btn primary">${p.voice ? 'Regenerate voice' : 'Generate voice'}</button>
      </div>
    </div>
    ${p.voice ? `<div class="card">
      <div class="toolbar"><h3 class="grow">Narration ${p.voice.demo ? '(demo)' : ''}</h3><span class="stats"><span><b>${p.voice.duration.toFixed(1)}</b> s</span><span>${esc(p.voice.modelId)}</span>${p.voice.fromCache ? '<span>from cache</span>' : ''}</span></div>
      <audio controls src="${esc(p.voice.url)}"></audio>
      <div class="lbl" style="margin-top:10px">Word timestamps</div><div id="words" class="words">loading…</div>
    </div>${next('video', 'Continue to the video')}` : ''}`);
  $('#quota', el).onclick = (e) => act(e.currentTarget, async () => {
    const q = await api('/api/voice/quota');
    $('#quotaOut').textContent = `${q.remaining.toLocaleString()} of ${q.limit.toLocaleString()} characters left (${q.tier})${q.resetsAt ? `, resets ${new Date(q.resetsAt).toLocaleDateString()}` : ''}`;
  });
  $('#genVoice', el).onclick = (e) => act(e.currentTarget, async () => {
    const body = { voiceId: $('#voiceId').value.trim() };
    let r = await api(`/api/projects/${p.id}/voice`, { body });
    if (r.needsConfirm) {
      const q = r.quota && !r.quota.error ? `<p>You have <b>${r.quota.remaining.toLocaleString()}</b> of ${r.quota.limit.toLocaleString()} characters left this month.</p>` : r.quota?.error ? `<p class="hint">Could not read your credits: ${esc(r.quota.error)}</p>` : '';
      if (!(await confirmBox('Spend ElevenLabs credits?', `<p>This uses about <b>${r.characters.toLocaleString()}</b> characters (${esc(r.modelId)}, voice ${esc(r.voiceId)}).</p>${q}`, 'Generate'))) return;
      r = await api(`/api/projects/${p.id}/voice`, { body: { ...body, confirm: true } });
    }
    setProject(r); voicePanel(); toast('Voice ready');
  });
  api('/api/voice/voices').then((vs) => { $('#voiceList').innerHTML = vs.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join(''); }).catch(() => {});
  if (p.voice) api(`/api/projects/${p.id}/words`).then((w) => { $('#words').innerHTML = w.map((x) => `<span><b>${esc(x.text)}</b> ${x.start.toFixed(2)}</span>`).join(''); });
}

// ------------------------------------------------------------------ 5. video
function videoPanel() {
  const p = state.project;
  if (!p.script) return panel(`<div class="card"><h2>Write the script first</h2>${next('script', 'Back to the script')}</div>`);
  const tl = p.timeline;
  const chk = p.timelineCheck;
  const el = panel(`
    <div class="card">
      <h2>Video</h2>
      <p class="hint">The animator turns the script, the word timestamps and your piece library into a timeline (JSON). Preview it live, check ~20 stills, then render the MP4 (1080×1920, 30 fps, narration + synthesized sound effects, no music). <a href="/docs/TIMELINE.md" target="_blank">Timeline format</a></p>
      <div class="toolbar">
        <input id="tlNotes" class="grow" style="flex:1;min-width:240px" placeholder="Optional notes for the animator (e.g. “make scene 3 faster”, “end on the phone”)">
        <button id="genTl" class="btn ${tl ? '' : 'primary'}" ${p.voice ? '' : 'disabled title="Generate the voice first"'}>${tl ? 'Re-animate' : 'Animate'}</button>
      </div>
      ${!p.voice ? '<p class="hint" style="color:var(--warn)">Generate the voice first: scenes are timed on its word timestamps.</p>' : ''}
    </div>
    ${tl ? `
    <div class="video-grid">
      <div class="card tight"><iframe id="preview" class="preview-frame" src="/engine/player.html?project=${encodeURIComponent(p.id)}&v=${Date.now()}" title="Preview"></iframe></div>
      <div>
        <div class="card">
          <div class="toolbar"><h3 class="grow">Render</h3>
            <button id="stillsBtn" class="btn">Check 20 stills</button>
            <button id="renderBtn" class="btn primary">Render MP4</button></div>
          ${renderModeBox()}
          ${chk?.problems?.length ? `<ul class="problems">${chk.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div id="renderBox"></div>
          <div id="stillsBox"></div>
          ${(p.renders || []).length ? `<div class="lbl" style="margin-top:12px">Renders</div>${p.renders.map((r) => `<div><a href="${esc(r.url)}" download>${esc(r.file)}</a></div>`).join('')}` : ''}
        </div>
        <div class="card">
          <details ${chk?.problems?.length ? 'open' : ''}><summary>Timeline JSON (${chk ? `${chk.scenes.length} scenes, ${chk.duration?.toFixed?.(1)} s` : ''})</summary>
            <p class="hint">Times can be <code>"@spoken words"</code>, seconds, or <code>"+0.5"</code> after the scene start.</p>
            <textarea id="tlJson" class="json" spellcheck="false">${esc(JSON.stringify(tl, null, 2))}</textarea>
            <div class="toolbar" style="margin-top:8px"><span class="grow"></span><button id="saveTl" class="btn">Save and refresh preview</button></div>
          </details>
        </div>
      </div>
    </div>` : ''}`);

  $('#genTl', el).onclick = (e) => act(e.currentTarget, async () => {
    if (tl && !(await confirmBox('Re-animate?', '<p>The current timeline will be replaced.</p>', 'Re-animate'))) return;
    const r = await api(`/api/projects/${p.id}/timeline/generate`, { body: { notes: $('#tlNotes').value } });
    setProject(r.project); videoPanel(); toast(r.check.problems.length ? `Timeline ready, with ${r.check.problems.length} warnings` : 'Timeline ready');
  });
  if (!tl) return;
  $('#saveTl', el).onclick = (e) => act(e.currentTarget, async () => {
    let j; try { j = JSON.parse($('#tlJson').value); } catch (err) { throw new Error('Invalid JSON: ' + err.message); }
    const r = await api(`/api/projects/${p.id}/timeline`, { method: 'PUT', body: { timeline: j } });
    setProject(r.project); videoPanel(); toast('Saved');
  });
  $('#stillsBtn', el).onclick = (e) => act(e.currentTarget, async () => {
    const r = await api(`/api/projects/${p.id}/stills`, { body: {} });
    state.stills = r; showStills();
  });
  $('#renderBtn', el).onclick = (e) => act(e.currentTarget, async () => { await api(`/api/projects/${p.id}/render`, { body: {} }); pollRender(); });
  $$('[name=renderMode]', el).forEach((r) => (r.onchange = async () => {
    const s = await api('/api/settings/render-mode', { method: 'PUT', body: { mode: r.value } });
    state.status.settings = s; videoPanel();
    toast(r.value === 'github' ? 'Videos will render on GitHub Actions' : 'Videos will render on this server');
  }));
  if (state.stills) showStills();
  pollRender(true);
}

function renderModeBox() {
  const st = state.status, mode = st.settings?.renderMode || 'instance', g = st.github || { ready: false, missing: [] };
  return `<div class="render-mode">
    <span class="lbl">Render on</span>
    <label class="row"><input type="radio" name="renderMode" value="instance" ${mode !== 'github' ? 'checked' : ''}> This server</label>
    <label class="row"><input type="radio" name="renderMode" value="github" ${mode === 'github' ? 'checked' : ''} ${g.ready ? '' : 'disabled'}> GitHub Actions (free, full quality)</label>
    ${!g.ready ? `<span class="hint" style="margin:0">GitHub rendering needs ${esc(g.missing.join(', '))} (see the README).</span>` : ''}
    ${st.lowMemory && mode !== 'github' ? '<span class="hint" style="margin:0;color:var(--warn)">This server has little memory: stills and renders may fail here. GitHub Actions is safer.</span>' : ''}
  </div>`;
}

function showStills() {
  const r = state.stills, box = $('#stillsBox'); if (!box || !r) return;
  box.innerHTML = `<div class="lbl" style="margin:12px 0 6px">Stills ${r.warnings?.length ? `· <span style="color:var(--warn)">${esc(r.warnings.join('; '))}</span>` : ''}</div>
    <div class="stills">${r.files.map((f) => `<figure><a href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="t=${f.t}"></a>${f.t.toFixed(1)} s</figure>`).join('')}</div>`;
}

function pollRender(quietIfIdle) {
  const p = state.project;
  clearInterval(state.renderTimer);
  const tick = async () => {
    const st = await api(`/api/projects/${p.id}/render`).catch(() => null);
    const box = $('#renderBox'); if (!box || !st) return;
    if (st.state === 'idle') { if (!quietIfIdle) box.innerHTML = ''; clearInterval(state.renderTimer); return; }
    if (st.state === 'running' || st.state === 'queued') {
      const pct = st.frames ? Math.round((st.frame / st.frames) * 100) : 0;
      box.innerHTML = `<p class="hint">${esc(st.message)}${st.frames ? ` · frame ${st.frame} / ${st.frames}` : ''}${st.runUrl ? ` · <a href="${esc(st.runUrl)}" target="_blank" rel="noopener">GitHub run</a>` : ''}</p><div class="progress"><i style="width:${pct}%"></i></div>`;
      $('#renderBtn').disabled = true;
      return;
    }
    clearInterval(state.renderTimer);
    if ($('#renderBtn')) $('#renderBtn').disabled = false;
    if (st.state === 'error') box.innerHTML = `<p style="color:var(--err)">Render failed: ${esc(st.error)}</p>`;
    if (st.state === 'done') {
      box.innerHTML = `<video controls src="${esc(st.url)}" style="max-height:520px;background:#000;border-radius:8px;margin-top:8px"></video><p><a class="btn small" href="${esc(st.url)}" download>Download MP4</a></p>`;
      if (!(state.project.renders || []).some((r) => r.file === st.output)) state.project = await api(`/api/projects/${p.id}`);
    }
  };
  tick(); state.renderTimer = setInterval(tick, 1500);
}

// ------------------------------------------------------------------ settings
const getPath = (o, k) => k.split('.').reduce((a, b) => a?.[b], o);
const setPath = (o, k, v) => { const ks = k.split('.'); const last = ks.pop(); ks.reduce((a, b) => (a[b] ??= {}), o)[last] = v; };

$('#openSettings').onclick = async () => {
  const s = await api('/api/settings');
  const f = $('#settingsForm');
  $$('[name]', f).forEach((i) => {
    const v = getPath(s, i.name);
    if (i.type === 'checkbox') i.checked = !!v;
    else i.value = Array.isArray(v) ? v.join('\n') : v ?? '';
  });
  f._s = s;
  $('#settings').showModal();
};
$('#saveSettings').onclick = async (e) => {
  e.preventDefault();
  const f = $('#settingsForm'), s = structuredClone(f._s);
  $$('[name]', f).forEach((i) => {
    let v = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value;
    if (i.name === 'brand.rules') v = i.value.split('\n').map((x) => x.trim()).filter(Boolean);
    setPath(s, i.name, v);
  });
  await act(e.currentTarget, async () => { await api('/api/settings', { method: 'PUT', body: s }); state.status = await api('/api/status'); });
  $('#settings').close(); toast('Settings saved');
};
$('#resetSettings').onclick = async () => {
  if (!(await confirmBox('Reset settings?', '<p>Brand, style and voice settings go back to the uKeep defaults.</p>', 'Reset'))) return;
  await api('/api/settings/reset', { body: {} }); $('#settings').close(); toast('Settings reset');
};

boot().catch((e) => toast(e.message, true));
