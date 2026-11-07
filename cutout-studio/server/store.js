// Projects live on disk: data/projects/<id>/project.json plus uploads, pieces, vo, renders.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { scheduleSync, deleteProject } from './cloud.js';

const PROJECTS = path.join(DATA_DIR, 'projects');
fs.mkdirSync(PROJECTS, { recursive: true });

export const projectDir = (id, ...p) => {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('bad project id');
  return path.join(PROJECTS, id, ...p);
};

export function listProjects() {
  return fs.readdirSync(PROJECTS)
    .filter((d) => fs.existsSync(path.join(PROJECTS, d, 'project.json')))
    .map((d) => {
      const p = load(d);
      return { id: p.id, name: p.name, theme: p.theme, updatedAt: p.updatedAt, step: p.step };
    })
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function create({ name, theme }) {
  const id = `${slug(name || theme || 'video')}-${crypto.randomBytes(3).toString('hex')}`;
  const p = {
    id, name: name || theme || 'Untitled video', theme: theme || '', step: 'ideas',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ideas: [], idea: null, script: null, assets: [], pieces: [], voice: null, timeline: null, renders: [],
  };
  for (const d of ['uploads', 'pieces', 'vo', 'renders', 'stills']) fs.mkdirSync(projectDir(id, d), { recursive: true });
  save(p);
  return p;
}

export function load(id) {
  const f = projectDir(id, 'project.json');
  if (!fs.existsSync(f)) { const e = new Error('project not found'); e.status = 404; throw e; }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function save(p) {
  p.updatedAt = new Date().toISOString();
  const f = projectDir(p.id, 'project.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(p, null, 2));
  fs.renameSync(f + '.tmp', f);
  scheduleSync(p.id); // mirror to Supabase when cloud save is on
  return p;
}

export function update(id, fn) {
  const p = load(id);
  const r = fn(p);
  return save(r || p);
}

export function remove(id) {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
  deleteProject(id);
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}
