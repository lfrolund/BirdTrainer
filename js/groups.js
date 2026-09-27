// Informal (often polyphyletic) bird groupings, defined as a union of scientific names.
// Names are resolved to iNaturalist taxon ids at runtime and cached, so no ids are hard-coded.
// Names iNat doesn't recognise are skipped, so a group still works if the taxonomy shifts.

import { resolveTaxonName } from './api.js';
import { load, save } from './storage.js';

export const PRESET_GROUPS = [
  { id: 'gulls', name: 'Gulls', taxa: ['Larinae'] },
  { id: 'terns', name: 'Terns', taxa: ['Sterninae'] },
  { id: 'raptors', name: 'Diurnal raptors', taxa: ['Accipitriformes', 'Falconiformes', 'Cathartiformes'] },
  { id: 'birds-of-prey', name: 'Birds of prey (incl. owls)', taxa: ['Accipitriformes', 'Falconiformes', 'Cathartiformes', 'Strigiformes'] },
  { id: 'vultures', name: 'Vultures (Old & New World)', taxa: ['Cathartidae', 'Aegypiinae', 'Gypaetinae'] },
  { id: 'owls', name: 'Owls', taxa: ['Strigiformes'] },
  { id: 'shorebirds', name: 'Shorebirds', taxa: ['Scolopacidae', 'Charadriidae', 'Haematopodidae', 'Recurvirostridae', 'Jacanidae', 'Burhinidae', 'Glareolidae'] },
  { id: 'waterfowl', name: 'Ducks, geese & swans', taxa: ['Anatidae'] },
  { id: 'tubenoses', name: 'Tubenoses (albatrosses, shearwaters, petrels)', taxa: ['Procellariiformes'] },
  { id: 'pelagic', name: 'Pelagic seabirds', taxa: ['Procellariiformes', 'Alcidae', 'Stercorariidae', 'Sulidae', 'Fregatidae', 'Phaethontidae'] },
  { id: 'diving', name: 'Diving waterbirds (loons, grebes, cormorants, auks)', taxa: ['Gaviidae', 'Podicipedidae', 'Phalacrocoracidae', 'Alcidae'] },
  { id: 'herons', name: 'Herons, egrets & bitterns', taxa: ['Ardeidae'] },
  { id: 'waders', name: 'Long-legged waders', taxa: ['Ardeidae', 'Threskiornithidae', 'Ciconiidae', 'Gruidae'] },
  { id: 'rails', name: 'Rails, gallinules & coots', taxa: ['Rallidae'] },
  { id: 'gamebirds', name: 'Gamebirds', taxa: ['Galliformes'] },
  { id: 'pigeons', name: 'Pigeons & doves', taxa: ['Columbidae'] },
  { id: 'hummingbirds', name: 'Hummingbirds', taxa: ['Trochilidae'] },
  { id: 'aerial', name: 'Swifts & swallows', taxa: ['Apodidae', 'Hirundinidae'] },
  { id: 'woodpeckers', name: 'Woodpeckers', taxa: ['Picidae'] },
  { id: 'kingfishers', name: 'Kingfishers', taxa: ['Alcedinidae'] },
  { id: 'parrots', name: 'Parrots', taxa: ['Psittaciformes'] },
  { id: 'flycatchers', name: 'Flycatchers (all)', taxa: ['Tyrannidae', 'Muscicapidae', 'Monarchidae'] },
  { id: 'corvids', name: 'Crows, jays & magpies', taxa: ['Corvidae'] },
  { id: 'tits', name: 'Tits & chickadees', taxa: ['Paridae'] },
  { id: 'wrens', name: 'Wrens', taxa: ['Troglodytidae'] },
  { id: 'thrushes', name: 'Thrushes', taxa: ['Turdidae'] },
  { id: 'warblers', name: 'Warblers (New & Old World)', taxa: ['Parulidae', 'Phylloscopidae', 'Acrocephalidae', 'Sylviidae', 'Cettiidae', 'Locustellidae', 'Cisticolidae'] },
  { id: 'vireos', name: 'Vireos', taxa: ['Vireonidae'] },
  { id: 'sparrows', name: 'Sparrows (New & Old World)', taxa: ['Passerellidae', 'Passeridae'] },
  { id: 'buntings', name: 'Buntings & longspurs', taxa: ['Emberizidae', 'Calcariidae', 'Passerina'] },
  { id: 'finches', name: 'Finches', taxa: ['Fringillidae'] },
  { id: 'icterids', name: 'Blackbirds, orioles & meadowlarks', taxa: ['Icteridae'] },
  { id: 'tanagers', name: 'Tanagers & cardinals', taxa: ['Thraupidae', 'Cardinalidae'] },
];

const RESOLVED_KEY = 'resolvedNames';
const resolved = load(RESOLVED_KEY, {});

async function resolveName(name) {
  if (resolved[name] !== undefined) return resolved[name];
  try {
    const taxon = await resolveTaxonName(name);
    resolved[name] = taxon;
    save(RESOLVED_KEY, resolved);
    return taxon;
  } catch {
    return null; // network error: don't cache, try again next time
  }
}

export function loadCustomGroups() {
  return load('customGroups', []);
}

export function saveCustomGroups(groups) {
  save('customGroups', groups);
}

export function allGroups() {
  return [...loadCustomGroups().map((g) => ({ ...g, custom: true })), ...PRESET_GROUPS];
}

export function findGroup(id) {
  return allGroups().find((g) => g.id === id) || null;
}

// Returns the taxon ids that make up a group.
export async function resolveGroup(group) {
  if (group.custom) return group.taxa.map((t) => t.id);
  const taxa = await Promise.all(group.taxa.map(resolveName));
  return taxa.filter(Boolean).map((t) => t.id);
}

export function groupSummary(group) {
  if (group.custom) return group.taxa.map((t) => t.common || t.name).join(', ');
  return group.taxa.join(', ');
}
