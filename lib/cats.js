// The kitty pool: hand-picked photos (lib/cat-pool.json, from Wikimedia Commons), high-quality
// photos from Pexels and Unsplash (when PEXELS_API_KEY / UNSPLASH_ACCESS_KEY are set), plus any you
// add in the app, minus any you remove. TheCatAPI (photos only, no GIFs) is the last fallback.
const { store, persist } = require('./store');
const SEED = require('./cat-pool.json');

const API = 'https://api.thecatapi.com/v1/images/search?mime_types=jpg,png&size=med';
const isPhoto = (url) => /\.(jpe?g|png)(\?|$)/i.test(url);

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Pexels & Unsplash ----------

const PEXELS_KEY = (process.env.PEXELS_API_KEY || '').trim();
const UNSPLASH_KEY = (process.env.UNSPLASH_ACCESS_KEY || '').trim();
const NOT_JUST_CATS = /\b(woman|man|girl|boy|person|people|child|kid|baby|hand|hands|holding|dog|puppy|toy|illustration|drawing|cartoon|statue|food)\b/i;
const REFRESH_DAYS = 7;

async function fromPexels() {
  const out = [];
  for (const query of ['cute kitten', 'kitten sleeping', 'fluffy kitten', 'kitten playing', 'adorable cat']) {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=80`, {
      headers: { Authorization: PEXELS_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
    const data = await res.json();
    for (const p of data.photos || []) {
      if (NOT_JUST_CATS.test(p.alt || '')) continue;
      out.push({ url: p.src.large2x || p.src.large, credit: `${p.photographer} · Pexels`, page: p.url, source: 'pexels' });
    }
  }
  return out;
}

async function fromUnsplash() {
  const out = [];
  for (const query of ['cute kitten', 'kitten', 'sleepy kitten']) {
    for (const page of [1, 2]) {
      const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&page=${page}&content_filter=high`, {
        headers: { Authorization: `Client-ID ${UNSPLASH_KEY}`, 'Accept-Version': 'v1' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
      const data = await res.json();
      for (const p of data.results || []) {
        if (p.premium || p.plus || NOT_JUST_CATS.test(`${p.alt_description || ''} ${p.description || ''}`)) continue;
        out.push({
          url: p.urls.regular,
          credit: `${p.user && p.user.name} · Unsplash`,
          page: p.links && p.links.html,
          source: 'unsplash',
          ping: p.links && p.links.download_location, // Unsplash asks to be told when a photo is used
        });
      }
    }
  }
  return out;
}

/** Refreshes the Pexels / Unsplash part of the pool about once a week. */
async function refreshExternal(force = false) {
  if (!PEXELS_KEY && !UNSPLASH_KEY) return;
  const pool = store.db.pool;
  if (!force && pool.externalAt && Date.now() - pool.externalAt < REFRESH_DAYS * 864e5) return;
  const found = [];
  for (const [name, fn, enabled] of [['Pexels', fromPexels, PEXELS_KEY], ['Unsplash', fromUnsplash, UNSPLASH_KEY]]) {
    if (!enabled) continue;
    try {
      const list = await fn();
      console.log(`${name}: ${list.length} kitties`);
      found.push(...list);
    } catch (e) {
      console.warn(`${name} refresh failed:`, e.message);
    }
  }
  if (found.length) {
    // Keep what we had (so nothing repeats) and add the new ones.
    const known = new Set((pool.external || []).map((c) => c.url));
    pool.external = [...(pool.external || []), ...found.filter((c) => !known.has(c.url))].slice(-3000);
    pool.externalAt = Date.now();
    persist();
  }
}

const sources = () => ({ pexels: !!PEXELS_KEY, unsplash: !!UNSPLASH_KEY, external: (store.db.pool.external || []).length });

// ---------- Pool ----------

function curated() {
  const removed = new Set(store.db.pool.removed);
  const all = [...store.db.pool.added, ...(store.db.pool.external || []), ...SEED];
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
  const ext = (store.db.pool.external || []).find((c) => c.url === url);
  if (ext && ext.ping && UNSPLASH_KEY) {
    fetch(ext.ping, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }).catch(() => {});
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

const stats = () => ({ total: curated().length, used: store.db.pool.used.length, ...sources() });

module.exports = { pool, random, markUsed, add, remove, stats, refreshExternal, sources };
