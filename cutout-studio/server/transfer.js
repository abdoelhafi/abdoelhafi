// Export a project as one .cutout.tgz file (project.json, uploads, pieces, voice, optionally renders, plus the
// brand/style settings), and import it back. Free hosts wipe their disk on restart: this is how work survives.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { projectDir, load, save, slug } from './store.js';
import { getSettings, saveSettings } from './settings.js';
import { run } from './proc.js';

const PROJECTS = path.join(DATA_DIR, 'projects');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

/** Stream a .tgz of the project to `res`. */
export function exportProject(id, res, { renders = false } = {}) {
  const p = load(id);
  fs.writeFileSync(projectDir(id, '_settings.json'), JSON.stringify(getSettings(), null, 2));
  const args = ['-czf', '-', '-C', PROJECTS,
    '--exclude', `${id}/stills`, '--exclude', `${id}/pieces/.tmp-*`, '--exclude', `${id}/renders/.*`];
  if (!renders) args.push('--exclude', `${id}/renders/*`);
  args.push(id);
  res.setHeader('content-type', 'application/gzip');
  res.setHeader('content-disposition', `attachment; filename="${slug(p.name)}.cutout.tgz"`);
  const tar = spawn('tar', args);
  tar.stdout.pipe(res);
  let err = '';
  tar.stderr.on('data', (d) => (err += d));
  tar.on('close', (code) => { if (code !== 0) { console.error('export failed:', err); res.destroy(); } });
}

/** Import an uploaded .cutout.tgz. Returns the (possibly renamed) project. */
export async function importProject(file) {
  const tmp = path.join(DATA_DIR, 'tmp', `import-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // GNU tar refuses absolute paths and ".." members; we also reject links below.
    await run('tar', ['-xzf', file, '-C', tmp, '--no-same-owner', '--no-same-permissions']);
    const tops = fs.readdirSync(tmp).filter((d) => fs.existsSync(path.join(tmp, d, 'project.json')));
    if (tops.length !== 1) throw Object.assign(new Error('This is not a Cut-Out Studio export (no project.json found).'), { status: 400 });
    const src = path.join(tmp, tops[0]);
    if (hasLinks(src)) throw Object.assign(new Error('The export contains links, which are not allowed.'), { status: 400 });
    const p = JSON.parse(fs.readFileSync(path.join(src, 'project.json'), 'utf8'));
    if (!p.id || !Array.isArray(p.pieces)) throw Object.assign(new Error('The project file is incomplete.'), { status: 400 });

    // keep the id if it is free, otherwise import as a copy
    let id = tops[0].replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'imported';
    if (fs.existsSync(path.join(PROJECTS, id))) { id = `${slug(p.name || 'video')}-${crypto.randomBytes(3).toString('hex')}`; p.name = `${p.name} (imported)`; }
    p.id = id;
    for (const d of ['uploads', 'pieces', 'vo', 'renders', 'stills']) fs.mkdirSync(path.join(src, d), { recursive: true });

    // brand settings travel with the project: restore them only if this server has none yet
    const st = path.join(src, '_settings.json');
    let settingsRestored = false;
    if (fs.existsSync(st)) {
      if (!fs.existsSync(SETTINGS_FILE)) { saveSettings(JSON.parse(fs.readFileSync(st, 'utf8'))); settingsRestored = true; }
      fs.rmSync(st, { force: true });
    }
    fs.mkdirSync(PROJECTS, { recursive: true });
    fs.renameSync(src, path.join(PROJECTS, id));
    fs.writeFileSync(path.join(PROJECTS, id, 'project.json'), JSON.stringify(p, null, 2));
    return { project: save(load(id)), settingsRestored };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
  }
}

function hasLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) return true;
    if (e.isDirectory() && hasLinks(path.join(dir, e.name))) return true;
  }
  return false;
}
