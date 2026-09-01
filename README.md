# Shortlist India — Phase 1

A daily, de-duplicated shortlist of **India-only** jobs, scored against your resume,
with **every apply link verified before it reaches the report**.

Zero npm dependencies. Zero running cost. Node 22+ only (uses built-in `node:sqlite` and `fetch`).

---

## Quick start

```bash
npm run seed
```
Probes every candidate board in `data/companies.json`, keeps the ones that answer, and
records how many India jobs each carries. Run this once, then roughly weekly.

```bash
npm run run
```
The full pipeline. Writes `reports/latest.html`.

```bash
npm run serve
```
Opens the report at http://localhost:3100 with the Applied toggle persisting to the database.

```bash
npm run stats     # run history, per-source counts, registry health
npm run reset     # clear jobs/matches so everything counts as new again
```

---

## What Phase 1 delivers

| Capability | Status |
|---|---|
| Greenhouse / Lever / Ashby / SmartRecruiters adapters | Done |
| Curated + **verified** company registry | Done — 160 live boards, 201 dead candidates filtered |
| India gate (city aliases, remote-in-India, country codes) | Done |
| Fingerprint de-duplication + near-duplicate repost merge | Done |
| Link verification with trusted-403 handling | Done |
| BM25 + 5-component match scoring | Done |
| Batch 7 report layout, rendered from the database | Done |
| Applied tracking persisted to SQLite | Done |
| CSV export, portal / mode / score / recommendation filters | Done |

Last run: **10,240 postings fetched → 1,071 India → 959 new unique → 60 reported**, 0 dead links.
Registry: **160 live boards** carrying 1,683 visible India jobs (201 dead candidates filtered out).

**Zero-duplicate guarantee, verified:** two consecutive runs produced 120 rows with
**0 fingerprint overlap** — day 2 served the next 60 rather than repeating day 1.

---

## The rule that fixes broken links

> **Never construct a URL. Only ever store the one the source returned.**

Enforced in three places:

1. `src/adapters/*` — every adapter reads a provider-supplied field
   (`absolute_url`, `hostedUrl`, `jobUrl`, `postingUrl`). No string assembly anywhere.
   A posting with no provider URL is dropped, not guessed at.
2. `src/verify.js` — every link is fetched and its final redirect target stored.
3. `src/report.js` — `DEAD` rows never render.

A **403 from a trusted source means bot-blocked, not dead.** Coinbase returns 403 to a
script and 200 in your browser; treating that as death would silently delete good jobs.
Those rows render with an `unverified` tag.

---

## Scoring

Deterministic, explainable, free. Hover any match % in the report for the full breakdown.

| Component | Weight | What it measures |
|---|---:|---|
| Must-have skills | 35 | Rarity-weighted coverage of the JD's required skills |
| Semantic fit | 25 | BM25, your resume text against the full JD |
| Experience band | 15 | Your years vs the range the JD asks for |
| Title & domain | 10 | Stemmed overlap with your target titles |
| Location & mode | 10 | Hard gate — a mode you don't accept scores 0 |
| *Resume parse health* | *5* | *Phase 5 — not measured yet* |

Phase 1 scores the five measurable components and **renormalises to 100** rather than
inventing a value for the sixth.

**Why skills are rarity-weighted.** "Communication" and "Leadership" appear in nearly
every JD and sit in every PM's skill bank. Unweighted, an upholstery sales role scored a
perfect 35/35. Each required skill is now weighted by how rare it is across the day's
corpus, and a JD offering thin evidence (two generic skills) cannot earn the full
component. That one change moved the off-domain roles out of the top 60.

Bands: **≥75 apply · 60–74 consider · <60 skip.**

---

## Configuration

`profile.local.json` — your search profile. Copy it from `profile.example.json`:

```bash
cp profile.example.json profile.local.json
```

It is gitignored, so your name and resume text never reach the public repo.
Edit and re-run; nothing is hardcoded.

- `jobTitles` — drives the title component. Add variants you'd genuinely take.
- `skillBank` — the truth boundary. Phase 5's resume tailor may only use what's in here.
- `resumeText` — free text, fed to BM25. The richer and more honest, the better the scoring.
- `preferredLocations`, `workModes` — the location gate.
- `minScore`, `dailyLimit` — how much reaches the report.
- `sources` — which adapters run. Drop one to exclude that portal entirely.
- `excludeKeywords` — matched against the **title** with word boundaries.
  (Scanning full JD text dropped 292 real jobs, because plenty merely mention an
  internship programme in passing.)

`data/companies.json` — candidate boards. Add any company; `npm run seed` verifies it.
Guessed slugs failing here is expected and is the point of verification.

---

## Layout

```
profile.json           your search profile
data/companies.json    candidate ATS boards (seed verifies these)
data/shortlist.db      SQLite — jobs, matches, runs, applications
reports/               generated HTML, one per run + latest.html
src/
  run.js               pipeline, stages 01-10
  seed.js              registry verification
  score.js             BM25 + component scoring
  verify.js            link verification
  report.js            report renderer
  serve.js             local server for Applied persistence
  stats.js             run history and registry health
  db.js                schema + queries
  adapters/            Tier B: greenhouse · lever · ashby · smartrecruiters
                       Tier A: adzuna · careerjet · jooble · jsearch (need keys)
  lib/                 http · normalize (fingerprint) · india gate · skills · keys
  tools/               expand-registry.js
```

---

## Tier A — reaching Naukri, LinkedIn and Indeed

Tier B (open ATS boards) is keyless but caps out at roughly 1,000 India jobs. Tier A
reaches the Indian portals you actually care about, through aggregators that already
index them — no scraping. Each is free and **optional**; the pipeline runs fine without
any of them and reports which are idle.

```bash
cp keys.example.json keys.json   # then paste your keys in
```

| Source | Get a free key | Reaches |
|---|---|---|
| **JSearch** (Google for Jobs) | rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch | **Naukri, LinkedIn, Indeed, Foundit, Shine, TimesJobs, Hirist** |
| **Adzuna India** | developer.adzuna.com | Broad India index, salary estimates |
| **Careerjet India** | careerjet.com/partners | Broad India index |
| **Jooble India** | jooble.org/api/about | Broad India index |

JSearch is the one that matters most — it is the legitimate route to the portals in your
original app. `job_publisher` tells you which portal each row came from, and
`job_apply_link` is the canonical link Google resolved to, so the no-constructed-URLs
rule still holds.

**These four adapters are written to each provider's documented response shape but have
not been executed against a live key** — I could not verify them without your credentials.
Expect to shake out a field mapping or two on first run; `npm run stats` will show any
source warnings.

## Known limits in Phase 1

- **Tier A is unproven until you add keys.** See above. Without them, coverage is open
  ATS boards only — good jobs, but not Naukri or LinkedIn.
- **The registry rewards expansion.** 160 live boards now. Adding companies to
  `data/companies.json` then re-seeding is pure upside; guessed slugs simply get filtered.
- **Off-domain roles still creep in** around the 75 mark when a JD is generic.
  Title scoring flags them (low title points), but true domain filtering is Phase 3.
- **Single user, no login.** `profile.json` is the whole user model until Phase 2.
- **Salary is rarely populated** — ATS boards seldom publish it. Tier A sources do.
