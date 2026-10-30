import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const EXPECTED_SURAHS = 114;
export const EXPECTED_AYAHS = 6214;

// KFGQPC v2.1 encodes each ayah number as one glyph of the Warsh font:
// ayah n is U+FC00 + (n - 1), placed after a no-break space at the end of the text.
export const AYAH_MARK_BASE = 0xfc00;
export const AYAH_MARK_SEPARATOR = '\u00a0';

export function sha256(bufferOrString) {
  return createHash('sha256').update(bufferOrString).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

// Parses a JSON file exactly as published. A UTF-8 byte order mark is not part of the
// JSON value, so it is skipped; nothing else is touched.
export function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}

export function ayahMarkFor(ayahNumber) {
  return String.fromCodePoint(AYAH_MARK_BASE + ayahNumber - 1);
}

export function countBySurah(rows, surahKey, ayahKey) {
  const counts = {};
  for (const row of rows) {
    counts[row[surahKey]] = Math.max(counts[row[surahKey]] ?? 0, row[ayahKey]);
  }
  return counts;
}

// Ayah text without its number mark, for comparing sources only; never for display.
// v2.1 ends each ayah with one mark glyph (normally after a no-break space).
export function bodyWithoutGlyphMark(text) {
  return [...text].slice(0, -1).join('').replace(/\u00a0$/, '');
}

// v10 ends each ayah with the number in Arabic-Indic digits after a space.
export function bodyWithoutDigitMark(text) {
  return text.replace(/\s*[\u0660-\u0669]+$/, '');
}
