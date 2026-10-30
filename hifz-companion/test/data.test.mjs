// Accuracy gate for the bundled Quran text. Run with `npm test`.
// These tests only read the data. They never change it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AYAH_MARK_SEPARATOR,
  EXPECTED_AYAHS,
  EXPECTED_SURAHS,
  ayahMarkFor,
  readJson,
  sha256,
} from '../scripts/lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(root, 'data/warsh.json'));
const data = JSON.parse(raw.toString('utf8'));
const checksums = readJson(join(root, 'data/checksums.json'));
const expected = readJson(join(root, 'data/expected-verse-counts.json'));
const source = readJson(join(root, 'data/source.json'));

test('bundled data file matches its recorded SHA-256', () => {
  assert.equal(
    sha256(raw),
    checksums['warsh.json'],
    'data/warsh.json changed. Only scripts/ingest.mjs may write it, as a deliberate data update.',
  );
});

test('dataset records the pinned source', () => {
  assert.equal(data.source.repository, source.primary.repository);
  assert.equal(data.source.commit, source.primary.commit);
  assert.equal(data.source.sha256, source.primary.textSha256);
});

test(`has ${EXPECTED_SURAHS} surahs and ${EXPECTED_AYAHS} ayahs (Warsh count)`, () => {
  assert.equal(data.surahs.length, EXPECTED_SURAHS);
  assert.equal(data.ayahs.length, EXPECTED_AYAHS);
  assert.equal(expected.total, EXPECTED_AYAHS);
});

test('per-surah verse counts match the source surah index', () => {
  const actual = {};
  for (const a of data.ayahs) actual[a.surah] = (actual[a.surah] ?? 0) + 1;
  for (let s = 1; s <= EXPECTED_SURAHS; s++) {
    assert.equal(actual[s], expected.counts[s], `surah ${s}`);
    assert.equal(data.surahs[s - 1].number, s);
    assert.equal(data.surahs[s - 1].ayahCount, expected.counts[s], `surah ${s} header`);
  }
});

test('known Warsh counts that differ from Hafs', () => {
  // Al-Baqara has 285 ayahs and At-Tawba 130 in the Madinan count of Nafi (Hafs: 286 and 129).
  assert.equal(expected.counts[2], 285);
  assert.equal(expected.counts[9], 130);
});

test('ayahs are contiguous and in order', () => {
  let prev = null;
  for (const a of data.ayahs) {
    if (prev && prev.surah === a.surah) assert.equal(a.ayah, prev.ayah + 1, `${a.surah}:${a.ayah}`);
    else {
      assert.equal(a.surah, prev ? prev.surah + 1 : 1, `${a.surah}:${a.ayah}`);
      assert.equal(a.ayah, 1, `${a.surah}:${a.ayah}`);
    }
    prev = a;
  }
});

test('every ayah ends with the mark for its own number', () => {
  const known = new Set(source.primary.knownIssues?.missingMarkSeparator?.refs ?? []);
  for (const a of data.ayahs) {
    const ref = `${a.surah}:${a.ayah}`;
    assert.ok(a.text.endsWith(ayahMarkFor(a.ayah)), `${ref}: wrong or missing ayah mark`);
    if (!known.has(ref)) {
      assert.ok(a.text.endsWith(AYAH_MARK_SEPARATOR + ayahMarkFor(a.ayah)), `${ref}: no separator before mark`);
    }
  }
});

test('text uses only expected code points', () => {
  // Arabic block, the font's ayah-number glyphs, space, no-break space, right-to-left mark.
  const allowed = (cp) =>
    (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0xfc00 && cp <= 0xfd1c) || cp === 0x20 || cp === 0xa0 || cp === 0x200f;
  for (const a of data.ayahs) {
    for (const ch of a.text) {
      const cp = ch.codePointAt(0);
      assert.ok(allowed(cp), `${a.surah}:${a.ayah}: unexpected U+${cp.toString(16).toUpperCase()}`);
    }
  }
});

test('bundled font files match their recorded SHA-256', () => {
  for (const [file, hash] of Object.entries(source.font.files)) {
    assert.equal(sha256(readFileSync(join(root, 'assets/fonts', file))), hash, file);
  }
});
