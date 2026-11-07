// Runs on GitHub Actions (see .github/workflows/render-video.yml): download the project bundle from the app,
// render it at full quality, report progress, and upload the MP4 back.
// Env: APP_URL, JOB_ID, RENDER_SHARED_SECRET. The MP4 is also left in out/video.mp4 as a fallback artifact.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT } from '../server/config.js';
import { run } from '../server/proc.js';
import { renderVideo } from '../server/render.js';

const APP = (process.env.APP_URL || '').replace(/\/$/, '');
const JOB = process.env.JOB_ID || '';
const SECRET = process.env.RENDER_SHARED_SECRET || '';
if (!APP || !JOB || !SECRET) { console.error('APP_URL, JOB_ID and RENDER_SHARED_SECRET are required'); process.exit(2); }
const H = { 'x-render-secret': SECRET };
const jobUrl = (p) => `${APP}/api/render-jobs/${JOB}/${p}`;

async function post(p, body) {
  const res = await fetch(jobUrl(p), { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text().catch(() => '')}`);
}

const work = path.join(ROOT, 'out');
const bundle = path.join(work, 'bundle');
const outFile = path.join(work, 'video.mp4');

try {
  fs.mkdirSync(bundle, { recursive: true });
  console.log('Downloading the project bundle');
  const res = await fetch(jobUrl('bundle'), { headers: H });
  if (!res.ok) throw new Error(`bundle download: ${res.status} ${await res.text().catch(() => '')}`);
  fs.writeFileSync(path.join(work, 'bundle.tgz'), Buffer.from(await res.arrayBuffer()));
  await run('tar', ['-xzf', path.join(work, 'bundle.tgz'), '-C', bundle]);

  // a tiny local server for the player, the engine and the bundle
  const app = express();
  app.use('/engine', express.static(path.join(ROOT, 'engine')));
  app.get('/vendor/gsap.min.js', (req, r) => r.sendFile(path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js')));
  app.use('/bundle', express.static(bundle));
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;

  let last = 0;
  const voice = path.join(bundle, 'voice.mp3');
  await renderVideo({
    url: `http://127.0.0.1:${port}/engine/player.html?timeline=/bundle/timeline.json&mode=render`,
    voicePath: fs.existsSync(voice) ? voice : null,
    outFile,
    onProgress: (p) => {
      if (Date.now() - last < 3000 && p.frame !== p.frames) return;
      last = Date.now();
      if (p.frames && (p.frame % 150 === 0 || p.frame === p.frames)) console.log(`${p.message} ${p.frame}/${p.frames}`);
      post('progress', p).catch((e) => console.warn('progress:', e.message));
    },
  });
  server.close();

  console.log(`Uploading ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB`);
  const up = await fetch(jobUrl('result'), { method: 'POST', headers: { ...H, 'content-type': 'video/mp4' }, body: fs.readFileSync(outFile) });
  if (!up.ok) throw new Error(`upload: ${up.status} ${await up.text().catch(() => '')}`);
  console.log('Done: the video is in the app.');
  process.exit(0);
} catch (e) {
  console.error('Render failed:', e.message);
  await post('fail', { message: e.message.slice(0, 500) }).catch(() => {});
  process.exit(1);
}
