// Turns an authored timeline (times as "@spoken words", seconds, or "+offset") into the
// numbers-only timeline the engine plays, using ElevenLabs character timestamps.

/** ElevenLabs alignment -> spoken words with start/end (audio tags like "[Calm]" removed). */
export function wordsFromAlignment(al) {
  if (!al?.characters) return [];
  const ch = al.characters, st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  const words = [];
  let cur = null, inTag = false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c === '[') { inTag = true; continue; }
    if (c === ']') { inTag = false; continue; }
    if (inTag) continue;
    if (/\s/.test(c)) { if (cur) { words.push(cur); cur = null; } continue; }
    if (!cur) cur = { text: '', start: st[i], end: en[i] };
    cur.text += c; cur.end = en[i];
  }
  if (cur) words.push(cur);
  return words.map((w) => ({ ...w, norm: norm(w.text) })).filter((w) => w.norm);
}

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/** Find the start time of a phrase. "card#2" = second occurrence. Returns null when not found. */
export function findPhrase(words, phrase) {
  let occ = 1;
  const m = String(phrase).match(/^(.*?)#(\d+)$/);
  if (m) { phrase = m[1]; occ = Number(m[2]); }
  const toks = String(phrase).split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return null;
  let seen = 0;
  for (let i = 0; i + toks.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < toks.length; k++) if (words[i + k].norm !== toks[k]) { ok = false; break; }
    if (ok && ++seen === occ) return { start: words[i].start, end: words[i + toks.length - 1].end };
  }
  // fall back: a word that starts with the first token (handles "1980s" vs "1980")
  if (occ === 1) for (const w of words) if (w.norm.startsWith(toks[0]) || toks[0].startsWith(w.norm)) if (w.norm.length > 2) return { start: w.start, end: w.end };
  return null;
}

/**
 * Resolve one time value.
 *  number         absolute seconds
 *  "@words"       when those words start being spoken; "@words+0.3", "@words-0.2", "@words#2"
 *  "@words$end"   when those words finish
 *  "+1.2"         seconds after the scene start
 */
export function resolveTime(v, words, sceneStart, problems, where) {
  if (v == null) return v;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return s.startsWith('+') ? (sceneStart ?? 0) + Number(s.slice(1)) : Number(s);
  const m = s.match(/^@(.+?)(\$end)?\s*([+-]\s*\d+(?:\.\d+)?)?$/);
  if (m) {
    const hit = findPhrase(words, m[1]);
    if (!hit) { problems.push(`${where}: could not find the words "${m[1]}" in the narration`); return sceneStart ?? 0; }
    return +((m[2] ? hit.end : hit.start) + (m[3] ? Number(m[3].replace(/\s/g, '')) : 0)).toFixed(3);
  }
  problems.push(`${where}: unreadable time "${v}"`);
  return sceneStart ?? 0;
}

const TIME_KEYS = new Set(['at', 'start', 'end', 'flyAt', 'noteAt']);
const LOOP_TIME_KEYS = new Set(['from', 'to']); // times only inside loop objects (elsewhere they are ids or values)

/** Deep-resolve every time field. Scene "end" defaults to the next scene's start. */
export function resolveTimeline(tl, { words, duration }) {
  const problems = [];
  const T = structuredClone(tl);
  const scenes = T.scenes || [];
  scenes.forEach((S, i) => { S.start = resolveTime(S.start ?? (i === 0 ? 0 : undefined), words, 0, problems, `scene ${S.id || i} start`); });
  scenes.forEach((S, i) => {
    if (S.start == null) S.start = scenes[i - 1]?.end ?? 0;
    S.end = S.end != null ? resolveTime(S.end, words, S.start, problems, `scene ${S.id || i} end`) : scenes[i + 1]?.start ?? undefined;
  });
  T.duration = typeof T.duration === 'number' ? T.duration : duration || null;
  scenes.forEach((S, i) => {
    if (S.end == null) S.end = scenes[i + 1]?.start ?? T.duration ?? S.start + 5;
    if (S.end <= S.start) problems.push(`scene ${S.id || i}: ends before it starts`);
    const walk = (o, where, inLoop = false) => {
      if (Array.isArray(o)) return o.forEach((x, k) => walk(x, `${where}[${k}]`, inLoop));
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        // numbers are already seconds (or values, like an action's "to: 1.3"); only strings need resolving
        if ((TIME_KEYS.has(k) || (inLoop && LOOP_TIME_KEYS.has(k))) && typeof v === 'string') {
          o[k] = resolveTime(v, words, S.start, problems, `${S.id || i}.${where}.${k}`);
        } else if (k === 'loop' || k === 'loops') {
          walk(v, `${where}.${k}`, true);
        } else if (k === 'times' && Array.isArray(v)) {
          o[k] = v.map((x) => resolveTime(x, words, S.start, problems, `${S.id || i}.${where}.times`));
        } else walk(v, `${where}.${k}`);
      }
    };
    walk(S.camera, 'camera'); walk(S.elements, 'elements'); walk(S.sfx, 'sfx');
  });
  if (!T.duration) T.duration = scenes.length ? scenes[scenes.length - 1].end : 1;
  return { timeline: T, problems };
}

/** Check a timeline against the piece library before rendering. */
export function lintTimeline(T, library) {
  const issues = [];
  for (const S of T.scenes || []) {
    if (S.background?.image && !library[S.background.image]) issues.push(`${S.id}: background image "${S.background.image}" is not uploaded (a drawn background will be used)`);
    for (const e of S.elements || []) {
      if (e.piece && !library[e.piece]) issues.push(`${S.id}: piece "${e.piece}" is missing`);
      if (e.effect === 'burst' && e.piece && !library[e.piece]) issues.push(`${S.id}: burst piece "${e.piece}" is missing (plain paper shapes will be used)`);
      if (e.text && String(e.text).length > 60) issues.push(`${S.id}: on-screen text "${String(e.text).slice(0, 30)}..." is long; keep text minimal`);
    }
  }
  return issues;
}
