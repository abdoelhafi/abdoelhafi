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
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-pro'),
  geminiImageModel: env('GEMINI_IMAGE_MODEL', 'gemini-2.5-flash-image'),

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
