// Tier A API keys. Reads keys.json, falling back to environment variables.
// Every Tier A adapter skips itself cleanly when its key is absent, so the
// pipeline runs fine on Tier B alone until you add them.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../db.js';

let cache = null;

export function keys() {
  if (cache) return cache;
  const file = join(ROOT, 'keys.json');
  let fromFile = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.warn(`  keys.json is not valid JSON (${e.message}) — ignoring it`);
    }
  }
  // A placeholder in keys.json must never shadow a real value. Copying
  // keys.example.json leaves strings like "YOUR_RAPIDAPI_KEY" behind, and
  // taking one of those in preference to the environment sent the literal
  // placeholder to RapidAPI and produced a 403.
  const pick = (...candidates) => {
    for (const c of candidates) {
      const v = String(c ?? '').trim();
      if (v && !isPlaceholder(v)) return v;
    }
    return '';
  };

  cache = {
    adzuna: {
      appId: pick(fromFile.adzuna?.appId, process.env.ADZUNA_APP_ID),
      appKey: pick(fromFile.adzuna?.appKey, process.env.ADZUNA_APP_KEY),
    },
    jooble: { apiKey: pick(fromFile.jooble?.apiKey, process.env.JOOBLE_API_KEY) },
    careerjet: { affid: pick(fromFile.careerjet?.affid, process.env.CAREERJET_AFFID) },
    jsearch: { rapidApiKey: pick(fromFile.jsearch?.rapidApiKey, process.env.RAPIDAPI_KEY) },
  };
  return cache;
}

/** Placeholder values in keys.example.json must not count as configured. */
export function isPlaceholder(v) {
  return !v || /^(your|xxx|<|paste|replace)/i.test(String(v).trim());
}

export function hasKey(source) {
  const k = keys();
  switch (source) {
    case 'adzuna': return !isPlaceholder(k.adzuna.appId) && !isPlaceholder(k.adzuna.appKey);
    case 'jooble': return !isPlaceholder(k.jooble.apiKey);
    case 'careerjet': return !isPlaceholder(k.careerjet.affid);
    case 'jsearch': return !isPlaceholder(k.jsearch.rapidApiKey);
    default: return true; // Tier B boards need nothing
  }
}
