// Quiz engine: builds a species pool from the filters, picks species (favouring ones you
// miss), fetches varied observations for each, and works out which hints are available.

import { AVES_ID, speciesCounts, observations, taxonDetails, controlledTerms, slimTaxon } from './api.js';
import { findGroup, resolveGroup } from './groups.js';
import { load, save } from './storage.js';

const PER_PAGE = 30;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- filters -> API params ----------

export async function filterParams(filters) {
  const include = new Set();
  for (const item of filters.include) {
    if (item.kind === 'group') {
      const group = findGroup(item.groupId);
      if (group) (await resolveGroup(group)).forEach((id) => include.add(id));
    } else {
      include.add(item.id);
    }
  }
  if (filters.include.length && !include.size) {
    throw new Error("Couldn't resolve any of the chosen groups on iNaturalist.");
  }
  return {
    taxon_id: include.size ? [...include] : [AVES_ID],
    without_taxon_id: filters.exclude.map((t) => t.id),
    place_id: filters.places.map((p) => p.id),
    month: filters.months,
    quality_grade: filters.quality || 'research',
    captive: false,
  };
}

function mediaParam(kind) {
  return kind === 'sound' ? { sounds: true } : { photos: true };
}

// ---------- species pool ----------

export async function buildPool(filters) {
  const base = await filterParams(filters);
  const results = await speciesCounts({ ...base, ...mediaParam(filters.media === 'sound' ? 'sound' : 'photo') });
  const species = results
    .filter((r) => r.taxon && r.taxon.rank === 'species')
    .map((r) => ({
      ...slimTaxon(r.taxon),
      count: r.count,
      ancestorIds: r.taxon.ancestor_ids || [],
      photoMedium: r.taxon.default_photo?.medium_url || r.taxon.default_photo?.square_url || '',
    }));
  const limit = Number(filters.poolSize) || species.length;
  return { base, species: species.slice(0, limit) };
}

// ---------- per-species stats & weighted picking ----------

const stats = load('stats', {});

export function getStats(id) {
  return stats[id] || { seen: 0, correct: 0, streak: 0, lastWrong: false };
}

export function recordAnswer(id, correct) {
  const s = { ...getStats(id) };
  s.seen += 1;
  if (correct) {
    s.correct += 1;
    s.streak += 1;
    s.lastWrong = false;
  } else {
    s.streak = 0;
    s.lastWrong = true;
  }
  s.lastSeen = Date.now();
  stats[id] = s;
  save('stats', stats);
  return s;
}

export function resetStats() {
  for (const k of Object.keys(stats)) delete stats[k];
  save('stats', stats);
}

function weightFor(sp) {
  const s = getStats(sp.id);
  let w = s.seen === 0 ? 1.5 : 1;
  w /= 1 + s.streak * 0.6; // species you keep getting right come up less
  if (s.lastWrong) w *= 3; // species you just missed come back soon
  return w;
}

export function pickSpecies(pool, recentIds) {
  const avoid = new Set(pool.length > 4 ? recentIds.slice(-3) : recentIds.slice(-1));
  const candidates = pool.length > 1 ? pool.filter((s) => !avoid.has(s.id)) : pool;
  const weights = candidates.map(weightFor);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// ---------- observations for a species ----------

const obsCache = new Map(); // key -> { items, pagesTried:Set, maxPage, exhausted }

async function loadTerms() {
  return controlledTerms();
}

function annotationPairs(obs, terms) {
  return (obs.annotations || [])
    .filter((a) => (a.vote_score ?? 0) >= 0)
    .map((a) => ({
      attr: a.controlled_attribute?.label || terms.attrs[a.controlled_attribute_id] || '',
      value: a.controlled_value?.label || terms.values[a.controlled_value_id] || '',
    }))
    .filter((p) => p.attr && p.value);
}

// Skip dead birds and feathers/tracks etc. — they make poor ID practice.
function usable(obs, kind, terms) {
  const pairs = annotationPairs(obs, terms);
  if (pairs.some((p) => /alive or dead/i.test(p.attr) && /dead/i.test(p.value))) return false;
  if (kind === 'photo' && pairs.some((p) => /evidence/i.test(p.attr) && !/organism/i.test(p.value))) return false;
  if (kind === 'photo') return (obs.photos || []).some((p) => p.url);
  return (obs.sounds || []).some((s) => s.file_url);
}

async function fetchObsPage(key, params, page) {
  const entry = obsCache.get(key);
  entry.pagesTried.add(page);
  const data = await observations({ ...params, per_page: PER_PAGE, page });
  const terms = await loadTerms();
  const total = data.total_results || 0;
  entry.maxPage = Math.max(1, Math.min(Math.ceil(total / PER_PAGE), Math.floor(10000 / PER_PAGE)));
  const kind = params.sounds ? 'sound' : 'photo';
  const seen = new Set(entry.items.map((o) => o.id));
  for (const obs of data.results || []) {
    if (!seen.has(obs.id) && usable(obs, kind, terms)) entry.items.push(obs);
  }
  if (entry.pagesTried.size >= entry.maxPage) entry.exhausted = true;
}

function randomUntriedPage(entry) {
  const options = [];
  for (let p = 1; p <= entry.maxPage; p++) if (!entry.pagesTried.has(p)) options.push(p);
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}

// Returns a random usable observation of this species that isn't in `excludeIds`,
// fetching a random page of results (so you don't always see the newest photos).
export async function getExample(speciesId, kind, base, excludeIds = new Set(), { relaxFilters = false } = {}) {
  const params = { ...(relaxFilters ? { quality_grade: 'research', captive: false } : base), ...mediaParam(kind), taxon_id: speciesId };
  delete params.without_taxon_id;
  const key = JSON.stringify(params);
  if (!obsCache.has(key)) {
    obsCache.set(key, { items: [], pagesTried: new Set(), maxPage: 1, exhausted: false });
    await fetchObsPage(key, params, 1);
    const entry = obsCache.get(key);
    // Mix in a random deeper page for variety when there are lots of observations.
    const page = randomUntriedPage(entry);
    if (page) await fetchObsPage(key, params, page);
  }
  const entry = obsCache.get(key);
  let fresh = entry.items.filter((o) => !excludeIds.has(o.id));
  while (!fresh.length && !entry.exhausted) {
    const page = randomUntriedPage(entry);
    if (!page) break;
    await fetchObsPage(key, params, page);
    fresh = entry.items.filter((o) => !excludeIds.has(o.id));
  }
  if (!fresh.length) {
    if (!relaxFilters && (base.place_id?.length || base.month?.length)) {
      return getExample(speciesId, kind, base, excludeIds, { relaxFilters: true });
    }
    return null;
  }
  return fresh[Math.floor(Math.random() * fresh.length)];
}

// ---------- multiple-choice options ----------

function genusOf(sp) {
  return sp.name.split(' ')[0];
}

function similarity(a, b) {
  if (genusOf(a) === genusOf(b)) return 100;
  const x = a.ancestorIds;
  const y = b.ancestorIds;
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  return shared;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildChoices(answer, pool, count, difficulty) {
  const others = pool.filter((s) => s.id !== answer.id);
  let distractors;
  if (difficulty === 'similar') {
    // Rank by relatedness, but shuffle within ties so choices vary between questions.
    const ranked = shuffle(others).sort((a, b) => similarity(answer, b) - similarity(answer, a));
    distractors = ranked.slice(0, count - 1);
  } else {
    distractors = shuffle(others).slice(0, count - 1);
  }
  return shuffle([answer, ...distractors]);
}

// ---------- typed answers ----------

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/grey/g, 'gray')
    .replace(/[^a-z]/g, '');
}

export function matchesTyped(input, sp) {
  const n = normalize(input);
  return !!n && (n === normalize(sp.common) || n === normalize(sp.name));
}

// ---------- hints ----------

const detailCache = new Map();
export function speciesDetails(id) {
  if (!detailCache.has(id)) {
    const p = taxonDetails(id).catch(() => null);
    detailCache.set(id, p);
  }
  return detailCache.get(id);
}

export async function annotationsFor(obs) {
  return annotationPairs(obs, await loadTerms());
}

export function seasonOf(obs) {
  const d = obs.observed_on_details;
  const month = d?.month || (obs.observed_on ? Number(obs.observed_on.slice(5, 7)) : null);
  return month ? MONTHS[month - 1] : null;
}

export function ancestorAtRank(details, rank) {
  const a = (details?.ancestors || []).find((t) => t.rank === rank);
  return a ? { name: a.name, common: a.preferred_common_name || '' } : null;
}

export function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return doc.body.textContent || '';
}
