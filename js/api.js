// Thin client for the public iNaturalist v1 API (https://api.inaturalist.org/v1/docs/).
// Requests are spaced out and memoised so we stay well inside iNat's rate limits.

const BASE = 'https://api.inaturalist.org/v1';
const MIN_GAP_MS = 350;
export const AVES_ID = 3;

let gate = Promise.resolve();
let lastRequestAt = 0;
const memo = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toQuery(params = {}) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      q.set(key, value.join(','));
    } else {
      q.set(key, String(value));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

function throttle() {
  gate = gate.then(async () => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  return gate;
}

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      if (attempt === 2) throw new Error(`Network error talking to iNaturalist: ${err.message}`);
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 2) throw new Error(`iNaturalist returned ${res.status}`);
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`iNaturalist returned ${res.status}`);
    return res.json();
  }
  throw new Error('iNaturalist request failed');
}

export function apiGet(path, params, { cache = true } = {}) {
  const url = BASE + path + toQuery(params);
  if (cache && memo.has(url)) return memo.get(url);
  const p = fetchJson(url);
  if (cache) {
    memo.set(url, p);
    p.catch(() => memo.delete(url));
  }
  return p;
}

export function isBird(taxon) {
  if (!taxon) return false;
  return (
    taxon.id === AVES_ID ||
    taxon.iconic_taxon_id === AVES_ID ||
    (Array.isArray(taxon.ancestor_ids) && taxon.ancestor_ids.includes(AVES_ID))
  );
}

export function slimTaxon(t) {
  return {
    id: t.id,
    name: t.name,
    common: t.preferred_common_name || '',
    rank: t.rank,
    photo: t.default_photo?.square_url || '',
  };
}

export async function searchPlaces(q) {
  const data = await apiGet('/places/autocomplete', { q, per_page: 10 });
  return (data.results || []).map((p) => ({ id: p.id, name: p.display_name || p.name }));
}

export async function searchBirdTaxa(q) {
  const data = await apiGet('/taxa/autocomplete', { q, per_page: 20, is_active: true });
  return (data.results || []).filter(isBird).map(slimTaxon);
}

// Resolve an exact scientific name (e.g. "Larinae") to a bird taxon.
export async function resolveTaxonName(name) {
  const data = await apiGet('/taxa', { q: name, is_active: true, per_page: 30 });
  const wanted = name.toLowerCase();
  const hit = (data.results || []).find((t) => t.name?.toLowerCase() === wanted && isBird(t));
  return hit ? slimTaxon(hit) : null;
}

export async function speciesCounts(params) {
  const data = await apiGet('/observations/species_counts', { per_page: 500, ...params });
  return data.results || [];
}

export async function observations(params) {
  return apiGet('/observations', params);
}

export async function taxonDetails(id) {
  const data = await apiGet(`/taxa/${id}`);
  return data.results?.[0] || null;
}

let termsPromise = null;
// Map of annotation ids -> labels, e.g. { attrs: {1: 'Life Stage'}, values: {2: 'Adult'} }.
export function controlledTerms() {
  if (!termsPromise) {
    termsPromise = apiGet('/controlled_terms')
      .then((data) => {
        const attrs = {};
        const values = {};
        for (const term of data.results || []) {
          attrs[term.id] = term.label;
          for (const v of term.values || []) values[v.id] = v.label;
        }
        return { attrs, values };
      })
      .catch(() => ({
        attrs: { 1: 'Life Stage', 9: 'Sex', 17: 'Alive or Dead', 22: 'Evidence of Presence' },
        values: { 2: 'Adult', 7: 'Egg', 8: 'Juvenile', 10: 'Female', 11: 'Male', 18: 'Alive', 19: 'Dead' },
      }));
  }
  return termsPromise;
}

export function photoUrl(photo, size = 'large') {
  const url = photo?.url || '';
  return url.replace(/\/square\.(jpe?g|png|gif)/i, `/${size}.$1`);
}
