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
  cache = {
    adzuna: {
      appId: fromFile.adzuna?.appId || process.env.ADZUNA_APP_ID || '',
      appKey: fromFile.adzuna?.appKey || process.env.ADZUNA_APP_KEY || '',
    },
    jooble: { apiKey: fromFile.jooble?.apiKey || process.env.JOOBLE_API_KEY || '' },
    careerjet: { affid: fromFile.careerjet?.affid || process.env.CAREERJET_AFFID || '' },
    jsearch: { rapidApiKey: fromFile.jsearch?.rapidApiKey || process.env.RAPIDAPI_KEY || '' },
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
