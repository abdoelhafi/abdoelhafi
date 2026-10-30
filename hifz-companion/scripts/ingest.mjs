#!/usr/bin/env node
// Ingests the pinned Warsh source once, validates it, and writes the single immutable data
// file the app reads (data/warsh.json) plus its SHA-256 (data/checksums.json).
//
// Usage: node scripts/ingest.mjs <path to a checkout of the primary source repository>
//
// This script never edits Quran text. Every ayah is copied byte for byte. If anything
// does not validate, it stops with an error and writes nothing.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_AYAHS,
  EXPECTED_SURAHS,
  AYAH_MARK_SEPARATOR,
  ayahMarkFor,
  readJson,
  sha256,
  sha256File,
} from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.argv[2];
if (!sourceRoot) {
  console.error('Usage: node scripts/ingest.mjs <path to primary source checkout>');
  process.exit(2);
}

const pin = readJson(join(root, 'data/source.json')).primary;
const knownMissingSeparator = new Set(pin.knownIssues?.missingMarkSeparator?.refs ?? []);
const errors = [];
const fail = (message) => errors.push(message);

const textPath = join(sourceRoot, pin.textFile);
const actualSha = sha256File(textPath);
if (actualSha !== pin.textSha256) {
  console.error(`Source file checksum mismatch for ${pin.textFile}:\n  expected ${pin.textSha256}\n  actual   ${actualSha}`);
  console.error('The source changed. Review it and update data/source.json deliberately before ingesting.');
  process.exit(1);
}

const rows = readJson(textPath);
const index = readJson(join(sourceRoot, pin.surahIndexFile));

if (rows.length !== EXPECTED_AYAHS) fail(`expected ${EXPECTED_AYAHS} ayahs, found ${rows.length}`);
if (index.length !== EXPECTED_SURAHS) fail(`expected ${EXPECTED_SURAHS} surahs in index, found ${index.length}`);

const expectedCounts = {};
index.forEach((s, i) => {
  if (s.sura_no !== i + 1) fail(`surah index out of order at position ${i + 1}`);
  expectedCounts[s.sura_no] = s.ayas;
});
const indexTotal = Object.values(expectedCounts).reduce((a, b) => a + b, 0);
if (indexTotal !== EXPECTED_AYAHS) fail(`surah index sums to ${indexTotal}, not ${EXPECTED_AYAHS}`);

const surahs = [];
let prev = null;
rows.forEach((r, i) => {
  const where = `row ${i + 1} (${r.sura_no}:${r.aya_no})`;
  if (r.id !== i + 1) fail(`${where}: id ${r.id} is not sequential`);
  if (typeof r.aya_text !== 'string' || r.aya_text.length === 0) fail(`${where}: empty text`);
  const startsSurah = !prev || prev.sura_no !== r.sura_no;
  if (startsSurah) {
    if (r.sura_no !== (prev ? prev.sura_no + 1 : 1)) fail(`${where}: surah does not follow ${prev?.sura_no}`);
    if (r.aya_no !== 1) fail(`${where}: surah does not start at ayah 1`);
    surahs.push({ number: r.sura_no, nameAr: r.sura_name_ar, nameEn: r.sura_name_en, ayahCount: 0 });
  } else if (r.aya_no !== prev.aya_no + 1) {
    fail(`${where}: ayah does not follow ${prev.aya_no}`);
  }
  surahs[surahs.length - 1].ayahCount++;
  // The ayah number is embedded in the text itself; it must agree with the metadata.
  const mark = ayahMarkFor(r.aya_no);
  if (!r.aya_text.endsWith(mark)) {
    fail(`${where}: text does not end with the mark for ayah ${r.aya_no}`);
  } else if (!r.aya_text.endsWith(AYAH_MARK_SEPARATOR + mark) && !knownMissingSeparator.has(`${r.sura_no}:${r.aya_no}`)) {
    fail(`${where}: no no-break space before the ayah mark`);
  }
  prev = r;
});

for (const s of surahs) {
  if (s.ayahCount !== expectedCounts[s.number]) {
    fail(`surah ${s.number}: ${s.ayahCount} ayahs in text, ${expectedCounts[s.number]} in surah index`);
  }
}

if (errors.length) {
  console.error(`Validation failed (${errors.length} problem(s)). Nothing was written.`);
  for (const e of errors.slice(0, 50)) console.error('  - ' + e);
  console.error('Do not patch the data. Report it and decide on the source.');
  process.exit(1);
}

const dataset = {
  version: `kfgqpc-warsh-v2.1@${pin.commit.slice(0, 7)}`,
  riwaya: 'Warsh an Nafi',
  source: {
    repository: pin.repository,
    commit: pin.commit,
    file: pin.textFile,
    sha256: pin.textSha256,
  },
  surahs,
  ayahs: rows.map((r) => ({
    surah: r.sura_no,
    ayah: r.aya_no,
    juz: r.jozz,
    page: r.page,
    lineStart: r.line_start,
    lineEnd: r.line_end,
    text: r.aya_text,
  })),
};

// One ayah per line keeps the file reviewable in diffs and the output deterministic.
const lines = [
  '{',
  `"version":${JSON.stringify(dataset.version)},`,
  `"riwaya":${JSON.stringify(dataset.riwaya)},`,
  `"source":${JSON.stringify(dataset.source)},`,
  '"surahs":[',
  dataset.surahs.map((s) => JSON.stringify(s)).join(',\n'),
  '],',
  '"ayahs":[',
  dataset.ayahs.map((a) => JSON.stringify(a)).join(',\n'),
  ']',
  '}',
  '',
];
const out = lines.join('\n');

// Round-trip guard: what was written must parse back to exactly the source text.
const reparsed = JSON.parse(out);
reparsed.ayahs.forEach((a, i) => {
  if (a.text !== rows[i].aya_text) throw new Error(`round-trip mismatch at ${a.surah}:${a.ayah}`);
});

writeFileSync(join(root, 'data/warsh.json'), out);
writeFileSync(
  join(root, 'data/expected-verse-counts.json'),
  JSON.stringify({ source: pin.surahIndexFile, total: indexTotal, counts: expectedCounts }, null, 2) + '\n',
);
writeFileSync(
  join(root, 'data/checksums.json'),
  JSON.stringify({ 'warsh.json': sha256(out) }, null, 2) + '\n',
);

console.log(`Wrote data/warsh.json: ${surahs.length} surahs, ${rows.length} ayahs, sha256 ${sha256(out)}`);
