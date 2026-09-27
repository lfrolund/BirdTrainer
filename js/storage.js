// Small wrapper around localStorage that never throws (private mode, quota, etc).
const PREFIX = 'birdtrainer:v1:';

export function load(name, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    /* storage unavailable; settings just won't persist */
  }
}

export function remove(name) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    /* ignore */
  }
}
