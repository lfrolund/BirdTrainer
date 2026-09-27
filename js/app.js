import { searchPlaces, searchBirdTaxa, photoUrl } from './api.js';
import { allGroups, findGroup, groupSummary, loadCustomGroups, saveCustomGroups } from './groups.js';
import {
  buildPool, pickSpecies, getExample, buildChoices, matchesTyped, recordAnswer, getStats, resetStats,
  speciesDetails, annotationsFor, seasonOf, ancestorAtRank, stripHtml,
} from './quiz.js';
import { load, save } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DEFAULT_FILTERS = {
  places: [],
  include: [],
  exclude: [],
  months: [],
  media: 'photo',
  poolSize: '50',
  answer: '4',
  difficulty: 'similar',
  quality: 'research',
};

const state = {
  filters: { ...DEFAULT_FILTERS, ...load('filters', {}) },
  pool: [],
  base: null,
  session: { answered: 0, correct: 0, streak: 0, recent: [] },
  q: null,
  prepared: null,
};

function persistFilters() {
  save('filters', state.filters);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function speciesLabel(sp) {
  return sp.common ? `${sp.common}` : sp.name;
}

// ================= views =================

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'species') renderSpeciesGrid();
}

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => !tab.disabled && showView(tab.dataset.view)),
);

// ================= autocomplete picker =================

function createPicker({ input, list, search, onPick }) {
  let items = [];
  let active = -1;
  let timer = null;
  let token = 0;

  const close = () => {
    list.hidden = true;
    active = -1;
  };

  const render = () => {
    list.replaceChildren(
      ...items.map((item, i) =>
        el('li', {
          class: i === active ? 'active' : '',
          role: 'option',
          onmousedown: (e) => {
            e.preventDefault();
            choose(i);
          },
        },
        item.img ? el('img', { src: item.img, alt: '', loading: 'lazy' }) : el('span', { class: 'sugg-icon', text: item.icon || '' }),
        el('span', { class: 'sugg-text' }, el('strong', { text: item.label }), item.sub ? el('small', { text: item.sub }) : null)),
      ),
    );
    list.hidden = !items.length;
  };

  const choose = (i) => {
    const item = items[i];
    if (!item) return;
    onPick(item.value);
    input.value = '';
    items = [];
    close();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      items = [];
      close();
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++token;
      try {
        const res = await search(q);
        if (mine !== token) return;
        items = res;
        active = items.length ? 0 : -1;
        render();
      } catch (err) {
        if (mine !== token) return;
        items = [];
        list.replaceChildren(el('li', { class: 'muted' }, `Search failed: ${err.message}`));
        list.hidden = false;
      }
    }, 250);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      active = Math.min(items.length - 1, active + 1);
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(0, active - 1);
      render();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      choose(active);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

const RANK_LABEL = (t) => (t.rank ? t.rank[0].toUpperCase() + t.rank.slice(1) : '');

function taxonItem(t) {
  return {
    label: t.common || t.name,
    sub: `${RANK_LABEL(t)} · ${t.name}`,
    img: t.photo,
    value: t,
  };
}

// ================= setup: places =================

function renderChips(container, items, onRemove, labelOf) {
  container.replaceChildren(
    ...items.map((item, i) =>
      el('span', { class: 'chip' }, labelOf(item),
        el('button', { class: 'chip-x', 'aria-label': `Remove ${labelOf(item)}`, onclick: () => onRemove(i) }, '×')),
    ),
  );
}

function renderPlaces() {
  renderChips($('#place-chips'), state.filters.places, (i) => {
    state.filters.places.splice(i, 1);
    persistFilters();
    renderPlaces();
  }, (p) => p.name);
}

createPicker({
  input: $('#place-input'),
  list: $('#place-suggestions'),
  search: async (q) => (await searchPlaces(q)).map((p) => ({ label: p.name, icon: '📍', value: p })),
  onPick: (p) => {
    if (!state.filters.places.some((x) => x.id === p.id)) state.filters.places.push(p);
    persistFilters();
    renderPlaces();
  },
});

// ================= setup: months =================

function renderMonths() {
  $('#months').replaceChildren(
    ...MONTH_ABBR.map((m, i) => {
      const n = i + 1;
      const on = state.filters.months.includes(n);
      return el('button', {
        class: `month${on ? ' on' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          const set = new Set(state.filters.months);
          set.has(n) ? set.delete(n) : set.add(n);
          state.filters.months = [...set].sort((a, b) => a - b);
          persistFilters();
          renderMonths();
        },
      }, m);
    }),
  );
}

$('#months-now').addEventListener('click', () => {
  const m = new Date().getMonth(); // 0-based
  state.filters.months = [((m + 11) % 12) + 1, m + 1, ((m + 1) % 12) + 1].sort((a, b) => a - b);
  persistFilters();
  renderMonths();
});
$('#months-clear').addEventListener('click', () => {
  state.filters.months = [];
  persistFilters();
  renderMonths();
});

// ================= setup: taxa & groups =================

function includeLabel(item) {
  if (item.kind === 'group') return `${findGroup(item.groupId)?.name || item.name} (group)`;
  return item.common ? `${item.common} (${item.name})` : `${RANK_LABEL(item)} ${item.name}`;
}

function renderIncludes() {
  // Drop custom groups that were deleted.
  state.filters.include = state.filters.include.filter((i) => i.kind !== 'group' || findGroup(i.groupId));
  renderChips($('#include-chips'), state.filters.include, (i) => {
    state.filters.include.splice(i, 1);
    persistFilters();
    renderIncludes();
  }, includeLabel);
  renderGroupList();
}

function addInclude(item) {
  const dup = state.filters.include.some((x) =>
    item.kind === 'group' ? x.groupId === item.groupId : x.kind !== 'group' && x.id === item.id);
  if (!dup) state.filters.include.push(item);
  persistFilters();
  renderIncludes();
}

function matchingGroups(q) {
  const n = q.toLowerCase();
  return allGroups().filter((g) => g.name.toLowerCase().includes(n) || g.id.includes(n));
}

createPicker({
  input: $('#taxon-input'),
  list: $('#taxon-suggestions'),
  search: async (q) => {
    const groups = matchingGroups(q).map((g) => ({
      label: g.name,
      sub: `${g.custom ? 'Your group' : 'Group'} · ${groupSummary(g)}`,
      icon: '🗂️',
      value: { kind: 'group', groupId: g.id, name: g.name },
    }));
    let taxa = [];
    try {
      taxa = (await searchBirdTaxa(q)).map((t) => ({ ...taxonItem(t), value: { kind: 'taxon', ...t } }));
    } catch (err) {
      if (!groups.length) throw err;
    }
    return [...groups, ...taxa];
  },
  onPick: addInclude,
});

function renderExcludes() {
  renderChips($('#exclude-chips'), state.filters.exclude, (i) => {
    state.filters.exclude.splice(i, 1);
    persistFilters();
    renderExcludes();
  }, (t) => (t.common ? `${t.common} (${t.name})` : t.name));
}

createPicker({
  input: $('#exclude-input'),
  list: $('#exclude-suggestions'),
  search: async (q) => (await searchBirdTaxa(q)).map(taxonItem),
  onPick: (t) => {
    if (!state.filters.exclude.some((x) => x.id === t.id)) state.filters.exclude.push(t);
    persistFilters();
    renderExcludes();
  },
});

function renderGroupList() {
  const chosen = new Set(state.filters.include.filter((i) => i.kind === 'group').map((i) => i.groupId));
  $('#group-list').replaceChildren(
    ...allGroups().map((g) =>
      el('div', { class: `group-item${chosen.has(g.id) ? ' chosen' : ''}` },
        el('button', {
          class: 'group-add',
          title: groupSummary(g),
          onclick: () => addInclude({ kind: 'group', groupId: g.id, name: g.name }),
        }, chosen.has(g.id) ? '✓ ' : '+ ', g.name),
        g.custom
          ? el('button', {
            class: 'chip-x',
            'aria-label': `Delete group ${g.name}`,
            onclick: () => {
              if (!confirm(`Delete your group “${g.name}”?`)) return;
              saveCustomGroups(loadCustomGroups().filter((c) => c.id !== g.id));
              renderIncludes();
            },
          }, '×')
          : null),
    ),
  );
}

// ----- custom group dialog -----
let draftGroup = [];
function renderDraftGroup() {
  renderChips($('#group-chips'), draftGroup, (i) => {
    draftGroup.splice(i, 1);
    renderDraftGroup();
  }, (t) => (t.common ? `${t.common} (${t.name})` : t.name));
}

createPicker({
  input: $('#group-input'),
  list: $('#group-suggestions'),
  search: async (q) => (await searchBirdTaxa(q)).map(taxonItem),
  onPick: (t) => {
    if (!draftGroup.some((x) => x.id === t.id)) draftGroup.push(t);
    renderDraftGroup();
  },
});

$('#new-group-btn').addEventListener('click', () => {
  draftGroup = [];
  $('#group-name').value = '';
  renderDraftGroup();
  $('#group-dialog').showModal();
});

$('#group-form').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'save') return;
  const name = $('#group-name').value.trim();
  if (!name || !draftGroup.length) {
    e.preventDefault();
    alert('Give the group a name and add at least one taxon.');
    return;
  }
  const group = { id: `custom-${Date.now()}`, name, taxa: draftGroup };
  saveCustomGroups([...loadCustomGroups(), group]);
  addInclude({ kind: 'group', groupId: group.id, name });
});

// ================= setup: options =================

const OPTION_BINDINGS = [
  ['#opt-media', 'media'],
  ['#opt-pool', 'poolSize'],
  ['#opt-answer', 'answer'],
  ['#opt-difficulty', 'difficulty'],
  ['#opt-quality', 'quality'],
];
for (const [sel, key] of OPTION_BINDINGS) {
  const node = $(sel);
  node.value = state.filters[key];
  if (node.value !== String(state.filters[key])) node.value = DEFAULT_FILTERS[key];
  node.addEventListener('change', () => {
    state.filters[key] = node.value;
    persistFilters();
    $('#opt-difficulty').disabled = state.filters.answer === 'type';
  });
}
$('#opt-difficulty').disabled = state.filters.answer === 'type';

// ================= start =================

$('#start-btn').addEventListener('click', async () => {
  const btn = $('#start-btn');
  const errBox = $('#setup-error');
  errBox.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Finding birds…';
  try {
    const { base, species } = await buildPool(state.filters);
    const minNeeded = state.filters.answer === 'type' ? 1 : 2;
    if (species.length < minNeeded) {
      throw new Error(species.length
        ? 'Only one species matches these filters. Widen the place, months or groups to get a quiz.'
        : 'No bird observations match these filters. Try a bigger place, more months, or other groups.');
    }
    state.pool = species;
    state.base = base;
    state.session = { answered: 0, correct: 0, streak: 0, recent: [] };
    state.prepared = null;
    document.querySelectorAll('.tab').forEach((t) => (t.disabled = false));
    showView('quiz');
    updateScore();
    await nextQuestion();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start training';
  }
});

// ================= quiz =================

function mediaKindForQuestion() {
  const m = state.filters.media;
  if (m === 'mixed') return Math.random() < 0.5 ? 'photo' : 'sound';
  return m;
}

async function prepareQuestion() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const species = pickSpecies(state.pool, state.session.recent);
    let kind = mediaKindForQuestion();
    let obs = await getExample(species.id, kind, state.base);
    if (!obs && state.filters.media === 'mixed') {
      kind = kind === 'photo' ? 'sound' : 'photo';
      obs = await getExample(species.id, kind, state.base);
    }
    if (!obs) {
      state.session.recent.push(species.id);
      continue;
    }
    speciesDetails(species.id); // warm the cache for family hints & the answer card
    preloadMedia(obs, kind);
    return { species, kind, obs };
  }
  throw new Error("Couldn't load observations from iNaturalist. Check your connection and try again.");
}

function preloadMedia(obs, kind) {
  if (kind === 'photo' && obs.photos?.[0]) new Image().src = photoUrl(obs.photos[0]);
}

function flattenMedia(examples) {
  const items = [];
  for (const ex of examples) {
    if (ex.kind === 'photo') {
      for (const p of ex.obs.photos || []) if (p.url) items.push({ kind: 'photo', obs: ex.obs, media: p });
    } else {
      for (const s of ex.obs.sounds || []) if (s.file_url) items.push({ kind: 'sound', obs: ex.obs, media: s });
    }
  }
  return items;
}

async function nextQuestion() {
  $('#reveal').hidden = true;
  $('#answer-area').replaceChildren();
  $('#hint-buttons').replaceChildren();
  $('#hint-list').replaceChildren();
  $('#attribution').textContent = '';
  $('#stage-nav').hidden = true;
  $('#stage').replaceChildren(el('div', { class: 'loading' }, 'Loading…'));

  let prepared;
  try {
    prepared = state.prepared ? await state.prepared : await prepareQuestion();
  } catch (err) {
    state.prepared = null;
    $('#stage').replaceChildren(
      el('div', { class: 'loading error' }, err.message, el('br'),
        el('button', { class: 'secondary', onclick: nextQuestion }, 'Try again')),
    );
    return;
  }
  state.prepared = null;

  const { species, kind, obs } = prepared;
  state.session.recent.push(species.id);
  if (state.session.recent.length > 10) state.session.recent.shift();

  state.q = {
    species,
    kind,
    examples: [{ kind, obs }],
    items: flattenMedia([{ kind, obs }]),
    index: 0,
    revealed: new Set(),
    hintsUsed: 0,
    answered: false,
    choices: state.filters.answer === 'type' ? null : buildChoices(species, state.pool, Number(state.filters.answer), state.filters.difficulty),
  };
  renderStage();
  renderHints();
  renderAnswerArea();
}

function currentItem() {
  return state.q.items[state.q.index];
}

function renderStage() {
  const q = state.q;
  const item = currentItem();
  const stage = $('#stage');
  if (!item) {
    stage.replaceChildren(el('div', { class: 'loading' }, 'No media'));
    return;
  }
  if (item.kind === 'photo') {
    const img = el('img', { src: photoUrl(item.media), alt: 'Mystery bird', class: 'stage-img' });
    img.addEventListener('error', () => {
      if (!img.dataset.fallback) {
        img.dataset.fallback = '1';
        img.src = photoUrl(item.media, 'medium');
      }
    });
    stage.replaceChildren(img);
  } else {
    const audio = el('audio', { controls: true, preload: 'auto', src: item.media.file_url, class: 'stage-audio' });
    stage.replaceChildren(el('div', { class: 'sound-stage' }, el('div', { class: 'sound-icon', 'aria-hidden': 'true' }, '🔊'), audio));
    audio.play().catch(() => { /* autoplay blocked: user presses play */ });
  }
  $('#attribution').textContent = item.media.attribution || '';
  const nav = $('#stage-nav');
  nav.hidden = q.items.length < 2;
  const exampleNo = q.examples.findIndex((e) => e.obs === item.obs) + 1;
  const kindWord = item.kind === 'photo' ? 'photo' : 'recording';
  $('#media-counter').textContent = `${q.index + 1} of ${q.items.length} (${kindWord})` +
    (q.examples.length > 1 ? ` · observation ${exampleNo} of ${q.examples.length}` : '');
  $('#prev-media').disabled = q.index === 0;
  $('#next-media').disabled = q.index >= q.items.length - 1;
  if (q.revealed.size) renderHintList();
}

function moveMedia(delta) {
  const q = state.q;
  if (!q) return;
  const i = q.index + delta;
  if (i < 0 || i >= q.items.length) return;
  q.index = i;
  renderStage();
}
$('#prev-media').addEventListener('click', () => moveMedia(-1));
$('#next-media').addEventListener('click', () => moveMedia(1));

// ----- hints -----

const HINTS = [
  { id: 'location', label: 'Location', obsLevel: true },
  { id: 'season', label: 'Date', obsLevel: true },
  { id: 'lifeStage', label: 'Age / life stage', obsLevel: true },
  { id: 'sex', label: 'Sex', obsLevel: true },
  { id: 'family', label: 'Family' },
  { id: 'genus', label: 'Genus' },
  { id: 'letter', label: 'First letter' },
];

async function hintValue(id, item) {
  const q = state.q;
  const sp = q.species;
  const obs = item.obs;
  switch (id) {
    case 'location':
      return obs.place_guess || null;
    case 'season': {
      const month = seasonOf(obs);
      if (!month) return null;
      const year = obs.observed_on ? obs.observed_on.slice(0, 4) : '';
      return `${month} ${year}`.trim();
    }
    case 'lifeStage': {
      const a = (await annotationsFor(obs)).find((p) => /life stage/i.test(p.attr));
      return a ? a.value : null;
    }
    case 'sex': {
      const a = (await annotationsFor(obs)).find((p) => /^sex$/i.test(p.attr));
      return a ? a.value : null;
    }
    case 'family': {
      const fam = ancestorAtRank(await speciesDetails(sp.id), 'family');
      return fam ? (fam.common ? `${fam.common} (${fam.name})` : fam.name) : null;
    }
    case 'genus':
      return sp.name.split(' ')[0];
    case 'letter': {
      const name = sp.common || sp.name;
      const words = name.split(/\s+/).map((w) => w.replace(/[^A-Za-z-']/g, ''));
      return `Starts with “${name[0].toUpperCase()}”, ${words.length} word${words.length > 1 ? 's' : ''} (${words.map((w) => w.length).join(' + ')} letters)`;
    }
    default:
      return null;
  }
}

async function renderHints() {
  const q = state.q;
  const box = $('#hint-buttons');
  const buttons = [el('span', { class: 'hint-label' }, 'Hints:')];
  for (const h of HINTS) {
    buttons.push(el('button', {
      class: 'hint-btn',
      'data-hint': h.id,
      disabled: q.revealed.has(h.id) || q.answered,
      onclick: () => revealHint(h.id),
    }, h.label));
  }
  buttons.push(el('button', {
    class: 'hint-btn',
    disabled: q.answered,
    onclick: (e) => addExample(q.kind, e.currentTarget),
  }, q.kind === 'photo' ? 'Another observation' : 'Another recording'));
  buttons.push(el('button', {
    class: 'hint-btn',
    disabled: q.answered,
    onclick: (e) => addExample(q.kind === 'photo' ? 'sound' : 'photo', e.currentTarget),
  }, q.kind === 'photo' ? 'Hear it' : 'See it'));
  box.replaceChildren(...buttons);

  // Hide obs-level hints that have no data for any of this question's observations.
  const token = q;
  for (const h of HINTS.filter((x) => x.obsLevel)) {
    const values = await Promise.all(q.items.map((it) => hintValue(h.id, it)));
    if (state.q !== token) return;
    const btn = box.querySelector(`[data-hint="${h.id}"]`);
    if (btn && !values.some(Boolean)) {
      btn.disabled = true;
      btn.title = 'Not recorded for this observation';
      btn.classList.add('na');
    }
  }
}

function revealHint(id) {
  const q = state.q;
  if (q.answered || q.revealed.has(id)) return;
  q.revealed.add(id);
  q.hintsUsed += 1;
  const btn = $(`#hint-buttons [data-hint="${id}"]`);
  if (btn) btn.disabled = true;
  renderHintList();
}

async function renderHintList() {
  const q = state.q;
  const item = currentItem();
  const rows = [];
  for (const h of HINTS) {
    if (!q.revealed.has(h.id)) continue;
    const value = await hintValue(h.id, item);
    rows.push(el('li', {}, el('strong', {}, `${h.label}: `), value || el('span', { class: 'muted' }, 'not recorded for this one')));
  }
  if (state.q === q) $('#hint-list').replaceChildren(...rows);
}

async function addExample(kind, btn) {
  const q = state.q;
  if (q.answered) return;
  const exclude = new Set(q.examples.map((e) => e.obs.id));
  btn.disabled = true;
  const obs = await getExample(q.species.id, kind, state.base, exclude);
  if (state.q !== q) return;
  if (!obs) {
    const msg = kind === 'sound' ? 'No recordings of this species on iNaturalist yet.' : 'No more observations available.';
    $('#hint-list').append(el('li', { class: 'muted' }, msg));
    return;
  }
  // "Hear it"/"See it" is a one-off; "Another observation" can be used again.
  if (kind === q.kind) btn.disabled = false;
  q.hintsUsed += 1;
  q.examples.push({ kind, obs });
  const firstNew = q.items.length;
  q.items = flattenMedia(q.examples);
  q.index = firstNew;
  renderStage();
}

// ----- answering -----

function renderAnswerArea() {
  const q = state.q;
  const area = $('#answer-area');
  if (q.choices) {
    area.replaceChildren(
      el('div', { class: `choices n${q.choices.length}` },
        ...q.choices.map((sp, i) =>
          el('button', { class: 'choice', 'data-id': sp.id, onclick: () => answer(sp) },
            el('kbd', {}, String(i + 1)),
            el('span', { class: 'choice-text' }, el('strong', {}, speciesLabel(sp)), sp.common ? el('small', {}, sp.name) : null)),
        )),
    );
  } else {
    const list = el('datalist', { id: 'species-names' },
      ...state.pool.flatMap((sp) => [sp.common && el('option', { value: sp.common }), el('option', { value: sp.name })].filter(Boolean)));
    const input = el('input', { type: 'text', id: 'typed-answer', list: 'species-names', placeholder: 'Type the common or scientific name', autocomplete: 'off' });
    const form = el('form', {
      class: 'typed',
      onsubmit: (e) => {
        e.preventDefault();
        if (input.value.trim()) answer(null, input.value.trim());
      },
    }, input, list, el('button', { class: 'primary', type: 'submit' }, 'Check'),
    el('button', { class: 'secondary', type: 'button', onclick: () => answer(null, '') }, "I don't know"));
    area.replaceChildren(form);
    setTimeout(() => input.focus(), 0);
  }
}

function answer(chosen, typed) {
  const q = state.q;
  if (!q || q.answered) return;
  q.answered = true;
  const correct = chosen ? chosen.id === q.species.id : matchesTyped(typed, q.species);
  recordAnswer(q.species.id, correct);
  state.session.answered += 1;
  if (correct) {
    state.session.correct += 1;
    state.session.streak += 1;
  } else {
    state.session.streak = 0;
  }
  updateScore();

  if (q.choices) {
    document.querySelectorAll('.choice').forEach((b) => {
      b.disabled = true;
      const id = Number(b.dataset.id);
      if (id === q.species.id) b.classList.add('correct');
      else if (chosen && id === chosen.id) b.classList.add('wrong');
    });
  } else {
    $('#answer-area').querySelectorAll('input, button').forEach((n) => (n.disabled = true));
  }
  document.querySelectorAll('#hint-buttons button').forEach((b) => (b.disabled = true));
  renderReveal(correct, typed);

  // Get the next question ready while the answer is being read.
  state.prepared = prepareQuestion();
  state.prepared.catch(() => {});
}

function updateScore() {
  const s = state.session;
  const pct = s.answered ? Math.round((100 * s.correct) / s.answered) : 0;
  $('#score').textContent = `${s.correct} / ${s.answered} correct${s.answered ? ` (${pct}%)` : ''}`;
  $('#streak').textContent = s.streak >= 3 ? `🔥 ${s.streak} in a row` : '';
  $('#pool-info').textContent = `${state.pool.length} species in play`;
}

async function renderReveal(correct, typed) {
  const q = state.q;
  const sp = q.species;
  const box = $('#reveal');
  const obs = q.examples[0].obs;
  const s = getStats(sp.id);
  const typedNote = typed !== undefined && !correct
    ? el('p', { class: 'muted' }, typed ? `You typed “${typed}”.` : 'Skipped.')
    : null;
  const when = [seasonOf(obs), obs.observed_on?.slice(0, 4)].filter(Boolean).join(' ');
  const where = obs.place_guess;
  const summary = el('p', { class: 'wiki muted' }, '…');
  const familyLine = el('p', { class: 'muted' });
  const nextBtn = el('button', { class: 'primary big', id: 'next-btn', onclick: nextQuestion }, 'Next bird →');

  box.className = `reveal ${correct ? 'good' : 'bad'}`;
  box.replaceChildren(
    el('h3', {}, correct ? '✓ Correct!' : '✗ Not quite'),
    el('div', { class: 'reveal-body' },
      sp.photoMedium ? el('img', { src: sp.photoMedium, alt: sp.common || sp.name, class: 'reveal-img' }) : null,
      el('div', {},
        el('p', { class: 'reveal-name' }, el('strong', {}, sp.common || sp.name), sp.common ? el('em', {}, ` ${sp.name}`) : null),
        familyLine,
        typedNote,
        el('p', {}, `This observation: ${[where, when].filter(Boolean).join(', ') || 'no location/date shared'}.`),
        summary,
        el('p', { class: 'small' },
          el('a', { href: `https://www.inaturalist.org/taxa/${sp.id}`, target: '_blank', rel: 'noopener' }, 'Species on iNaturalist'),
          ' · ',
          el('a', { href: `https://www.inaturalist.org/observations/${obs.id}`, target: '_blank', rel: 'noopener' }, 'This observation'),
          ' · ',
          `You: ${s.correct}/${s.seen} on this species`,
          q.hintsUsed ? ` · ${q.hintsUsed} hint${q.hintsUsed > 1 ? 's' : ''} used` : ''),
      )),
    nextBtn,
  );
  box.hidden = false;
  nextBtn.focus({ preventScroll: true });
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const details = await speciesDetails(sp.id);
  if (state.q !== q) return;
  const fam = ancestorAtRank(details, 'family');
  familyLine.textContent = fam ? `Family: ${fam.common ? `${fam.common} (${fam.name})` : fam.name}` : '';
  const text = stripHtml(details?.wikipedia_summary || '');
  summary.textContent = text.length > 420 ? `${text.slice(0, 420).replace(/\s+\S*$/, '')}…` : text;
}

// ----- keyboard -----

document.addEventListener('keydown', (e) => {
  if (!$('#view-quiz').classList.contains('active') || !state.q) return;
  if (e.target.matches('input, textarea, select') && e.key !== 'Enter') return;
  if (e.target.matches('input') && e.key === 'Enter') return; // form handles it
  const q = state.q;
  if (e.key === 'ArrowLeft') moveMedia(-1);
  else if (e.key === 'ArrowRight') moveMedia(1);
  else if (e.key === ' ') {
    const audio = $('#stage audio');
    if (audio) {
      e.preventDefault();
      audio.paused ? audio.play() : audio.pause();
    }
  } else if (e.key === 'Enter' && q.answered) {
    e.preventDefault();
    nextQuestion();
  } else if (/^[1-8]$/.test(e.key) && q.choices && !q.answered) {
    const sp = q.choices[Number(e.key) - 1];
    if (sp) answer(sp);
  }
});

// ================= species list =================

function renderSpeciesGrid() {
  $('#species-summary').textContent = `${state.pool.length} species match your filters (most observed first). Click one to open it on iNaturalist.`;
  $('#species-grid').replaceChildren(
    ...state.pool.map((sp) => {
      const s = getStats(sp.id);
      return el('a', { class: 'species-card', href: `https://www.inaturalist.org/taxa/${sp.id}`, target: '_blank', rel: 'noopener' },
        sp.photoMedium ? el('img', { src: sp.photoMedium, alt: '', loading: 'lazy' }) : el('div', { class: 'no-img' }),
        el('div', { class: 'species-meta' },
          el('strong', {}, sp.common || sp.name),
          el('em', {}, sp.name),
          el('small', {}, `${sp.count.toLocaleString()} obs · ${s.seen ? `${s.correct}/${s.seen} right` : 'not quizzed yet'}`)));
    }),
  );
}

$('#reset-stats').addEventListener('click', () => {
  if (!confirm('Forget your per-species results? This resets which birds get extra practice.')) return;
  resetStats();
  renderSpeciesGrid();
});

// ================= init =================

renderPlaces();
renderMonths();
renderIncludes();
renderExcludes();
