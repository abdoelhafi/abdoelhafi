// Stills for checking, and the full MP4 render: Playwright seeks the engine page frame by frame,
// frames are piped into ffmpeg, then synthesized SFX are mixed with the narration.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { config } from './config.js';
import { projectDir } from './store.js';
import { py, ffmpeg } from './proc.js';

const FPS = 30;
const jobs = new Map(); // projectId -> job

async function openPlayer(baseUrl, id) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${baseUrl}/engine/player.html?project=${encodeURIComponent(id)}&mode=render`);
  await page.waitForFunction(() => window.cutoutReady === true, null, { timeout: 60000 }).catch(() => {
    throw new Error(`The player did not load${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  });
  const meta = await page.evaluate(() => window.cutout);
  return { browser, page, meta, errors };
}

/** Screenshot the given times (seconds). Returns file names in the project's stills/ folder. */
export async function stills(baseUrl, id, times) {
  const { browser, page, meta, errors } = await openPlayer(baseUrl, id);
  try {
    const dir = projectDir(id, 'stills');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    if (!times?.length) times = defaultStillTimes(meta.duration);
    const files = [];
    for (const t of times) {
      await page.evaluate((t) => window.seek(t), Math.min(t, meta.duration - 0.01));
      const f = `t${t.toFixed(2)}.jpg`;
      await page.screenshot({ path: path.join(dir, f), type: 'jpeg', quality: 80 });
      files.push({ t, file: f });
    }
    return { files, warnings: meta.warnings, errors, duration: meta.duration };
  } finally { await browser.close(); }
}

function defaultStillTimes(d) {
  const n = 20, out = [];
  for (let i = 0; i < n; i++) out.push(+((d * (i + 0.5)) / n).toFixed(2));
  return out;
}

export function renderStatus(id) {
  const j = jobs.get(id);
  return j ? { state: j.state, frame: j.frame, frames: j.frames, message: j.message, output: j.output, error: j.error, startedAt: j.startedAt } : { state: 'idle' };
}

/** Start a full render in the background. */
export function startRender(baseUrl, id, { voicePath }) {
  const cur = jobs.get(id);
  if (cur && cur.state === 'running') throw new Error('A render is already running for this project.');
  const job = { state: 'running', frame: 0, frames: 0, message: 'Opening the player', startedAt: new Date().toISOString() };
  jobs.set(id, job);
  (async () => {
    let browser;
    try {
      const out = projectDir(id, 'renders');
      fs.mkdirSync(out, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const silent = path.join(out, `.video-${stamp}.mp4`);
      const p = await openPlayer(baseUrl, id);
      browser = p.browser;
      const { page, meta } = p;
      const n = Math.round(meta.duration * FPS);
      job.frames = n; job.message = 'Rendering frames';

      // frames -> ffmpeg via stdin (no frames on disk)
      const enc = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', silent]);
      let encErr = '';
      enc.stderr.on('data', (d) => (encErr += d));
      const encDone = new Promise((res, rej) => enc.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg: ' + encErr.slice(-800))))));
      for (let f = 0; f < n; f++) {
        await page.evaluate((t) => window.seek(t), f / FPS);
        const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
        if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
        job.frame = f + 1;
      }
      enc.stdin.end();
      await encDone;
      await browser.close(); browser = null;

      job.message = 'Synthesizing sound effects';
      const ev = path.join(out, `.sfx-${stamp}.json`), sfx = path.join(out, `.sfx-${stamp}.wav`);
      fs.writeFileSync(ev, JSON.stringify(meta.sfxEvents));
      await py('sfx.py', [ev, meta.duration, sfx]);

      job.message = 'Mixing and encoding';
      const mix = path.join(out, `.mix-${stamp}.wav`);
      const D = meta.duration.toFixed(2);
      if (voicePath && fs.existsSync(voicePath)) {
        await ffmpeg(['-i', voicePath, '-i', sfx, '-filter_complex',
          `[0:a]aresample=48000,apad=whole_dur=${D}[v];[1:a]volume=0.55[s];[v][s]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
          '-map', '[a]', '-t', D, '-ar', '48000', mix]);
      } else {
        await ffmpeg(['-i', sfx, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-t', D, '-ar', '48000', mix]);
      }
      const final = path.join(out, `video-${stamp}.mp4`);
      await ffmpeg(['-i', silent, '-i', mix, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', final]);
      for (const f of [silent, ev, sfx, mix]) fs.rmSync(f, { force: true });
      job.output = path.basename(final);
      job.state = 'done'; job.message = 'Done';
    } catch (e) {
      job.state = 'error'; job.error = e.message; job.message = 'Failed';
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  })();
  return renderStatus(id);
}
