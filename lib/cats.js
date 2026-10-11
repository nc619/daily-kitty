// The kitty pool: hand-picked photos (lib/cat-pool.json, from Wikimedia Commons), plus any you add
// in the app, minus any you remove. TheCatAPI (photos only, no GIFs) is the fallback.
const { store, persist } = require('./store');
const SEED = require('./cat-pool.json');

const API = 'https://api.thecatapi.com/v1/images/search?mime_types=jpg,png&size=med';
const isPhoto = (url) => /\.(jpe?g|png)(\?|$)/i.test(url);

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function curated() {
  const removed = new Set(store.db.pool.removed);
  const all = [...store.db.pool.added, ...SEED];
  const seen = new Set();
  return all.filter((c) => !removed.has(c.url) && !seen.has(c.url) && seen.add(c.url));
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fromApi(count) {
  try {
    const list = await fetchJson(`${API}&limit=10`);
    return list.filter((c) => c.url && isPhoto(c.url)).slice(0, count).map((c) => ({ url: c.url, credit: 'TheCatAPI' }));
  } catch (e) {
    console.warn('TheCatAPI failed:', e.message);
    return [];
  }
}

/** Kitties for the picker: unused curated ones first. */
async function pool(count = 12) {
  const used = new Set(store.db.pool.used);
  const list = curated();
  const fresh = shuffle(list.filter((c) => !used.has(c.url)));
  const picked = [...fresh, ...shuffle(list.filter((c) => used.has(c.url)))].slice(0, count);
  if (picked.length < count) picked.push(...(await fromApi(count - picked.length)));
  return picked;
}

/** One kitty for the daily delivery, never repeating until the whole pool has been shown. */
async function random() {
  const used = new Set(store.db.pool.used);
  let fresh = curated().filter((c) => !used.has(c.url));
  if (!fresh.length && curated().length) {
    store.db.pool.used = [];
    fresh = curated();
  }
  if (fresh.length) return shuffle(fresh)[0];
  const [api] = await fromApi(1);
  return api || { url: `https://cataas.com/cat?width=900&t=${Date.now()}`, credit: 'cataas.com' };
}

function markUsed(url) {
  if (!store.db.pool.used.includes(url)) {
    store.db.pool.used.push(url);
    persist();
  }
}

function add(url, credit) {
  store.db.pool.added.unshift({ url, credit: credit || 'Added by you' });
  store.db.pool.removed = store.db.pool.removed.filter((u) => u !== url);
  persist();
}

function remove(url) {
  if (!store.db.pool.removed.includes(url)) store.db.pool.removed.push(url);
  store.db.pool.added = store.db.pool.added.filter((c) => c.url !== url);
  persist();
}

const stats = () => ({ total: curated().length, used: store.db.pool.used.length });

module.exports = { pool, random, markUsed, add, remove, stats };
