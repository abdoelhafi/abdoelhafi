// ElevenLabs: one request for the whole script, with character timestamps. Cached so credits are never spent twice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, DATA_DIR } from './config.js';

const API = 'https://api.elevenlabs.io';
const CACHE = path.join(DATA_DIR, 'cache', 'tts');
fs.mkdirSync(CACHE, { recursive: true });

function headers() {
  // In some hosted setups a proxy injects the key; a placeholder keeps the header present.
  return { 'xi-api-key': config.elevenKey || 'set-ELEVENLABS_API_KEY', 'content-type': 'application/json' };
}

async function call(p, init = {}) {
  const res = await fetch(API + p, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.detail?.message || j.detail?.status || JSON.stringify(j.detail || j); } catch { /* keep status */ }
    const e = new Error(`ElevenLabs: ${msg}`); e.status = res.status; throw e;
  }
  return res;
}

export async function quota() {
  const s = await (await call('/v1/user/subscription')).json();
  return {
    tier: s.tier, used: s.character_count, limit: s.character_limit,
    remaining: s.character_limit - s.character_count,
    resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null,
  };
}

export async function voices() {
  const j = await (await call('/v1/voices')).json();
  return (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels, preview: v.preview_url }));
}

export const ttsKey = ({ text, voiceId, modelId, settings, format }) =>
  crypto.createHash('sha256').update(JSON.stringify({ text, voiceId, modelId, settings, format })).digest('hex').slice(0, 24);

export function cached(key) {
  const mp3 = path.join(CACHE, key + '.mp3'), al = path.join(CACHE, key + '.json');
  return fs.existsSync(mp3) && fs.existsSync(al) ? { mp3, alignment: al } : null;
}

/** Generate speech (or return the cached copy). Returns paths to mp3 + alignment json. */
export async function tts({ text, voiceId = config.elevenVoice, modelId = config.elevenModel, settings, format = config.elevenFormat }) {
  const key = ttsKey({ text, voiceId, modelId, settings, format });
  const hit = cached(key);
  if (hit) return { ...hit, key, fromCache: true };
  const res = await call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(format)}`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: modelId, voice_settings: settings }),
  });
  const j = await res.json();
  if (!j.audio_base64 || !j.alignment) throw new Error('ElevenLabs returned no audio/alignment');
  const mp3 = path.join(CACHE, key + '.mp3'), al = path.join(CACHE, key + '.json');
  fs.writeFileSync(mp3, Buffer.from(j.audio_base64, 'base64'));
  fs.writeFileSync(al, JSON.stringify(j.alignment));
  return { mp3, alignment: al, key, fromCache: false };
}
