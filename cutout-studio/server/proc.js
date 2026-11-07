// Run python / ffmpeg as child processes.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config, ROOT } from './config.js';

export function run(cmd, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: cwd || ROOT });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`${cmd} could not start: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-1500)}`))));
    if (input) { p.stdin.write(input); p.stdin.end(); }
  });
}

export async function py(script, args) {
  const out = await run(config.python, [path.join(ROOT, 'py', script), ...args.map(String)]);
  try { return JSON.parse(out.trim().split('\n').pop()); } catch { return { raw: out }; }
}

export const ffmpeg = (args) => run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

export async function probeDuration(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(out.trim());
}
