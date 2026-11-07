import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  port: Number(env('PORT', '3000')),
  python: env('PYTHON', 'python3'),
  ffmpeg: env('FFMPEG', 'ffmpeg'),

  // Which LLM writes ideas, scripts, prompts and timelines: "gemini", "claude" or "mock".
  // "auto" picks Claude when ANTHROPIC_API_KEY is set, then Gemini, then mock.
  llmProvider: env('LLM_PROVIDER', 'auto'),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  claudeModel: env('CLAUDE_MODEL', 'claude-opus-5-5'),
  geminiKey: env('GEMINI_API_KEY'),
  geminiModel: env('GEMINI_MODEL', 'gemini-pro-latest'),
  geminiFallbackModel: env('GEMINI_FALLBACK_MODEL', 'gemini-flash-latest'), // used when the main model has no quota (free tier)
  geminiSearchModel: env('GEMINI_SEARCH_MODEL', 'gemini-2.5-flash'), // web-search fact-checking; works on the free tier
  geminiImageModel: env('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image'),

  elevenKey: env('ELEVENLABS_API_KEY'),
  elevenModel: env('ELEVENLABS_MODEL', 'eleven_v4'),
  elevenVoice: env('ELEVENLABS_VOICE_ID', 'JBFqnCBsd6RMkjVDRZzb'), // "George"
  elevenFormat: env('ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128'), // free tier max
};

export function activeProvider() {
  const p = config.llmProvider.toLowerCase();
  if (p !== 'auto') return p;
  if (config.anthropicKey) return 'claude';
  if (config.geminiKey) return 'gemini';
  return 'mock';
}

/** Turn Gemini API errors into plain advice. */
export function geminiError(e) {
  const m = String(e?.message || e);
  const status = e?.status || Number((m.match(/"code":\s*(\d{3})/) || [])[1]) || 0;
  if (status === 402 || /prepayment credits/i.test(m)) return new Error('Gemini: this API key\'s project has no credits left (prepaid billing). Add credits at https://ai.studio/projects, or create a key in a project without billing to use the free tier.');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(m)) return new Error('Gemini: quota or rate limit reached for this key. Wait a minute and try again, or check your limits at https://ai.studio/projects.');
  if (status === 403 || /PERMISSION_DENIED|API key not valid/i.test(m)) return new Error('Gemini: this API key was refused. Check GEMINI_API_KEY in .env.');
  if (status === 503 || status === 500 || /UNAVAILABLE|high demand/.test(m)) return new Error('Gemini is busy right now (high demand). Try again in a minute.');
  if (status === 404 || /NOT_FOUND/.test(m)) return new Error(`Gemini: model not available for this key (${m.slice(0, 160)}). Set GEMINI_MODEL / GEMINI_IMAGE_MODEL in .env.`);
  return e instanceof Error ? e : new Error(m);
}
