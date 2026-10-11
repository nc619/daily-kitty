// Storage: one JSON object plus uploaded photos, in PostgreSQL (if DATABASE_URL) or in local files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATABASE_URL = process.env.DATABASE_URL;

function empty() {
  return {
    version: 1,
    vapid: null,
    sender: null, // { salt, hash } of the passphrase that unlocks the sweetie panel
    tokens: [], // hashes of sender session tokens
    current: null, // { imageUrl, caption, sentBy: 'daily' | 'sweetie', source, sentAt }
    note: null, // { message, sentAt }
    history: [],
    notes: [],
    subs: [], // { endpoint, keys, role: 'sweetie' | 'sender', updatedAt }
    lastDaily: null, // 'YYYY-MM-DD' in TIME_ZONE
  };
}

function fileStorage() {
  const dbFile = path.join(DATA_DIR, 'db.json');
  const imgDir = path.join(DATA_DIR, 'images');
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
    async saveImage(id, mime, buf) {
      fs.mkdirSync(imgDir, { recursive: true });
      fs.writeFileSync(path.join(imgDir, id), buf);
      fs.writeFileSync(path.join(imgDir, id + '.type'), mime);
    },
    async getImage(id) {
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
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
  return {
    label: 'PostgreSQL',
    async load() {
      await pool.query('CREATE TABLE IF NOT EXISTS kitty_store (id int PRIMARY KEY, data text NOT NULL)');
      await pool.query('CREATE TABLE IF NOT EXISTS kitty_images (id text PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz DEFAULT now())');
      const r = await pool.query('SELECT data FROM kitty_store WHERE id = 1');
      return r.rows[0] ? JSON.parse(r.rows[0].data) : null;
    },
    async save(data) {
      await pool.query('INSERT INTO kitty_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [data]);
    },
    async saveImage(id, mime, buf) {
      await pool.query('INSERT INTO kitty_images (id, mime, data) VALUES ($1, $2, $3)', [id, mime, buf]);
    },
    async getImage(id) {
      const r = await pool.query('SELECT mime, data FROM kitty_images WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
  };
}

const storage = DATABASE_URL ? pgStorage() : fileStorage();
const store = { db: empty(), label: storage.label };

async function load() {
  const data = await storage.load();
  if (data) store.db = { ...empty(), ...data };
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

async function saveImage(mime, buf) {
  const id = Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
  await storage.saveImage(id, mime, buf);
  return id;
}

const getImage = (id) => storage.getImage(id);

module.exports = { store, load, persist, saveImage, getImage };
