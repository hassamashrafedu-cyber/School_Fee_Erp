/**
 * In-memory page UI cache for SPA back-navigation.
 * Survives route changes within the session; cleared on logout / full reload.
 */

const cache = new Map();

export function getPageState(key) {
  if (!key) return null;
  return cache.has(key) ? cache.get(key) : null;
}

export function setPageState(key, value) {
  if (!key) return;
  if (value == null) {
    cache.delete(key);
    return;
  }
  cache.set(key, value);
}

export function clearPageState(key) {
  if (!key) {
    cache.clear();
    return;
  }
  cache.delete(key);
}

export function clearAllPageState() {
  cache.clear();
}
