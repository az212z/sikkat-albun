import { cadences, flavors, grinds, quote, weights } from './catalog.js';

const storageKey = 'sikkat-albun:demo:last-draft:v1';
const retention = 7 * 24 * 60 * 60 * 1000;
const allowed = { flavor: flavors, grind: grinds, weight: weights, cadence: cadences };

export function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (!saved || !Number.isFinite(saved.created) || typeof saved.requestKey !== 'string' ||
        !/^[A-F0-9]{16}$/.test(saved.reference) ||
        !Object.entries(allowed).every(([key, values]) => Object.hasOwn(values, saved[key]))) return null;
    if (Date.now() - saved.created > retention) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export async function saveDraft(payload) {
  const previous = loadDraft();
  if (previous?.requestKey === payload.requestKey) return previous;
  const reference = crypto.randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const saved = { ...payload, reference, price: quote(payload), created: Date.now() };
  localStorage.setItem(storageKey, JSON.stringify(saved));
  return saved;
}
