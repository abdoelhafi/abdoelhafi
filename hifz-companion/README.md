# Hifz Companion

A calm, silent-first app for memorizing the Quran in the Warsh an Nafi riwaya. The product and build brief lives in the Claude doc "Hifz Companion: Product and Build Brief".

**Status: phase 1 (data and verification).** There is no UI yet. The gate for this phase has not been passed; see [Gate status](#gate-status).

## What is here

| Path | Purpose |
|---|---|
| `data/source.json` | The pinned sources: repository, commit and SHA-256 of each file, plus known source issues |
| `data/warsh.json` | The single immutable Quran data file the app will read. Written only by `scripts/ingest.mjs` |
| `data/checksums.json` | SHA-256 of `data/warsh.json`. The tests fail if the file changes without a deliberate re-ingest |
| `data/expected-verse-counts.json` | Per-surah verse counts taken from the source's surah index |
| `assets/fonts/` | KFGQPC Uthmanic Warsh font v10 (`.ttf` for Expo, `.woff2` for web) |
| `scripts/ingest.mjs` | Ingests the primary source once, validates it, and writes the data file and checksum |
| `scripts/crosscheck.mjs` | Compares the bundled text with an independent KFGQPC release and writes `reports/crosscheck.*` |
| `test/data.test.mjs` | The accuracy gate: checksum, 114 surahs, 6,214 ayahs, per-surah counts, order, ayah marks, characters, font hashes |

## Rules the pipeline follows

- Every ayah is copied byte for byte. Nothing is trimmed, reordered, normalized or "fixed".
- Anything that does not validate stops ingestion with an error. Nothing is written, and nothing is patched.
- The ayah number is embedded in each ayah as a font glyph (ayah *n* is U+FC00 + *n* − 1). The validator checks that it agrees with the metadata for all 6,214 ayahs.
- Normalized text (spaces removed, marks in canonical order) is used only inside the cross-check, never stored or shown.

## Commands

No dependencies are needed. Requires Node 20 or later.

```bash
npm test                                         # accuracy gate
node scripts/ingest.mjs <checkout of radouane-saddiki/Quran at the pinned commit>
node scripts/crosscheck.mjs <checkout of thetruetruth/quran-data-kfgqpc at the pinned commit>
```

## Gate status

The automated checks pass: 114 surahs, 6,214 ayahs, per-surah counts, contiguous numbering, a correct ayah mark on every ayah, only expected characters, and checksums. Both sources agree on every per-surah verse count.

**The gate is still open** for these reasons, which need a decision by the user and a teacher:

1. **The two KFGQPC releases differ in 47 ayahs.** See [`reports/crosscheck.md`](reports/crosscheck.md). Another 1,652 ayahs differ only in spacing or in the storage order of marks, which renders the same. The 47 are real differences of a vowel, sukun, shadda, madda, stop sign (U+06D6) or sajda sign (U+06E9).
2. **The candidate primary (v2.1) looks older than v10.** The v10 changelog lists fixes that v2.1 does not have:
   - A space added between the last word and the ayah number at An-Nahl 16:123. v2.1 has no separator there; this is recorded as a known issue in `data/source.json`.
   - Sajda marks removed in surahs 53, 84 and 96. v2.1 still has them at 53:61, 84:21 and 96:20.
   - Stop signs added and removed in several places.

   So v2.1 may be the earlier text, and v10 the corrected one. This could not be confirmed against the official KFGQPC site, which was unreachable from the build environment.
3. **The license is unconfirmed.** Neither repository grants a license for the KFGQPC text or font.

Recommended next step: download the current Warsh package directly from KFGQPC (qurancomplex.gov.sa, developer section), read its terms, and compare it with `scripts/crosscheck.mjs`. Then pin whichever release matches it, and ask a Warsh teacher to check the 47 listed ayahs against a printed mushaf.
