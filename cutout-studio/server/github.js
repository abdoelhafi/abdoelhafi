// Render on GitHub Actions: the app packs the project (timeline, pieces, voice) into a bundle, starts the
// "render-video" workflow, and the runner downloads the bundle, renders at full quality on a 16 GB machine,
// reports progress and uploads the MP4 back. Every runner call carries the shared secret
// (RENDER_SHARED_SECRET, also stored as a GitHub Actions secret), so public Actions logs reveal nothing usable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { projectDir } from './store.js';
import { run } from './proc.js';
import { setJob, isBusy, renderStatus, stamp } from './render.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
export const gh = {
  token: () => env('GITHUB_TOKEN'),
  repo: () => env('GITHUB_REPO', 'abdoelhafi/abdoelhafi'),
  workflow: () => env('GITHUB_WORKFLOW', 'render-video.yml'),
  ref: () => env('GITHUB_REF'), // branch that holds the workflow file; default: the repo's default branch
  appRef: () => env('GITHUB_APP_REF', 'ccr-18ed63bb-3wocck'), // branch with the app code the runner uses
  publicUrl: () => env('PUBLIC_URL') || env('RENDER_EXTERNAL_URL'), // Render sets RENDER_EXTERNAL_URL itself
  secret: () => env('RENDER_SHARED_SECRET'),
};

export function githubStatus() {
  const missing = [];
  const dry = process.env.GITHUB_DRY_RUN === '1'; // tests: pack the job but don't call GitHub
  if (!gh.token() && !dry) missing.push('GITHUB_TOKEN');
  if (!gh.secret()) missing.push('RENDER_SHARED_SECRET');
  if (!gh.publicUrl()) missing.push('PUBLIC_URL');
  return { ready: missing.length === 0, missing, repo: gh.repo(), workflow: gh.workflow() };
}

const JOBS_DIR = path.join(DATA_DIR, 'render-jobs');
const byJobId = new Map(); // jobId -> { projectId, job }

async function api(p, init = {}) {
  const res = await fetch(`https://api.github.com${p}`, {
    ...init,
    headers: { authorization: `Bearer ${gh.token()}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).message || msg; } catch { /* keep status */ }
    const hint = res.status === 404 ? ' (is the workflow file on the repository\'s default branch, and does the token have access to the repository?)'
      : res.status === 401 || res.status === 403 ? ' (check GITHUB_TOKEN: it needs "Actions: read and write" on the repository)' : '';
    throw new Error(`GitHub: ${msg}${hint}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Pack the project and start the workflow. `resolved` is the timeline the player would get (with library srcs). */
export async function startGithubRender(projectId, resolved, voicePath) {
  const st = githubStatus();
  if (!st.ready) throw new Error(`GitHub rendering is not set up: missing ${st.missing.join(', ')}.`);
  if (isBusy(projectId)) throw new Error('A render is already running for this project.');
  const jobId = crypto.randomBytes(12).toString('hex');
  const job = setJob(projectId, { mode: 'github', jobId, state: 'queued', frame: 0, frames: 0, message: 'Packing the project', startedAt: new Date().toISOString(), lastSeen: Date.now() });
  byJobId.set(jobId, { projectId, job });
  try {
    // bundle: timeline.json + pieces/ + voice.mp3
    const dir = path.join(JOBS_DIR, jobId, 'bundle');
    fs.mkdirSync(path.join(dir, 'pieces'), { recursive: true });
    const T = structuredClone(resolved);
    for (const [name, L] of Object.entries(T.library || {})) {
      const m = String(L.src).match(/\/files\/pieces\/([^?]+)/);
      if (!m) continue;
      const file = decodeURIComponent(m[1]);
      fs.copyFileSync(projectDir(projectId, 'pieces', file), path.join(dir, 'pieces', file));
      T.library[name] = { ...L, src: `/bundle/pieces/${encodeURIComponent(file)}` };
    }
    T.audio = null;
    if (voicePath && fs.existsSync(voicePath)) fs.copyFileSync(voicePath, path.join(dir, 'voice.mp3'));
    fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(T));
    await run('tar', ['-czf', path.join(JOBS_DIR, jobId, 'bundle.tgz'), '-C', dir, '.']);
    fs.rmSync(dir, { recursive: true, force: true });

    job.message = 'Starting the GitHub workflow';
    if (process.env.GITHUB_DRY_RUN === '1') {
      console.log(`[dry run] would start ${gh.workflow()} with app_url=${gh.publicUrl()} job_id=${jobId}`);
      job.message = 'Waiting for a GitHub runner (dry run)';
      watchdog(jobId);
      return renderStatus(projectId);
    }
    const ref = gh.ref() || (await api(`/repos/${gh.repo()}`)).default_branch;
    const since = Date.now() - 5000;
    await api(`/repos/${gh.repo()}/actions/workflows/${encodeURIComponent(gh.workflow())}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref, inputs: { app_url: gh.publicUrl().replace(/\/$/, ''), job_id: jobId, app_ref: gh.appRef() } }),
    });
    job.message = 'Waiting for a GitHub runner';
    findRunUrl(job, since).catch(() => {});
    watchdog(jobId);
  } catch (e) {
    job.state = 'error'; job.error = e.message; job.message = 'Failed';
  }
  return renderStatus(projectId);
}

// best effort: link to the Actions run so the user can follow it
async function findRunUrl(job, since) {
  for (let i = 0; i < 10 && !job.runUrl && job.state === 'queued'; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const r = await api(`/repos/${gh.repo()}/actions/workflows/${encodeURIComponent(gh.workflow())}/runs?event=workflow_dispatch&per_page=5`);
    const run = (r.workflow_runs || []).find((x) => Date.parse(x.created_at) >= since);
    if (run) job.runUrl = run.html_url;
  }
}

// fail the job if the runner goes silent (no progress for 25 minutes)
function watchdog(jobId) {
  const t = setInterval(() => {
    const e = byJobId.get(jobId);
    if (!e || !['queued', 'running'].includes(e.job.state)) return clearInterval(t);
    if (Date.now() - e.job.lastSeen > 25 * 60 * 1000) {
      Object.assign(e.job, { state: 'error', error: 'No news from the GitHub runner for 25 minutes. Check the Actions run.', message: 'Failed' });
      clearInterval(t);
    }
  }, 60000);
  t.unref();
}

// ------------------------------------------------------------------ endpoints the runner calls
export function checkSecret(req) {
  const want = gh.secret(), got = String(req.headers['x-render-secret'] || '');
  return !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function entry(jobId) {
  const e = byJobId.get(jobId);
  if (!e) { const err = new Error('Unknown or expired render job (the app may have restarted).'); err.status = 404; throw err; }
  e.job.lastSeen = Date.now();
  return e;
}

export function bundlePath(jobId) {
  entry(jobId);
  return path.join(JOBS_DIR, jobId, 'bundle.tgz');
}

export function progress(jobId, { frame, frames, message }) {
  const { job } = entry(jobId);
  if (['done', 'error'].includes(job.state)) return;
  Object.assign(job, { state: 'running', frame: Number(frame) || 0, frames: Number(frames) || 0, message: `GitHub: ${message || 'rendering'}` });
}

export async function receiveResult(jobId, req) {
  const { projectId, job } = entry(jobId);
  const file = `video-${stamp()}.mp4`;
  const dest = projectDir(projectId, 'renders', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await new Promise((res, rej) => { const w = fs.createWriteStream(dest); req.pipe(w); w.on('finish', res); w.on('error', rej); req.on('error', rej); });
  if (fs.statSync(dest).size < 10000) { fs.rmSync(dest, { force: true }); throw Object.assign(new Error('The uploaded video is empty.'), { status: 400 }); }
  Object.assign(job, { state: 'done', output: file, message: 'Done (rendered on GitHub)' });
  fs.rmSync(path.join(JOBS_DIR, jobId), { recursive: true, force: true });
  return { ok: true, file };
}

export function fail(jobId, message) {
  const { job } = entry(jobId);
  Object.assign(job, { state: 'error', error: `GitHub runner: ${message || 'failed'}`, message: 'Failed' });
  fs.rmSync(path.join(JOBS_DIR, jobId), { recursive: true, force: true });
}
