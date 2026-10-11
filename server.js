// Daily Kitty: a cute kitty every day, plus a secret sweetie panel for sending photos and love notes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store, load, persist, saveImage, getImage } = require('./lib/store');
const push = require('./lib/push');
const cats = require('./lib/cats');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TIME_ZONE = process.env.TIME_ZONE || 'Europe/London';
const DAILY_HOUR = Number(process.env.DAILY_HOUR || 9);
// If you sent a kitty by hand this recently, the daily one is skipped so yours stays up.
const KEEP_HAND_SENT_HOURS = 6;

const DAILY_TITLES = ['Your daily kitty is here 🐱', 'Kitty delivery! 📦🐾', "Meow! Today's kitty 😺", 'A wild kitty appeared ✨'];
const DAILY_BODIES = [
  "Good morning! Tap to meet today's kitty ☀️",
  'This one wanted to say hi 💕',
  'Fresh kitty, just for you 🐾',
  'Your daily dose of cute has arrived 🥰',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- HTTP helpers ----------

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Too big'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Sweetie (sender) auth ----------
// The first passphrase entered in the app becomes the sender passphrase (or set SENDER_PASSPHRASE).

function hashPassphrase(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32).toString('hex');
}

const failedAttempts = new Map(); // ip -> [timestamps]
function tooManyAttempts(ip) {
  const recent = (failedAttempts.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
  failedAttempts.set(ip, recent);
  return recent.length >= 10;
}

function unlock(passphrase, ip) {
  passphrase = cleanText(passphrase, 200);
  if (passphrase.length < 4) throw new HttpError(400, 'Passphrase too short');
  if (tooManyAttempts(ip)) throw new HttpError(429, 'Too many tries, wait a bit');

  let created = false;
  if (process.env.SENDER_PASSPHRASE) {
    const ok = sha(passphrase) === sha(process.env.SENDER_PASSPHRASE.trim());
    if (!ok) return fail(ip);
  } else if (!store.db.sender) {
    const salt = crypto.randomBytes(16).toString('hex');
    store.db.sender = { salt, hash: hashPassphrase(passphrase, salt) };
    created = true;
  } else {
    const { salt, hash } = store.db.sender;
    const ok = crypto.timingSafeEqual(Buffer.from(hashPassphrase(passphrase, salt), 'hex'), Buffer.from(hash, 'hex'));
    if (!ok) return fail(ip);
  }

  const token = crypto.randomBytes(24).toString('hex');
  store.db.tokens = [...store.db.tokens, sha(token)].slice(-10);
  persist();
  return { ok: true, token, created };
}

function fail(ip) {
  failedAttempts.get(ip).push(Date.now());
  return { ok: false };
}

function isSender(req) {
  const token = req.headers['x-sweetie-token'];
  return typeof token === 'string' && token.length > 0 && store.db.tokens.includes(sha(token));
}

function requireSender(req) {
  if (!isSender(req)) throw new HttpError(403, 'Not allowed');
}

// ---------- Kitties & notes ----------

function localDay(now = Date.now()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function publishKitty({ imageUrl, caption, sentBy, source, title, body }) {
  const kitty = { imageUrl, caption, sentBy, source, sentAt: Date.now() };
  store.db.current = kitty;
  store.db.history = [kitty, ...store.db.history].slice(0, 1000);
  persist();
  // You don't get notified about a kitty you sent yourself.
  const results = await push.send(
    { type: 'kitty', title, body, image: imageUrl, tag: 'kitty' },
    (sub) => !(sentBy === 'sweetie' && sub.role === 'sender')
  );
  console.log(`Kitty published (${sentBy}/${source}), pushed to ${results.filter((r) => r.ok).length} phone(s)`);
  return kitty;
}

let dailyRunning = null;
function maybeDaily() {
  if (!dailyRunning) dailyRunning = runDaily().finally(() => (dailyRunning = null));
  return dailyRunning;
}

async function runDaily() {
  const { date, hour } = localDay();
  if (store.db.lastDaily === date) return 'already-sent';
  if (hour < DAILY_HOUR) return 'too-early';

  const cur = store.db.current;
  if (cur && cur.sentBy === 'sweetie' && Date.now() - cur.sentAt < KEEP_HAND_SENT_HOURS * 3600_000) {
    store.db.lastDaily = date;
    persist();
    return 'kept-hand-sent';
  }
  const imageUrl = await cats.random();
  store.db.lastDaily = date;
  await publishKitty({ imageUrl, caption: '', sentBy: 'daily', source: 'daily', title: pick(DAILY_TITLES), body: pick(DAILY_BODIES) });
  return 'sent';
}

const ALLOWED_IMAGE = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

async function sendKitty(body) {
  const caption = cleanText(body.caption, 150);
  let imageUrl;
  let source;
  if (typeof body.image === 'string' && body.image.startsWith('data:')) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(body.image);
    if (!m || !ALLOWED_IMAGE[m[1]]) throw new HttpError(400, 'Unsupported image');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 6 * 1024 * 1024) throw new HttpError(400, 'Image empty or too large');
    imageUrl = `/img/${await saveImage(m[1], buf)}`;
    source = 'gallery';
  } else if (typeof body.imageUrl === 'string' && /^https:\/\/\S+$/.test(body.imageUrl)) {
    imageUrl = body.imageUrl;
    source = 'pool';
  } else {
    throw new HttpError(400, 'Send an image or an imageUrl');
  }
  return publishKitty({
    imageUrl,
    caption,
    sentBy: 'sweetie',
    source,
    title: '💌 Your sweetie sent you a kitty!',
    body: caption || 'Tap to see it 🐱',
  });
}

async function sendNote(body) {
  const message = cleanText(body.message, 200);
  if (!message) throw new HttpError(400, 'Empty note');
  const note = { message, sentAt: Date.now() };
  store.db.note = note;
  store.db.notes = [note, ...store.db.notes].slice(0, 1000);
  persist();
  const results = await push.send({ type: 'note', title: '💌 From your sweetie', body: message, tag: 'note' }, (sub) => sub.role !== 'sender');
  return { ok: true, delivered: results.filter((r) => r.ok).length };
}

function publicState(req) {
  return {
    current: store.db.current,
    note: store.db.note,
    vapidKey: push.publicKey(),
    isSender: isSender(req),
  };
}

// ---------- Routing ----------

async function api(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case 'GET /api/health':
      return send(res, 200, { ok: true, storage: store.label });

    case 'GET /api/state':
      // Opening the app after the daily hour also delivers the daily kitty if nothing else did.
      await Promise.race([maybeDaily().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
      return send(res, 200, publicState(req));

    case 'GET /api/daily':
    case 'POST /api/daily':
      return send(res, 200, { status: await maybeDaily() });

    case 'POST /api/subscribe': {
      const body = await readJson(req, 20000);
      const ok = push.subscribe(body.subscription, isSender(req) ? 'sender' : 'sweetie');
      return send(res, ok ? 200 : 400, { ok });
    }

    case 'POST /api/unlock': {
      const body = await readJson(req, 5000);
      return send(res, 200, unlock(body.passphrase, ip));
    }

    case 'POST /api/lock': {
      const token = req.headers['x-sweetie-token'];
      if (typeof token === 'string') store.db.tokens = store.db.tokens.filter((t) => t !== sha(token));
      persist();
      return send(res, 200, { ok: true });
    }

    case 'GET /api/pool':
      requireSender(req);
      return send(res, 200, { urls: await cats.pool(9) });

    case 'POST /api/send-kitty': {
      requireSender(req);
      const body = await readJson(req, 9 * 1024 * 1024);
      return send(res, 200, { ok: true, current: await sendKitty(body) });
    }

    case 'POST /api/send-note': {
      requireSender(req);
      return send(res, 200, await sendNote(await readJson(req, 5000)));
    }

    case 'GET /api/history':
      return send(res, 200, { history: store.db.history.slice(0, 60) });
  }
  throw new HttpError(404, 'Not found');
}

async function image(res, id) {
  const img = /^[a-z0-9]+$/.test(id) ? await getImage(id) : null;
  if (!img) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(img.data);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths open the app.
      if (!path.extname(pathname)) return serveStatic(res, '/');
      res.writeHead(404);
      return res.end();
    }
    const ext = path.extname(file);
    const longCache = ext === '.png';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/img/')) return await image(res, url.pathname.slice(5));
    return serveStatic(res, url.pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
  }
});

load()
  .then(() => {
    push.init();
    server.listen(PORT, () => console.log(`Daily Kitty on http://localhost:${PORT} (storage: ${store.label})`));
    // While awake, check for the daily kitty every few minutes.
    setInterval(() => maybeDaily().catch((e) => console.error('Daily kitty failed:', e)), 5 * 60_000);
    maybeDaily().catch((e) => console.error('Daily kitty failed:', e));
  })
  .catch((e) => {
    console.error('Could not load data:', e);
    process.exit(1);
  });
