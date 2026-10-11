// Daily Kitty: a cute kitty every day… and, once unlocked, a little world for a long-distance couple.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store, load, persist, media, newId } = require('./lib/store');
const push = require('./lib/push');
const cats = require('./lib/cats');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TIME_ZONE = process.env.TIME_ZONE || 'Europe/London';
const DAILY_HOUR = Number(process.env.DAILY_HOUR || 9);
const MEDIA_LIMIT = media.limit; // 9.5 GB on R2 (free up to 10 GB), 900 MB in the database
// If a kitty was sent by hand this recently, the daily one is skipped so it stays up.
const KEEP_HAND_SENT_HOURS = 6;

const DAILY_TITLES = ['Your daily kitty is here 🐱', 'Kitty delivery! 📦🐾', "Meow! Today's kitty 😺", 'A wild kitty appeared ✨'];
const DAILY_BODIES = [
  "Good morning! Tap to meet today's kitty ☀️",
  'This one wanted to say hi 💕',
  'Fresh kitty, just for you 🐾',
  'Your daily dose of cute has arrived 🥰',
];
const EVENT_TYPES = { trip: '✈️', date: '🌙', special: '💖', other: '📌' };
const SIZE_LIMITS = { image: 20 * 1024 * 1024, video: 1500 * 1024 * 1024, audio: 40 * 1024 * 1024 };

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

function readRaw(req, limit) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 20000) {
  const buf = await readRaw(req, limit);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function localDay(now = Date.now(), tz = TIME_ZONE) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(now))
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

function prettyDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------- Who is this? ----------
// Him: a token obtained with the passphrase (the first passphrase ever entered becomes it).
// Her: the private key in the link he sends her.

function who(req) {
  const token = req.headers['x-sweetie-token'];
  if (typeof token === 'string' && token && store.db.tokens.includes(sha(token))) return 'him';
  const key = req.headers['x-kitty-key'];
  if (typeof key === 'string' && key && key.length === store.db.herKey.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(store.db.herKey))) return 'her';
  return null;
}

function requireAny(req) {
  const w = who(req);
  if (!w) throw new HttpError(403, 'Not allowed');
  return w;
}
function requireHim(req) {
  if (who(req) !== 'him') throw new HttpError(403, 'Not allowed');
  return 'him';
}
// Extra features: always for him, for her once her app is unlocked.
function requireUnlocked(req) {
  const w = requireAny(req);
  if (w === 'her' && !store.db.unlocked) throw new HttpError(403, 'Not unlocked yet');
  return w;
}

const failedAttempts = new Map();
function unlock(passphrase, ip) {
  passphrase = cleanText(passphrase, 200);
  if (passphrase.length < 4) throw new HttpError(400, 'Passphrase too short');
  const recent = (failedAttempts.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
  failedAttempts.set(ip, recent);
  if (recent.length >= 10) throw new HttpError(429, 'Too many tries, wait a bit');

  const hash = (p, salt) => crypto.scryptSync(p, salt, 32).toString('hex');
  let created = false;
  let ok;
  if (process.env.SENDER_PASSPHRASE) {
    ok = sha(passphrase) === sha(process.env.SENDER_PASSPHRASE.trim());
  } else if (!store.db.sender) {
    const salt = crypto.randomBytes(16).toString('hex');
    store.db.sender = { salt, hash: hash(passphrase, salt) };
    created = ok = true;
  } else {
    const { salt, hash: expected } = store.db.sender;
    ok = crypto.timingSafeEqual(Buffer.from(hash(passphrase, salt), 'hex'), Buffer.from(expected, 'hex'));
  }
  if (!ok) {
    recent.push(Date.now());
    return { ok: false };
  }
  const token = crypto.randomBytes(24).toString('hex');
  store.db.tokens = [...store.db.tokens, sha(token)].slice(-10);
  persist();
  return { ok: true, token, created };
}

// ---------- Posts (memories) ----------

const mediaUrl = (id) => `/media/${id}`;

function addPost(post) {
  const p = { id: newId(9), at: Date.now(), caption: '', ...post };
  store.db.posts.unshift(p);
  persist();
  return p;
}

function setCurrent(post, extra = {}) {
  store.db.current = {
    postId: post.id,
    imageUrl: post.url,
    caption: post.caption || '',
    from: post.from,
    sentBy: post.from === 'daily' ? 'daily' : 'sweetie',
    credit: post.credit || null,
    sentAt: post.at,
    ...extra,
  };
  persist();
}

async function publishDaily() {
  const kitty = await cats.random();
  cats.markUsed(kitty.url);
  const post = addPost({ kind: 'kitty', from: 'daily', url: kitty.url, mime: 'image/jpeg', credit: kitty.credit });
  setCurrent(post);
  await push.send({ type: 'kitty', title: pick(DAILY_TITLES), body: pick(DAILY_BODIES), image: kitty.url, tag: 'kitty' });
  console.log('Daily kitty published');
}

// ---------- Daily jobs: kitty + calendar digest ----------

let dailyRunning = null;
function maybeDaily() {
  if (!dailyRunning) dailyRunning = runDaily().finally(() => (dailyRunning = null));
  return dailyRunning;
}

async function runDaily() {
  cats.refreshExternal().catch((e) => console.warn('Kitty pool refresh failed:', e.message));
  const { date, hour } = localDay();
  if (hour < DAILY_HOUR) return 'too-early';
  let status = 'already-sent';
  if (store.db.lastDaily !== date) {
    store.db.lastDaily = date;
    const cur = store.db.current;
    if (cur && cur.from !== 'daily' && Date.now() - cur.sentAt < KEEP_HAND_SENT_HOURS * 3600_000) {
      persist();
      status = 'kept-hand-sent';
    } else {
      try {
        await publishDaily();
        status = 'sent';
      } catch (e) {
        store.db.lastDaily = null; // try again next time
        throw e;
      }
    }
  }
  if (store.db.lastDigest !== date) {
    store.db.lastDigest = date;
    persist();
    await calendarDigest(date);
  }
  return status;
}

/** Occurrence of an event on a given day (yearly events repeat), or null. */
function happensOn(ev, date) {
  if (ev.yearly) return ev.start.slice(5) === date.slice(5) && date >= ev.start;
  const end = ev.end && ev.end >= ev.start ? ev.end : ev.start;
  return date >= ev.start && date <= end;
}

async function calendarDigest(date) {
  const today = store.db.events.filter((ev) => happensOn(ev, date) && isConfirmed(ev));
  if (!today.length) return;
  const lines = today.map((ev) => {
    if (ev.type === 'trip' && ev.start === date) return `✈️ ${ev.title} starts today!`;
    if (ev.type === 'trip') return null;
    if (ev.yearly) {
      const years = Number(date.slice(0, 4)) - Number(ev.start.slice(0, 4));
      return `💖 ${ev.title}${years > 0 ? ` · ${years} year${years > 1 ? 's' : ''}` : ''}`;
    }
    return `${EVENT_TYPES[ev.type] || '📌'} ${ev.title}${ev.time ? ` at ${ev.time}` : ''}`;
  }).filter(Boolean);
  if (!lines.length) return;
  await push.send({ type: 'event', title: '📅 Today', body: lines.join('\n'), tag: 'digest', url: '/#calendar' });
}

// ---------- State ----------

function publicPost(p) {
  return p && { ...p, download: `/dl/${p.id}` };
}

function state(req) {
  const me = who(req);
  if (!me) return { locked: true };
  const db = store.db;
  const fromOther = (list) => list.find((x) => x.from === push.other(me));
  const gift = me === 'her' ? db.gifts.find((g) => g.status === 'sent') : null;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return {
    me,
    unlocked: me === 'him' || db.unlocked,
    herUnlocked: db.unlocked,
    current: db.current,
    note: fromOther(db.notes) || null,
    doodle: publicPost(db.posts.find((p) => p.kind === 'doodle' && p.from === push.other(me))) || null,
    latest: publicPost(db.posts.find((p) => p.from === push.other(me) && (p.kind === 'video' || p.kind === 'photo'))) || null,
    pendingGift: gift ? giftView(gift) : null,
    events: me === 'her' && !db.unlocked ? [] : db.events,
    togetherSince: db.togetherSince,
    tz: db.tz,
    vapidKey: push.publicKey(),
    herLink: me === 'him' ? `${proto}://${host}/?k=${db.herKey}` : undefined,
  };
}

function giftView(g) {
  return { ...g, url: mediaUrl(g.mediaId), musicUrl: g.musicId ? mediaUrl(g.musicId) : null };
}

// ---------- Upload & media ----------

const kindOf = (mime) => (mime || '').split('/')[0];

async function startUpload(body) {
  const mime = cleanText(body.mime, 100).toLowerCase();
  const size = Number(body.size);
  const kind = kindOf(mime);
  if (!SIZE_LIMITS[kind]) throw new HttpError(400, 'Only photos, videos and music');
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Bad size');
  if (size > SIZE_LIMITS[kind]) throw new HttpError(413, `Too big (max ${SIZE_LIMITS[kind] / 1024 / 1024} MB for ${kind})`);
  const used = await media.totalSize();
  if (used + size > MEDIA_LIMIT) throw new HttpError(507, `Not enough space left (${Math.round((MEDIA_LIMIT - used) / 1024 / 1024)} MB free)`);
  const id = await media.create(mime, size, cleanText(body.name, 120));
  return { id, chunkSize: media.CHUNK };
}

async function mediaOk(id) {
  const meta = typeof id === 'string' && /^[a-f0-9]{32}$/.test(id) ? await media.getMeta(id) : null;
  if (!meta || !meta.complete) throw new HttpError(400, 'Media not found');
  return meta;
}

async function serveMedia(req, res, id, download) {
  const meta = /^[a-f0-9]{32}$/.test(id) ? await media.getMeta(id) : null;
  if (!meta || !meta.complete) {
    res.writeHead(404);
    return res.end();
  }
  const size = meta.size;
  let start = 0;
  let end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1] || 0);
      if (range[2] !== '') end = Math.min(size - 1, Number(range[2]));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
  }
  const headers = {
    'Content-Type': meta.mime,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (download) headers['Content-Disposition'] = `attachment; filename="${downloadName(meta)}"`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') return res.end();

  const C = media.CHUNK;
  let closed = false;
  res.on('close', () => (closed = true));
  for (let idx = Math.floor(start / C); idx <= Math.floor(end / C) && !closed; idx++) {
    const chunk = await media.getChunk(id, idx);
    if (!chunk) break;
    const from = idx === Math.floor(start / C) ? start % C : 0;
    const to = idx === Math.floor(end / C) ? (end % C) + 1 : chunk.length;
    if (!res.write(chunk.subarray(from, to))) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

function downloadName(meta) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3' }[meta.mime]
    || meta.mime.split('/')[1] || 'bin';
  const base = (meta.name || 'kitty').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'kitty';
  return `${base}.${ext}`;
}

async function download(req, res, postId) {
  const post = store.db.posts.find((p) => p.id === postId);
  if (!post) {
    res.writeHead(404);
    return res.end();
  }
  if (post.mediaId) return serveMedia(req, res, post.mediaId, true);
  const r = await fetch(post.url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    res.writeHead(502);
    return res.end();
  }
  const type = r.headers.get('content-type') || 'image/jpeg';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="kitty-${post.id}.${type.includes('png') ? 'png' : 'jpg'}"`,
  });
  res.end(Buffer.from(await r.arrayBuffer()));
}

// ---------- Actions ----------

const nudgeTimes = {};

async function sendKitty(me, body) {
  const caption = cleanText(body.caption, 200);
  let post;
  if (body.mediaId) {
    const meta = await mediaOk(body.mediaId);
    const kind = kindOf(meta.mime) === 'video' ? 'video' : 'photo';
    post = addPost({ kind, from: me, url: mediaUrl(body.mediaId), mime: meta.mime, mediaId: body.mediaId, caption });
  } else if (typeof body.imageUrl === 'string' && /^https:\/\/\S+$/.test(body.imageUrl)) {
    cats.markUsed(body.imageUrl);
    post = addPost({ kind: 'kitty', from: me, url: body.imageUrl, mime: 'image/jpeg', caption, credit: cleanText(body.credit, 120) || null });
  } else {
    throw new HttpError(400, 'Send a photo, a video or a kitty');
  }
  if (post.kind !== 'video') setCurrent(post);
  const titles = { kitty: '💌 Your sweetie sent you a kitty!', photo: '📸 Your sweetie sent you a photo', video: '🎬 Your sweetie sent you a video' };
  await push.toOther(me, {
    type: 'kitty',
    title: titles[post.kind],
    body: caption || (post.kind === 'video' ? 'Tap to watch it 💕' : 'Tap to see it 🐱'),
    image: post.kind === 'video' ? undefined : post.url,
    tag: 'kitty',
    url: post.kind === 'video' ? '/#memories' : '/',
  });
  return publicPost(post);
}

async function sendNote(me, body) {
  const message = cleanText(body.message, 300);
  if (!message) throw new HttpError(400, 'Empty note');
  const note = { id: newId(9), message, from: me, at: Date.now() };
  store.db.notes.unshift(note);
  store.db.notes = store.db.notes.slice(0, 2000);
  persist();
  const results = await push.toOther(me, { type: 'note', title: '💌 From your sweetie', body: message, tag: 'note' });
  return { ok: true, delivered: results.filter((r) => r.ok).length };
}

async function nudge(me) {
  if (Date.now() - (nudgeTimes[me] || 0) < 20_000) return { ok: true, throttled: true };
  nudgeTimes[me] = Date.now();
  const results = await push.toOther(me, {
    type: 'nudge',
    title: '💭',
    body: pick(['Your sweetie is thinking of you', 'Someone is thinking about you right now 💕', 'A little hug from your sweetie 🤗']),
    tag: 'nudge',
  });
  return { ok: true, delivered: results.filter((r) => r.ok).length };
}

async function heart(me, body) {
  const post = store.db.posts.find((p) => p.id === body.postId);
  if (!post) throw new HttpError(404, 'Not found');
  post.hearts ||= {};
  if (post.hearts[me]) return { ok: true };
  post.hearts[me] = Date.now();
  persist();
  const what = { kitty: post.from === 'daily' ? "today's kitty" : 'the kitty', photo: 'your photo', video: 'your video', doodle: 'your drawing', gift: 'your gift' }[post.kind] || 'it';
  await push.toOther(me, { type: 'heart', title: '💖', body: `Your sweetie loved ${what}`, tag: 'heart' });
  return { ok: true };
}

async function doodle(me, body) {
  const meta = await mediaOk(body.mediaId);
  if (kindOf(meta.mime) !== 'image') throw new HttpError(400, 'Not an image');
  const post = addPost({ kind: 'doodle', from: me, url: mediaUrl(body.mediaId), mime: meta.mime, mediaId: body.mediaId, caption: cleanText(body.caption, 200) });
  await push.toOther(me, { type: 'doodle', title: '🎨 Your sweetie drew you something', body: post.caption || 'Tap to see it, and draw back 💕', image: post.url, tag: 'doodle', url: '/#draw' });
  return publicPost(post);
}

async function deletePost(me, id) {
  const post = store.db.posts.find((p) => p.id === id);
  if (!post) throw new HttpError(404, 'Not found');
  if (post.from !== me && !(me === 'him' && post.from === 'daily')) throw new HttpError(403, 'Only your own');
  store.db.posts = store.db.posts.filter((p) => p !== post);
  if (store.db.current && store.db.current.postId === id) {
    const prev = store.db.posts.find((p) => p.kind === 'kitty' || p.kind === 'photo');
    store.db.current = null;
    if (prev) setCurrent(prev);
  }
  if (post.mediaId && !store.db.posts.some((p) => p.mediaId === post.mediaId) && !store.db.gifts.some((g) => g.mediaId === post.mediaId)) {
    await media.remove(post.mediaId);
  }
  persist();
  return { ok: true };
}

// Gifts: he prepares one (video or photo, optional music), sends it when he wants,
// she gets a mysterious notification and unwraps it. Opening it unlocks her full app.
async function createGift(body) {
  const meta = await mediaOk(body.mediaId);
  if (!['video', 'image'].includes(kindOf(meta.mime))) throw new HttpError(400, 'A gift is a video or a photo');
  if (body.musicId) {
    const m = await mediaOk(body.musicId);
    if (kindOf(m.mime) !== 'audio') throw new HttpError(400, 'Music must be an audio file');
  }
  const gift = {
    id: newId(9),
    mediaId: body.mediaId,
    mime: meta.mime,
    musicId: body.musicId || null,
    title: cleanText(body.title, 80) || 'Happy birthday, my love 🎂',
    message: cleanText(body.message, 1000),
    teaser: cleanText(body.teaser, 120) || 'Something special just arrived for you… ✨',
    unlocks: body.unlocks !== false,
    status: 'draft',
    createdAt: Date.now(),
  };
  store.db.gifts.unshift(gift);
  persist();
  return giftView(gift);
}

async function sendGift(id) {
  const gift = store.db.gifts.find((g) => g.id === id);
  if (!gift) throw new HttpError(404, 'Not found');
  gift.status = 'sent';
  gift.sentAt = Date.now();
  persist();
  const results = await push.send({ type: 'gift', title: '🎁', body: gift.teaser, tag: 'gift', url: '/' }, ['her']);
  return { ok: true, delivered: results.filter((r) => r.ok).length };
}

async function openGift(me, id) {
  const gift = store.db.gifts.find((g) => g.id === id);
  if (!gift) throw new HttpError(404, 'Not found');
  if (me !== 'her') return giftView(gift); // his preview doesn't count
  if (gift.status !== 'opened') {
    gift.status = 'opened';
    gift.openedAt = Date.now();
    if (gift.unlocks) store.db.unlocked = true;
    addPost({ kind: 'gift', from: 'him', url: mediaUrl(gift.mediaId), mime: gift.mime, mediaId: gift.mediaId, caption: gift.title, message: gift.message, giftId: gift.id, musicUrl: gift.musicId ? mediaUrl(gift.musicId) : null });
    persist();
    await push.send({ type: 'gift-opened', title: '🎁 She opened your gift!', body: 'Right now 💖', tag: 'gift' }, ['him']);
  }
  return giftView(gift);
}

async function deleteGift(id) {
  const gift = store.db.gifts.find((g) => g.id === id);
  if (!gift) throw new HttpError(404, 'Not found');
  store.db.gifts = store.db.gifts.filter((g) => g !== gift);
  if (gift.status !== 'opened') {
    await media.remove(gift.mediaId);
    if (gift.musicId) await media.remove(gift.musicId);
  }
  persist();
  return { ok: true };
}

// Calendar. Date nights are invitations: the other one gets a notification and says yes or no.
// Changing the date or time of a date night sends it back as a new invitation.
const when = (ev) => `${prettyDate(ev.start)}${ev.time ? ` at ${ev.time}` : ''}`;
const isConfirmed = (ev) => ev.type !== 'date' || !ev.status || ev.status === 'accepted';

async function saveEvent(me, body) {
  const type = EVENT_TYPES[body.type] ? body.type : 'other';
  const title = cleanText(body.title, 80);
  if (!title) throw new HttpError(400, 'Give it a name');
  if (!isDate(body.start)) throw new HttpError(400, 'Pick a date');
  const ev = {
    type,
    title,
    start: body.start,
    end: isDate(body.end) && body.end >= body.start ? body.end : null,
    time: isTime(body.time) ? body.time : null,
    notes: cleanText(body.notes, 600),
    yearly: !!body.yearly,
  };
  const existing = body.id && store.db.events.find((e) => e.id === body.id);

  if (existing) {
    const moved = existing.start !== ev.start || existing.time !== ev.time;
    Object.assign(existing, ev, { updatedAt: Date.now() });
    if (type === 'date' && (moved || existing.status === 'declined')) {
      // A new time is a new question.
      Object.assign(existing, { status: 'pending', requestedBy: me, respondedAt: null });
      persist();
      await push.toOther(me, {
        type: 'date-invite',
        title: '🗓️ Your sweetie suggested another time',
        body: `${title} · ${when(existing)}`,
        tag: `date-${existing.id}`,
        url: `/#invite-${existing.id}`,
      });
    } else {
      if (type !== 'date') delete existing.status;
      persist();
    }
    return existing;
  }

  const created = { id: newId(9), ...ev, by: me, createdAt: Date.now() };
  if (type === 'date') Object.assign(created, { status: 'pending', requestedBy: me });
  store.db.events.push(created);
  persist();
  await push.toOther(me, type === 'date'
    ? { type: 'date-invite', title: "💌 You've got a date invitation!", body: `${title} · ${when(created)}`, tag: `date-${created.id}`, url: `/#invite-${created.id}` }
    : { type: 'event', title: `${EVENT_TYPES[type]} Your sweetie added to your calendar`, body: `${title} · ${when(created)}`, tag: 'event', url: '/#calendar' });
  return created;
}

async function respondToDate(me, id, answer) {
  const ev = store.db.events.find((e) => e.id === id && e.type === 'date');
  if (!ev) throw new HttpError(404, 'Not found');
  if (ev.status !== 'pending') throw new HttpError(400, 'Already answered');
  if (ev.requestedBy === me) throw new HttpError(400, 'Your sweetie has to answer this one');
  ev.status = answer === 'yes' ? 'accepted' : 'declined';
  ev.respondedAt = Date.now();
  persist();
  await push.toOther(me, answer === 'yes'
    ? { type: 'date-answer', title: "💖 It's a date!", body: `${ev.title} · ${when(ev)}`, tag: `date-${ev.id}`, url: '/#dates' }
    : { type: 'date-answer', title: '🥺 Maybe another time', body: `${ev.title} · ${when(ev)}. Suggest another day?`, tag: `date-${ev.id}`, url: '/#dates' });
  return ev;
}

// ---------- Routing ----------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler });

let mediaStatus = 'checking';
route('GET', '/api/health', async () => ({ ok: true, storage: store.label, media: media.backend, mediaStatus }));

route('GET', '/api/state', async (req) => {
  // Opening the app after the daily hour also delivers the daily kitty if nothing else did.
  await Promise.race([maybeDaily().catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
  const me = who(req);
  const tz = req.headers['x-tz'];
  if (me && typeof tz === 'string' && tz !== store.db.tz[me] && isValidTimeZone(tz)) {
    store.db.tz[me] = tz;
    persist();
  }
  return state(req);
});

route('POST', '/api/daily', async () => ({ status: await maybeDaily() }));
route('GET', '/api/daily', async () => ({ status: await maybeDaily() }));

route('POST', '/api/subscribe', async (req) => {
  const me = requireAny(req);
  const body = await readJson(req);
  return { ok: push.subscribe(body.subscription, me) };
});

route('POST', '/api/unlock', async (req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return unlock((await readJson(req)).passphrase, ip);
});

route('POST', '/api/lock', async (req) => {
  const token = req.headers['x-sweetie-token'];
  if (typeof token === 'string') store.db.tokens = store.db.tokens.filter((t) => t !== sha(token));
  persist();
  return { ok: true };
});

route('POST', '/api/settings', async (req) => {
  const me = requireAny(req);
  const body = await readJson(req);
  if ('togetherSince' in body) {
    if (me === 'her' && !store.db.unlocked) throw new HttpError(403, 'Not unlocked yet');
    store.db.togetherSince = isDate(body.togetherSince) ? body.togetherSince : null;
  }
  if ('herUnlocked' in body) {
    if (me !== 'him') throw new HttpError(403, 'Not allowed');
    store.db.unlocked = !!body.herUnlocked;
  }
  if (body.newHerLink === true && me === 'him') store.db.herKey = crypto.randomBytes(12).toString('hex');
  persist();
  return state(req);
});

route('GET', '/api/pool', async (req) => {
  requireUnlocked(req);
  return { items: await cats.pool(12), stats: cats.stats() };
});
route('POST', '/api/pool/remove', async (req) => {
  requireHim(req);
  cats.remove(cleanText((await readJson(req)).url, 1000));
  return { ok: true, stats: cats.stats() };
});
route('POST', '/api/pool/add', async (req) => {
  requireHim(req);
  const body = await readJson(req);
  if (body.mediaId) {
    await mediaOk(body.mediaId);
    cats.add(mediaUrl(body.mediaId), 'Added by you');
  } else if (typeof body.url === 'string' && /^https:\/\/\S+$/.test(body.url)) {
    cats.add(body.url, 'Added by you');
  } else throw new HttpError(400, 'Bad url');
  return { ok: true, stats: cats.stats() };
});

route('POST', '/api/upload', async (req) => {
  requireAny(req);
  return startUpload(await readJson(req));
});
route('PUT', '/api/upload/([a-f0-9]{32})/(\\d+)', async (req, [id, idx]) => {
  requireAny(req);
  const meta = await media.getMeta(id);
  if (!meta || meta.complete) throw new HttpError(400, 'Unknown upload');
  idx = Number(idx);
  if (idx >= Math.ceil(meta.size / media.CHUNK)) throw new HttpError(400, 'Bad chunk');
  const buf = await readRaw(req, media.CHUNK);
  await media.putChunk(id, idx, buf);
  return { ok: true };
});
route('POST', '/api/upload/([a-f0-9]{32})/done', async (req, [id]) => {
  requireAny(req);
  const meta = await media.finish(id);
  if (!meta) throw new HttpError(400, 'Upload incomplete, try again');
  return { id, url: mediaUrl(id), mime: meta.mime };
});
route('GET', '/api/storage', async (req) => {
  requireHim(req);
  return { used: await media.totalSize(), limit: MEDIA_LIMIT };
});

route('POST', '/api/send-kitty', async (req) => {
  const me = requireAny(req);
  if (me === 'her' && !store.db.unlocked) throw new HttpError(403, 'Not unlocked yet');
  return sendKitty(me, await readJson(req));
});
route('POST', '/api/send-note', async (req) => {
  const me = requireAny(req);
  if (me === 'her' && !store.db.unlocked) throw new HttpError(403, 'Not unlocked yet');
  return sendNote(me, await readJson(req));
});
route('POST', '/api/nudge', async (req) => nudge(requireUnlocked(req)));
route('POST', '/api/heart', async (req) => heart(requireAny(req), await readJson(req)));
route('POST', '/api/doodle', async (req) => doodle(requireUnlocked(req), await readJson(req)));

route('GET', '/api/posts', async (req) => {
  requireUnlocked(req);
  return { posts: store.db.posts.slice(0, 500).map(publicPost) };
});
route('DELETE', '/api/posts/([a-f0-9]+)', async (req, [id]) => deletePost(requireUnlocked(req), id));

route('GET', '/api/gifts', async (req) => {
  requireHim(req);
  return { gifts: store.db.gifts.map(giftView) };
});
route('POST', '/api/gifts', async (req) => {
  requireHim(req);
  return createGift(await readJson(req));
});
route('POST', '/api/gifts/([a-f0-9]+)/send', async (req, [id]) => {
  requireHim(req);
  return sendGift(id);
});
route('POST', '/api/gifts/([a-f0-9]+)/open', async (req, [id]) => openGift(requireAny(req), id));
route('DELETE', '/api/gifts/([a-f0-9]+)', async (req, [id]) => {
  requireHim(req);
  return deleteGift(id);
});

// For the Android home-screen widgets: today's kitty and the latest drawing from the other one.
route('GET', '/api/widget', async (req) => {
  const me = requireAny(req);
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const base = `${req.headers['x-forwarded-proto'] || 'http'}://${host}`;
  const abs = (u) => (u && u.startsWith('/') ? base + u : u);
  const cur = store.db.current;
  const doodle = store.db.posts.find((p) => p.kind === 'doodle' && p.from === push.other(me));
  const showDoodle = me === 'him' || store.db.unlocked;
  return {
    kitty: cur ? { url: abs(cur.imageUrl), caption: cur.caption || '', at: cur.sentAt } : null,
    doodle: showDoodle && doodle ? { url: abs(doodle.url), caption: doodle.caption || '', at: doodle.at } : null,
  };
});

route('GET', '/api/events', async (req) => {
  requireUnlocked(req);
  return { events: store.db.events };
});
route('POST', '/api/events', async (req) => saveEvent(requireUnlocked(req), await readJson(req)));
route('POST', '/api/events/([a-f0-9]+)/respond', async (req, [id]) => {
  const me = requireUnlocked(req);
  const { answer } = await readJson(req);
  return respondToDate(me, id, answer === 'yes' ? 'yes' : 'no');
});
route('DELETE', '/api/events/([a-f0-9]+)', async (req, [id]) => {
  requireUnlocked(req);
  store.db.events = store.db.events.filter((e) => e.id !== id);
  persist();
  return { ok: true };
});

async function api(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (m) return send(res, 200, await r.handler(req, m.slice(1)));
  }
  throw new HttpError(404, 'Not found');
}

// ---------- Static files ----------

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
      if (!path.extname(pathname)) return serveStatic(res, '/'); // unknown paths open the app
      res.writeHead(404);
      return res.end();
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(data);
  });
}

async function legacyImage(res, id) {
  const img = /^[a-z0-9]+$/.test(id) ? await media.getLegacyImage(id) : null;
  if (!img) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(img.data);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/media/')) return await serveMedia(req, res, url.pathname.slice(7), url.searchParams.has('dl'));
    if (url.pathname.startsWith('/dl/')) return await download(req, res, url.pathname.slice(4));
    if (url.pathname.startsWith('/img/')) return await legacyImage(res, url.pathname.slice(5));
    return serveStatic(res, url.pathname);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error' });
    else res.end();
  }
});
server.requestTimeout = 0; // big uploads on slow connections

load()
  .then(() => {
    push.init();
    media.selfTest().then((status) => {
      mediaStatus = status;
      console.log(`Media storage: ${media.backend} (${status})`);
      if (status === 'ok') media.migrateToR2().catch((e) => console.error('R2 migration failed:', e));
    });
    server.listen(PORT, () => console.log(`Daily Kitty on http://localhost:${PORT} (storage: ${store.label})`));
    setInterval(() => maybeDaily().catch((e) => console.error('Daily kitty failed:', e)), 5 * 60_000);
    maybeDaily().catch((e) => console.error('Daily kitty failed:', e));
  })
  .catch((e) => {
    console.error('Could not load data:', e);
    process.exit(1);
  });
