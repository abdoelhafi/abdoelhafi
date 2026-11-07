// Creates the "Rolodex (demo)" project from examples/rolodex: script, cut pieces, narration + timestamps, timeline.
// Lets you preview and render a full video without spending any API credits.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import * as store from '../server/store.js';
import { getSettings } from '../server/settings.js';
import { imagePrompts } from '../server/prompts.js';
import { probeDuration } from '../server/proc.js';

const EX = path.join(ROOT, 'examples/rolodex');
const read = (p) => JSON.parse(fs.readFileSync(path.join(EX, p), 'utf8'));
const settings = getSettings();
const script = read('script.json');
const seeds = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/seed-ideas.json'), 'utf8'));

const p = store.create({ name: 'Rolodex (demo)', theme: 'curiosity stories about deals and networking' });
p.ideas = seeds;
p.idea = seeds.find((i) => i.id === 'rolodex') || seeds[0];
p.script = script;

// which asset each demo piece came from
const owner = {};
for (const a of script.assets) for (const n of a.pieceNames || [a.id]) owner[n] = a.id;
owner.hand_l = 'hand_l'; owner.hand_r = 'hand_r';

p.assets = script.assets.map((a) => ({ ...a, ...imagePrompts(a, settings), uploads: [], status: 'ok' }));
const { default: sizeOf } = await import('./image-size.js');
for (const f of fs.readdirSync(path.join(EX, 'pieces'))) {
  const name = path.parse(f).name;
  fs.copyFileSync(path.join(EX, 'pieces', f), store.projectDir(p.id, 'pieces', f));
  const { w, h } = sizeOf(path.join(EX, 'pieces', f));
  const a = p.assets.find((x) => x.id === owner[name]);
  p.pieces.push({ file: f, name, assetId: owner[name] || name, variant: 'full', w, h, flags: [], kind: a?.kind || 'object', use: true });
}

fs.copyFileSync(path.join(EX, 'vo/narration.mp3'), store.projectDir(p.id, 'vo', 'narration.mp3'));
fs.copyFileSync(path.join(EX, 'vo/alignment.json'), store.projectDir(p.id, 'vo', 'alignment.json'));
const duration = await probeDuration(store.projectDir(p.id, 'vo', 'narration.mp3'));
p.voice = { file: 'narration.mp3', alignment: 'alignment.json', characters: 1025, duration, voiceId: 'JBFqnCBsd6RMkjVDRZzb', modelId: 'eleven_v4', demo: true };
p.timeline = read('timeline.json');
p.step = 'video';
store.save(p);
console.log(`Created demo project "${p.name}" (${p.id}). Start the app with: npm start`);
