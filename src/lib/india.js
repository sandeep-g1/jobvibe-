// The India gate. A job that cannot be resolved to an Indian location is dropped,
// not ranked low — per §05 stage 03 of the architecture.

// canonical city -> aliases seen in real postings
const CITY_ALIASES = {
  bengaluru: ['bengaluru', 'bangalore', 'bangalore urban', 'blr', 'bengaluru urban', 'whitefield', 'electronic city'],
  hyderabad: ['hyderabad', 'secunderabad', 'hyd', 'cyberabad', 'hitec city', 'telangana'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane', 'andheri', 'powai', 'bkc'],
  pune: ['pune', 'poona', 'hinjewadi', 'kharadi', 'pimpri', 'chinchwad'],
  delhi: ['delhi', 'new delhi', 'ncr', 'delhi ncr', 'national capital region'],
  gurugram: ['gurugram', 'gurgaon', 'manesar'],
  noida: ['noida', 'greater noida', 'ghaziabad'],
  chennai: ['chennai', 'madras', 'omr', 'sholinganallur'],
  kolkata: ['kolkata', 'calcutta', 'salt lake'],
  ahmedabad: ['ahmedabad', 'gandhinagar', 'gift city'],
  jaipur: ['jaipur'],
  kochi: ['kochi', 'cochin', 'ernakulam', 'infopark'],
  trivandrum: ['trivandrum', 'thiruvananthapuram', 'technopark'],
  coimbatore: ['coimbatore'],
  indore: ['indore'],
  chandigarh: ['chandigarh', 'mohali', 'panchkula'],
  bhubaneswar: ['bhubaneswar'],
  nagpur: ['nagpur'],
  vadodara: ['vadodara', 'baroda'],
  surat: ['surat'],
  lucknow: ['lucknow'],
  visakhapatnam: ['visakhapatnam', 'vizag'],
  mysuru: ['mysuru', 'mysore'],
  mangaluru: ['mangaluru', 'mangalore'],
  goa: ['goa', 'panaji'],
};

const ALIAS_TO_CITY = new Map();
for (const [canon, aliases] of Object.entries(CITY_ALIASES)) {
  for (const a of aliases) ALIAS_TO_CITY.set(a, canon);
}

const INDIA_WORDS = /\b(india|indian|bharat)\b/i;
const NON_INDIA_HINTS =
  /\b(united states|usa|u\.s\.|canada|united kingdom|london|germany|berlin|france|paris|netherlands|amsterdam|singapore|dubai|uae|australia|sydney|japan|tokyo|china|shanghai|brazil|mexico|poland|warsaw|spain|madrid|ireland|dublin|israel|tel aviv|new york|san francisco|seattle|austin|boston|chicago|toronto|vancouver)\b/i;

/** Resolve a free-text location to a canonical Indian city, or null. */
export function normalizeCity(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  // Longest alias first so "navi mumbai" wins over "mumbai".
  let best = null;
  let bestLen = 0;
  for (const [alias, canon] of ALIAS_TO_CITY) {
    if (alias.length > bestLen && new RegExp(`\\b${alias.replace(/ /g, '\\s+')}\\b`).test(s)) {
      best = canon;
      bestLen = alias.length;
    }
  }
  return best;
}

/**
 * Decide whether a posting is an India job.
 * Returns { isIndia, city, workMode, reason }.
 */
export function indiaGate({ location, isRemote, workplaceType, country, jdText = '' }) {
  const loc = String(location || '');
  const lower = loc.toLowerCase();
  const city = normalizeCity(loc);
  const countryIsIndia = country && /^(in|ind|india)$/i.test(String(country).trim());

  const remoteish =
    isRemote === true ||
    /^remote/i.test(workplaceType || '') ||
    /\bremote\b/i.test(lower);

  const workMode = remoteish
    ? 'Remote'
    : /hybrid/i.test(lower) || /hybrid/i.test(workplaceType || '')
      ? 'Hybrid'
      : 'On-site';

  if (countryIsIndia) return { isIndia: true, city: city || cityFromText(loc), workMode, reason: 'country=IN' };
  if (city) return { isIndia: true, city, workMode, reason: 'city match' };
  if (INDIA_WORDS.test(loc)) return { isIndia: true, city: null, workMode, reason: 'india in location' };

  // "Remote" with no country: accept only if the JD itself scopes it to India.
  if (remoteish && !NON_INDIA_HINTS.test(lower)) {
    const head = jdText.slice(0, 4000);
    if (INDIA_WORDS.test(head)) {
      return { isIndia: true, city: normalizeCity(head), workMode: 'Remote', reason: 'remote + india in JD' };
    }
  }

  return { isIndia: false, city: null, workMode, reason: 'no india signal' };
}

function cityFromText(text) {
  return normalizeCity(text);
}

export function displayCity(city) {
  if (!city) return 'India';
  return city.charAt(0).toUpperCase() + city.slice(1);
}

export const KNOWN_CITIES = Object.keys(CITY_ALIASES);
