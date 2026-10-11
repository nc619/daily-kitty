// Storage: one JSON object plus uploaded media (photos, videos, music, drawings),
// in PostgreSQL (if DATABASE_URL) or in local files.
// Media is stored in 1 MB chunks so big videos never need to fit in memory.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATABASE_URL = process.env.DATABASE_URL;
const CHUNK = 1024 * 1024;
const VERSION = 2;

function empty() {
  return {
    version: VERSION,
    vapid: null,
    sender: null, // { salt, hash } of the passphrase that unlocks his side
    tokens: [], // hashes of his session tokens
    herKey: crypto.randomBytes(12).toString('hex'), // her private link
    unlocked: false, // her full app (set when she opens a gift, or by him)
    current: null, // today's kitty: { postId, imageUrl, caption, sentBy, from, source, sentAt }
    posts: [], // memories: { id, kind, from, url, mime, mediaId, caption, at, credit, giftId }
    notes: [], // { id, message, from, at }
    gifts: [], // { id, mediaId, mime, musicId, title, message, status, createdAt, sentAt, openedAt }
    events: [], // calendar: { id, type, title, start, end, time, notes, yearly, by, createdAt }
    togetherSince: null, // 'YYYY-MM-DD'
    subs: [], // { endpoint, keys, role: 'him' | 'her', updatedAt }
    tz: {}, // { him: 'Europe/London', her: 'Europe/Paris' }
    pool: { added: [], removed: [], used: [] },
    lastDaily: null, // 'YYYY-MM-DD' in TIME_ZONE
    lastDigest: null,
  };
}

// v1 → v2: history becomes posts, roles get clearer names.
function migrateV1(data) {
  const db = { ...empty(), ...data, version: VERSION };
  db.posts = (data.history || []).map((h) => ({
    id: crypto.randomBytes(9).toString('hex'),
    kind: h.source === 'gallery' ? 'photo' : 'kitty',
    from: h.sentBy === 'sweetie' ? 'him' : 'daily',
    url: h.imageUrl,
    mime: 'image/jpeg',
    caption: h.caption || '',
    at: h.sentAt,
  }));
  db.notes = (data.notes || []).map((n) => ({ id: crypto.randomBytes(9).toString('hex'), message: n.message, from: 'him', at: n.sentAt }));
  if (data.current) db.current = { ...data.current, from: data.current.sentBy === 'sweetie' ? 'him' : 'daily', postId: db.posts[0] && db.posts[0].id };
  db.subs = (data.subs || []).map((s) => ({ ...s, role: s.role === 'sender' ? 'him' : 'her' }));
  delete db.history;
  delete db.note;
  return db;
}

function fileStorage() {
  const dbFile = path.join(DATA_DIR, 'db.json');
  const mediaDir = path.join(DATA_DIR, 'media');
  const imgDir = path.join(DATA_DIR, 'images');
  const dir = (id) => path.join(mediaDir, id);
  return {
    label: dbFile,
    async load() {
      try {
        return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async save(data) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(dbFile + '.tmp', data);
      fs.renameSync(dbFile + '.tmp', dbFile);
    },
    async createMedia(id, meta) {
      fs.mkdirSync(dir(id), { recursive: true });
      fs.writeFileSync(path.join(dir(id), 'meta.json'), JSON.stringify(meta));
    },
    async putChunk(id, idx, buf) {
      fs.writeFileSync(path.join(dir(id), `${idx}.bin`), buf);
    },
    async setMeta(id, meta) {
      fs.writeFileSync(path.join(dir(id), 'meta.json'), JSON.stringify(meta));
    },
    async getMeta(id) {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir(id), 'meta.json'), 'utf8'));
      } catch {
        return null;
      }
    },
    async getChunk(id, idx) {
      return fs.readFileSync(path.join(dir(id), `${idx}.bin`));
    },
    async countChunks(id) {
      return fs.readdirSync(dir(id)).filter((f) => f.endsWith('.bin')).length;
    },
    async removeMedia(id) {
      fs.rmSync(dir(id), { recursive: true, force: true });
    },
    async totalSize() {
      if (!fs.existsSync(mediaDir)) return 0;
      let n = 0;
      for (const id of fs.readdirSync(mediaDir)) {
        const m = await this.getMeta(id);
        if (m && m.complete) n += m.size;
      }
      return n;
    },
    async getLegacyImage(id) {
      try {
        return { mime: fs.readFileSync(path.join(imgDir, id + '.type'), 'utf8'), data: fs.readFileSync(path.join(imgDir, id)) };
      } catch {
        return null;
      }
    },
  };
}

function pgStorage() {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  return {
    label: 'PostgreSQL',
    async load() {
      await pool.query('CREATE TABLE IF NOT EXISTS kitty_store (id int PRIMARY KEY, data text NOT NULL)');
      await pool.query('CREATE TABLE IF NOT EXISTS kitty_images (id text PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz DEFAULT now())');
      await pool.query(`CREATE TABLE IF NOT EXISTS kitty_media (
        id text PRIMARY KEY, mime text NOT NULL, size bigint NOT NULL, name text, complete boolean NOT NULL DEFAULT false,
        created_at timestamptz DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS kitty_media_chunks (
        media_id text NOT NULL, idx int NOT NULL, data bytea NOT NULL, PRIMARY KEY (media_id, idx))`);
      const r = await pool.query('SELECT data FROM kitty_store WHERE id = 1');
      return r.rows[0] ? JSON.parse(r.rows[0].data) : null;
    },
    async save(data) {
      await pool.query('INSERT INTO kitty_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [data]);
    },
    async createMedia(id, meta) {
      await pool.query('INSERT INTO kitty_media (id, mime, size, name) VALUES ($1, $2, $3, $4)', [id, meta.mime, meta.size, meta.name || null]);
    },
    async putChunk(id, idx, buf) {
      await pool.query(
        'INSERT INTO kitty_media_chunks (media_id, idx, data) VALUES ($1, $2, $3) ON CONFLICT (media_id, idx) DO UPDATE SET data = EXCLUDED.data',
        [id, idx, buf]
      );
    },
    async setMeta(id, meta) {
      await pool.query('UPDATE kitty_media SET complete = $2 WHERE id = $1', [id, !!meta.complete]);
    },
    async getMeta(id) {
      const r = await pool.query('SELECT mime, size, name, complete FROM kitty_media WHERE id = $1', [id]);
      return r.rows[0] ? { ...r.rows[0], size: Number(r.rows[0].size) } : null;
    },
    async getChunk(id, idx) {
      const r = await pool.query('SELECT data FROM kitty_media_chunks WHERE media_id = $1 AND idx = $2', [id, idx]);
      return r.rows[0] ? r.rows[0].data : null;
    },
    async countChunks(id) {
      const r = await pool.query('SELECT count(*)::int AS n FROM kitty_media_chunks WHERE media_id = $1', [id]);
      return r.rows[0].n;
    },
    async removeMedia(id) {
      await pool.query('DELETE FROM kitty_media_chunks WHERE media_id = $1', [id]);
      await pool.query('DELETE FROM kitty_media WHERE id = $1', [id]);
    },
    async totalSize() {
      const r = await pool.query('SELECT coalesce(sum(size), 0)::bigint AS n FROM kitty_media WHERE complete');
      return Number(r.rows[0].n);
    },
    async getLegacyImage(id) {
      const r = await pool.query('SELECT mime, data FROM kitty_images WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
  };
}

const storage = DATABASE_URL ? pgStorage() : fileStorage();
const store = { db: empty(), label: storage.label };

async function load() {
  const data = await storage.load();
  if (!data) return persist();
  store.db = data.version === VERSION ? { ...empty(), ...data } : migrateV1(data);
  if (data.version !== VERSION) {
    console.log('Data migrated to v2');
    persist();
  }
}

// Saves are chained so they never overlap, and grouped when several changes happen at once.
let saving = Promise.resolve();
let pending = false;
function persist() {
  if (pending) return saving;
  pending = true;
  saving = saving.then(async () => {
    pending = false;
    try {
      await storage.save(JSON.stringify(store.db));
    } catch (e) {
      console.error('Save failed:', e.message);
    }
  });
  return saving;
}

const newId = (bytes = 12) => crypto.randomBytes(bytes).toString('hex');

const media = {
  CHUNK,
  async create(mime, size, name) {
    const id = newId(16);
    await storage.createMedia(id, { mime, size, name, complete: false });
    return id;
  },
  putChunk: (id, idx, buf) => storage.putChunk(id, idx, buf),
  getMeta: (id) => storage.getMeta(id),
  getChunk: (id, idx) => storage.getChunk(id, idx),
  async finish(id) {
    const meta = await storage.getMeta(id);
    if (!meta) return null;
    const expected = Math.max(1, Math.ceil(meta.size / CHUNK));
    if ((await storage.countChunks(id)) !== expected) return null;
    meta.complete = true;
    await storage.setMeta(id, meta);
    return meta;
  },
  remove: (id) => storage.removeMedia(id),
  totalSize: () => storage.totalSize(),
  getLegacyImage: (id) => storage.getLegacyImage(id),
};

module.exports = { store, load, persist, media, newId };
