// Random kitties from TheCatAPI (free, no key needed), with cataas.com as a fallback.
const API = 'https://api.thecatapi.com/v1/images/search?mime_types=jpg,png&size=med';

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** A batch of kitty image URLs for the picker. */
async function pool(count = 10) {
  const list = await fetchJson(`${API}&limit=${count}`);
  return list.map((c) => c.url).filter(Boolean).slice(0, count);
}

/** One kitty for the daily delivery. Tries a few times, then falls back. */
async function random() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [cat] = await fetchJson(API);
      if (cat && cat.url) return cat.url;
    } catch (e) {
      console.warn(`TheCatAPI attempt ${attempt} failed:`, e.message);
    }
  }
  return `https://cataas.com/cat?width=900&t=${Date.now()}`;
}

module.exports = { pool, random };
