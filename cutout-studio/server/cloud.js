// Optional cloud save to Supabase Storage, so projects survive hosts that wipe their disk on restart
// (Render's free plan). Enabled by SUPABASE_URL + SUPABASE_SECRET_KEY (the sb_secret_... key; the legacy
// service_role key also works). Layout in the private bucket:
//   projects/<id>/project.json, projects/<id>/{uploads,pieces,vo,renders}/<file>, settings.json
// Every save of a project is mirrored a few seconds later; on startup, projects missing locally are restored.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const env = (k) => (process.env[k] || '').trim();
const URL_ = () => env('SUPABASE_URL').replace(/\/$/, '');
const KEY = () => env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_KEY');
const BUCKET = () => env('SUPABASE_BUCKET') || 'cutout-studio';
const FOLDERS = ['uploads', 'pieces', 'vo', 'renders'];
const PROJECTS = path.join(DATA_DIR, 'projects');

export const cloudEnabled = () => !!(URL_() && KEY());
const state = { lastSync: null, lastError: null, restored: 0, pending: new Map() };
export const cloudStatus = () => ({ enabled: cloudEnabled(), bucket: BUCKET(), lastSync: state.lastSync, lastError: state.lastError, restored: state.restored });

async function sb(p, init = {}) {
  const headers = { apikey: KEY(), ...(init.headers || {}) };
  // legacy JWT keys also need the Authorization header; the new sb_secret_ keys go in apikey only
  if (KEY().startsWith('ey')) headers.authorization = `Bearer ${KEY()}`;
  const res = await fetch(`${URL_()}/storage/v1${p}`, { ...init, headers });
  if (!res.ok && !(init.okStatus || []).includes(res.status)) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
  }
  return res;
}
const objPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function ensureBucket() {
  await sb('/bucket', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET(), name: BUCKET(), public: false }),
    okStatus: [400, 409], // already exists
  });
}

async function put(key, file, type = 'application/octet-stream') {
  const body = fs.readFileSync(file);
  await sb(`/object/${BUCKET()}/${objPath(key)}`, { method: 'POST', headers: { 'content-type': type, 'x-upsert': 'true' }, body });
}

async function list(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await (await sb(`/object/list/${BUCKET()}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    })).json();
    out.push(...r);
    if (r.length < 1000) return out;
  }
}

async function remove(keys) {
  for (let i = 0; i < keys.length; i += 500) {
    await sb(`/object/${BUCKET()}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: keys.slice(i, i + 500) }) });
  }
}

async function get(key, dest) {
  const res = await sb(`/object/${BUCKET()}/${objPath(key)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

const mime = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.json': 'application/json' }[path.extname(f).toLowerCase()] || 'application/octet-stream');

// ------------------------------------------------------------------ sync one project (local -> cloud)
async function syncProject(id) {
  const dir = path.join(PROJECTS, id);
  if (!fs.existsSync(path.join(dir, 'project.json'))) return;
  const prefix = `projects/${id}`;
  for (const folder of FOLDERS) {
    const local = fs.existsSync(path.join(dir, folder))
      ? fs.readdirSync(path.join(dir, folder)).filter((f) => !f.startsWith('.') && fs.statSync(path.join(dir, folder, f)).isFile()) : [];
    // keep only the newest render in the cloud: renders are big and the free plan has 1 GB
    const wanted = folder === 'renders' ? local.sort().slice(-1) : local;
    const remote = await list(`${prefix}/${folder}/`);
    const have = new Map(remote.filter((o) => o.id).map((o) => [o.name, o.metadata?.size]));
    for (const f of wanted) {
      const size = fs.statSync(path.join(dir, folder, f)).size;
      if (size > 50 * 1024 * 1024) continue; // free plan limit per file
      if (have.get(f) === size) continue; // already there (pieces are immutable; names change on re-cut)
      await put(`${prefix}/${folder}/${f}`, path.join(dir, folder, f), mime(f));
    }
    const extra = [...have.keys()].filter((f) => !wanted.includes(f)).map((f) => `${prefix}/${folder}/${f}`);
    if (extra.length) await remove(extra);
  }
  await put(`${prefix}/project.json`, path.join(dir, 'project.json'), 'application/json');
}

/** Called after every project save; mirrors the project a few seconds later (changes are batched). */
export function scheduleSync(id) {
  if (!cloudEnabled()) return;
  clearTimeout(state.pending.get(id));
  state.pending.set(id, setTimeout(() => {
    state.pending.delete(id);
    syncProject(id).then(() => { state.lastSync = new Date().toISOString(); state.lastError = null; })
      .catch((e) => { state.lastError = e.message; console.error('cloud sync:', e.message); });
  }, 3000));
}

export async function deleteProject(id) {
  if (!cloudEnabled()) return;
  try {
    const keys = [`projects/${id}/project.json`];
    for (const folder of FOLDERS) keys.push(...(await list(`projects/${id}/${folder}/`)).filter((o) => o.id).map((o) => `projects/${id}/${folder}/${o.name}`));
    await remove(keys);
  } catch (e) { state.lastError = e.message; console.error('cloud delete:', e.message); }
}

export async function saveSettingsFile(file) {
  if (!cloudEnabled() || !fs.existsSync(file)) return;
  await put('settings.json', file, 'application/json').catch((e) => { state.lastError = e.message; });
}

/** On startup: create the bucket, then download projects (and settings) that are missing locally. */
export async function restoreAll() {
  if (!cloudEnabled()) return;
  try {
    await ensureBucket();
    const settings = path.join(DATA_DIR, 'settings.json');
    if (!fs.existsSync(settings)) await get('settings.json', settings).catch(() => {});
    const ids = (await list('projects/')).filter((o) => !o.id).map((o) => o.name); // folders have no id
    for (const id of ids) {
      if (!/^[a-z0-9-]+$/i.test(id) || fs.existsSync(path.join(PROJECTS, id, 'project.json'))) continue;
      const dir = path.join(PROJECTS, id);
      try {
        for (const folder of FOLDERS) {
          fs.mkdirSync(path.join(dir, folder), { recursive: true });
          for (const o of (await list(`projects/${id}/${folder}/`)).filter((x) => x.id)) {
            if (o.name.includes('/') || o.name.startsWith('.')) continue;
            await get(`projects/${id}/${folder}/${o.name}`, path.join(dir, folder, o.name));
          }
        }
        fs.mkdirSync(path.join(dir, 'stills'), { recursive: true });
        await get(`projects/${id}/project.json`, path.join(dir, 'project.json')); // last: marks the restore complete
        state.restored++;
      } catch (e) {
        console.error(`cloud restore ${id}:`, e.message);
        fs.rmSync(path.join(dir, 'project.json'), { force: true });
      }
    }
    // push local projects the cloud doesn't have yet (e.g. the demo, or work from before cloud save was on)
    for (const id of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) if (!ids.includes(id)) scheduleSync(id);
    state.lastSync = new Date().toISOString();
    if (state.restored) console.log(`Restored ${state.restored} project(s) from Supabase`);
  } catch (e) {
    state.lastError = e.message;
    console.error('cloud restore:', e.message);
  }
}
