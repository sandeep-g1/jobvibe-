// Google Gemini client. The key is read from process.env (loaded from the
// encrypted secrets store). Free-tier friendly: uses a flash model, and every
// call fails soft so a missing/invalid key never crashes a request.
import { cleanEnv } from '../db/driver.js';

const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-flash-latest'];
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiConfigured() {
  return !!cleanEnv(process.env.GEMINI_API_KEY);
}

/**
 * One text generation call. Tries models in order until one is available.
 * @returns {{ ok:boolean, text?:string, error?:string }}
 */
export async function generate(prompt, { json = false, temperature = 0.2, maxTokens = 4096 } = {}) {
  const key = cleanEnv(process.env.GEMINI_API_KEY);
  if (!key) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  let lastErr = 'no model responded';
  for (const model of MODELS) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    try {
      const res = await fetch(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { lastErr = `model ${model} not found`; continue; } // try next model
      if (!res.ok) {
        return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      if (!text) { lastErr = 'empty response'; continue; }
      return { ok: true, text, model };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err.message;
    }
  }
  return { ok: false, error: lastErr };
}

/** Pull the first JSON object/array out of a model response. */
function extractJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

/**
 * Parse raw resume text into structured profile fields.
 * @returns {{ ok:boolean, data?:object, error?:string }}
 */
export async function parseResume(resumeText) {
  const text = String(resumeText || '').slice(0, 20000);
  if (text.trim().length < 40) return { ok: false, error: 'resume text too short to parse' };

  const prompt = `You extract structured data from a resume. Return ONLY valid JSON with this exact shape, no commentary:
{
  "name": string,
  "email": string,
  "phone": string,
  "baseCity": string,            // current city, lowercase (e.g. "bengaluru")
  "totalExpYears": number,       // total years of professional experience
  "jobTitles": string[],         // 3-8 role titles this person could search for, based on their history
  "skillBank": string[],         // concrete skills, tools, methodologies they actually have
  "resumeSummary": string        // 3-5 sentence plain-text professional summary in first person, no markdown
}
Rules: infer nothing that is not supported by the resume. Use "" or 0 or [] when unknown. Keep skills to real, specific ones (not soft filler). Resume text follows between the markers.

===RESUME START===
${text}
===RESUME END===`;

  const r = await generate(prompt, { json: true, temperature: 0.1, maxTokens: 2048 });
  if (!r.ok) return { ok: false, error: r.error };
  const data = extractJson(r.text);
  if (!data || typeof data !== 'object') return { ok: false, error: 'could not parse model output' };

  // Normalise to the profile shape, defensively.
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
  return {
    ok: true,
    data: {
      name: String(data.name || '').trim(),
      email: String(data.email || '').trim(),
      phone: String(data.phone || '').trim(),
      baseCity: String(data.baseCity || '').trim().toLowerCase(),
      totalExpYears: Number(data.totalExpYears) || 0,
      jobTitles: arr(data.jobTitles).slice(0, 12),
      skillBank: arr(data.skillBank).slice(0, 60),
      resumeText: String(data.resumeSummary || '').trim(),
    },
  };
}
