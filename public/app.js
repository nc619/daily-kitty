// Daily Kitty: front end.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOTE_PRESETS = [
  'Your sweetie misses you 🥺',
  'Thinking about you right now 💭💕',
  "You're the cutest, did you know? 🐱",
  'Sending you the biggest hug 🤗',
  'Good morning, sunshine ☀️',
  'Sweet dreams, my love 🌙✨',
  'I love you sooo much 💖',
  "Can't wait to see you 🥰",
  'Proud of you today 🌸',
  'Boop 👉🐽',
];

const EVENT_EMOJI = { trip: '✈️', date: '🌙', special: '💖', other: '📌' };

const DATE_IDEAS = [
  { group: 'Watch & listen 🍿', items: [
    ['🎬', 'Movie night', 'Press play at the same time (or use Teleparty) with matching snacks.'],
    ['🎧', 'Music & Chill', 'Start a Spotify Jam or a shared playlist, get cozy and just hang out together.'],
  ] },
  { group: 'Play together 🎮', items: [
    ['✏️', 'Gartic Phone / skribbl.io', 'Silly drawing games that end in tears of laughter.'],
    ['🕵️', 'Codenames online', 'Free at codenames.game; play as a team against the clock.'],
    ['🗺️', 'GeoGuessr duel', 'Guess where in the world you are; loser plans the next date.'],
    ['❓', 'Quiz about us', 'Write 10 questions about yourselves and quiz each other.'],
  ] },
  { group: 'Cook & eat 🍝', items: [
    ['👩‍🍳', 'Same recipe, two kitchens', 'Cook the same dish on video call, then eat "together".'],
    ['🛵', 'Surprise delivery', "Order each other's dinner without saying what it is."],
    ['🥞', 'Breakfast date', 'Pancakes and coffee on call before the day starts.'],
  ] },
  { group: 'Cozy & deep 💞', items: [
    ['💬', '36 questions', 'The famous "36 questions to fall in love". Take your time.'],
    ['📖', 'Reading date', 'Read the same book (or the same chapter) side by side, then talk about it.'],
    ['😴', 'Fall asleep on call', 'The classic. Stay on until one of you is snoring.'],
  ] },
  { group: 'Creative ✨', items: [
    ['🎨', 'Paint the same thing', 'Same subject, 30 minutes, then reveal. No judging (a bit of judging).'],
    ['📸', 'Photo challenge', 'Same list of things to photograph in your cities, compare at the end.'],
    ['🧶', 'Make something', 'Both try a little craft kit or origami tutorial at the same time.'],
  ] },
  { group: 'Dreaming together 🏠', items: [
    ['🏡', 'House tours', 'Browse dream houses or holiday rentals together.'],
  ] },
];

// Shown in the folded "Other ideas" section at the end.
const OTHER_IDEAS = [
  ['📺', 'Series marathon', 'Start a new show together and only watch it together.'],
  ['🌍', 'Travel docs night', 'Watch a documentary about a place you want to visit together.'],
  ['😂', 'Childhood cartoons', 'Show each other the cartoons you grew up with.'],
  ['🧩', 'Online jigsaw', 'Solve a jigsaw together on a shared puzzle site.'],
  ['🍷', 'Tasting night', 'Pick the same wine, chocolate or cheese and rate it.'],
  ['✉️', 'Letter night', 'Write each other real letters and post them the same evening.'],
  ['🔮', 'Future planning', 'Dream up your next trip, your future home, your bucket list.'],
  ['🎶', 'Playlist swap', 'Build a shared playlist of songs that remind you of each other.'],
  ['🌌', 'Stargazing call', 'Go outside, look at the same moon, talk about everything.'],
  ['🏛️', 'Virtual museum', 'Google Arts & Culture tours of museums around the world.'],
  ['🚶', 'Walking date', 'Go for a walk at the same time and show each other your view.'],
];

const COLORS = ['#4b3a47', '#ec5f93', '#f7a541', '#f5d142', '#58c49a', '#5aa9e6', '#9b7be8', '#ffffff'];
const SIZES = [3, 7, 14];

// ---------- Local storage ----------

function load(key, json) {
  try {
    const v = localStorage.getItem(key);
    return json ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}
function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch { /* private mode */ }
}

// Her private link: /?k=…  → remembered, then removed from the address bar.
(() => {
  const params = new URLSearchParams(location.search);
  const k = params.get('k');
  if (k) {
    save('kitty_key', k);
    history.replaceState(null, '', '/' + location.hash);
  }
})();

let token = load('kitty_token');
let herKey = load('kitty_key');
let state = load('kitty_state', true);
const myTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function authHeaders() {
  const h = { 'x-tz': myTz };
  if (token) h['x-sweetie-token'] = token;
  if (herKey) h['x-kitty-key'] = herKey;
  return h;
}

async function api(path, body, method) {
  const opts = { method: method || (body ? 'POST' : 'GET'), headers: authHeaders() };
  if (body) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** Uploads a file in 1 MB chunks (3 at a time) and returns { id, url, mime }. */
async function upload(blob, name, onProgress) {
  const mime = blob.type || '';
  if (!mime) throw new Error("Unknown file type");
  const start = await api('/api/upload', { mime, size: blob.size, name: name || '' });
  const C = start.chunkSize;
  const n = Math.max(1, Math.ceil(blob.size / C));
  let next = 0;
  let done = 0;
  onProgress && onProgress(0);
  const worker = async () => {
    while (next < n) {
      const i = next++;
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(`/api/upload/${start.id}/${i}`, { method: 'PUT', headers: authHeaders(), body: blob.slice(i * C, (i + 1) * C) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await sleep(1500 * (attempt + 1));
        }
      }
      done++;
      onProgress && onProgress(done / n);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return api(`/api/upload/${start.id}/done`, {});
}

/** Shrinks a photo so it uploads quickly (and fixes its rotation). */
async function resizeImage(file, max = 2000, quality = 0.88) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setProgress(bar, fraction) {
  bar.hidden = fraction == null;
  if (fraction != null) bar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

async function withButton(btn, label, fn) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (e) {
    toast(`Oops 😿 ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

// ---------- Dates ----------

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => new Date(s + 'T12:00:00');
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const prettyDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => parseYmd(s).toLocaleDateString([], opts);

function formatTime(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `yesterday at ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}

function occursOn(ev, date) {
  if (ev.yearly) return ev.start.slice(5) === date.slice(5) && date >= ev.start;
  return date >= ev.start && date <= (ev.end || ev.start);
}

/** Next date an event happens (today counts), or null if it's over. */
function nextOccurrence(ev, today = todayStr()) {
  if (ev.yearly) {
    const y = Number(today.slice(0, 4));
    let d = `${y}${ev.start.slice(4)}`;
    if (d < today) d = `${y + 1}${ev.start.slice(4)}`;
    return d < ev.start ? ev.start : d;
  }
  if ((ev.end || ev.start) < today) return null;
  return ev.start < today ? today : ev.start;
}

const isInviteForMe = (ev) => ev.type === 'date' && ev.status === 'pending' && ev.requestedBy && ev.requestedBy !== me();
const liveEvents = () => ((state && state.events) || []).filter((ev) => ev.status !== 'declined');

function upcoming(events, limit = 50, filter = () => true) {
  return events
    .filter(filter)
    .map((ev) => ({ ev, date: nextOccurrence(ev) }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date + (a.ev.time || '')).localeCompare(b.date + (b.ev.time || '')))
    .slice(0, limit);
}

function inDays(date) {
  const n = daysBetween(todayStr(), date);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

// ---------- State ----------

const me = () => (state && state.me) || null;
const unlocked = () => !!(state && state.unlocked);

let refreshing = null;
function refresh() {
  if (!token && !herKey) {
    showLocked();
    return Promise.resolve();
  }
  if (refreshing) return refreshing;
  const slow = setTimeout(() => ($('waking').hidden = false), 2500);
  refreshing = api('/api/state')
    .then((s) => {
      if (s.locked) {
        if (token) {
          token = null;
          save('kitty_token', null);
        }
        if (herKey && !token) {
          herKey = null;
          save('kitty_key', null);
        }
        state = null;
        save('kitty_state', null);
        return showLocked();
      }
      const wasUnlocked = unlocked();
      state = s;
      save('kitty_state', s);
      renderAll();
      syncPush();
      if (s.pendingGift) maybeShowGift(s.pendingGift);
      else maybeOpenInvite();
      if (!wasUnlocked && s.unlocked && s.me === 'her') $('nav').classList.add('fresh');
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(slow);
      $('waking').hidden = true;
      refreshing = null;
    });
  return refreshing;
}

function showLocked() {
  $('app').hidden = true;
  $('locked').hidden = false;
}

function renderAll() {
  $('locked').hidden = true;
  $('app').hidden = false;
  const full = unlocked();
  $('nav').hidden = !full;
  document.body.classList.toggle('no-nav', !full);
  $('fab').hidden = !full;
  document.querySelectorAll('.him-only').forEach((e) => (e.hidden = me() !== 'him'));
  $('lock-btn').hidden = me() !== 'him';
  if (!full && currentView() !== 'home') location.hash = '';
  renderHome();
  const v = currentView();
  if (v === 'calendar') renderCalendar();
  if (v === 'dates') renderDates();
}

// ---------- Home ----------

function renderHome() {
  $('today').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  if (!state) return;
  renderClocks();

  const kitty = state.current;
  const frame = $('kitty-frame');
  const img = $('kitty-img');
  if (kitty) {
    frame.classList.remove('empty');
    if (img.dataset.src !== kitty.imageUrl) {
      img.dataset.src = kitty.imageUrl;
      frame.classList.add('loading');
      img.onload = img.onerror = () => frame.classList.remove('loading');
      img.src = kitty.imageUrl;
    }
    const fromMe = kitty.from === me();
    $('kitty-label').textContent = kitty.from === 'daily' ? "☀️ Today's kitty" : fromMe ? '💌 You sent this one' : '💌 A special one from your sweetie';
    $('kitty-caption').textContent = kitty.caption || '';
    $('kitty-caption').hidden = !kitty.caption;
    $('kitty-time').textContent = `Arrived ${formatTime(kitty.sentAt)}`;
    $('kitty-credit').textContent = kitty.credit ? `📷 ${kitty.credit}` : '';
  } else {
    frame.classList.remove('loading');
    frame.classList.add('empty');
  }

  const note = state.note;
  const showNote = note && Date.now() - note.at < 864e5;
  $('note').hidden = !showNote;
  if (showNote) {
    $('note-text').textContent = note.message;
    $('note-time').textContent = formatTime(note.at);
  }

  const full = unlocked();
  const latest = full && state.latest && Date.now() - state.latest.at < 3 * 864e5 && (!kitty || state.latest.id !== kitty.postId) ? state.latest : null;
  $('latest').hidden = !latest;
  if (latest) {
    $('latest-label').textContent = latest.kind === 'video' ? '🎬 New video from your sweetie' : '📸 New photo from your sweetie';
    const box = $('latest-media');
    if (box.dataset.id !== latest.id) {
      box.dataset.id = latest.id;
      box.innerHTML = '';
      box.append(latest.kind === 'video'
        ? el('video', { src: latest.url, controls: true, playsinline: true, preload: 'metadata' })
        : el('img', { src: latest.url, alt: '', onclick: () => openViewer(latest) }));
    }
  }

  const doodle = full && state.doodle && Date.now() - state.doodle.at < 3 * 864e5 ? state.doodle : null;
  $('doodle-card').hidden = !doodle;
  if (doodle) $('doodle-img').src = doodle.url;

  $('nudge').hidden = !full;

  // Countdown chips
  const chips = $('chips');
  chips.innerHTML = '';
  if (full) {
    const trip = upcoming(liveEvents(), 1, (e) => e.type === 'trip')[0];
    if (trip) {
      const n = daysBetween(todayStr(), trip.ev.start);
      chips.append(el('span', { class: 'pill' }, n <= 0 ? '💞 Together right now!' : `✈️ ${n} day${n > 1 ? 's' : ''} until ${trip.ev.title}`));
    }
    if (state.togetherSince) {
      const n = daysBetween(state.togetherSince, todayStr());
      if (n >= 0) chips.append(el('span', { class: 'pill lav' }, `💞 ${n.toLocaleString()} days together`));
    }
  }
  chips.hidden = !chips.children.length;

  renderWidgetCard();
  renderInvites();

  const next = full ? upcoming(liveEvents(), 3) : [];
  $('upnext').hidden = !next.length;
  $('upnext-list').innerHTML = '';
  next.forEach((x) => $('upnext-list').append(eventRow(x.ev, x.date)));
}

let clockTimer;
function renderClocks() {
  const other = me() === 'him' ? 'her' : 'him';
  const theirTz = state && state.tz && state.tz[other];
  const show = theirTz && theirTz !== myTz;
  $('clocks').hidden = !show;
  clearInterval(clockTimer);
  if (!show) return;
  const fmt = (tz) => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const draw = () => ($('clocks').textContent = `🕐 You ${fmt(myTz)}  ·  💕 Sweetie ${fmt(theirTz)}`);
  draw();
  clockTimer = setInterval(draw, 30_000);
}

// Double-tap the kitty to send a heart.
let lastKittyTap = 0;
let kittyTapTimer;
$('kitty-frame').addEventListener('click', (e) => {
  const now = Date.now();
  clearTimeout(kittyTapTimer);
  if (now - lastKittyTap < 350 && state && state.current && state.current.postId) {
    heartBurst($('heart-burst'), e);
    api('/api/heart', { postId: state.current.postId }).catch(() => {});
    lastKittyTap = 0;
  } else {
    lastKittyTap = now;
    // A single tap shows the whole photo.
    kittyTapTimer = setTimeout(() => {
      const k = state && state.current;
      if (k) openViewer({ id: k.postId, url: k.imageUrl, mime: 'image/jpeg', caption: k.caption, from: k.from, at: k.sentAt, credit: k.credit, kind: 'kitty', download: k.postId ? `/dl/${k.postId}` : k.imageUrl });
    }, 360);
  }
});

function heartBurst(container, e) {
  const rect = container.getBoundingClientRect();
  container.append(el('span', { class: 'big' }, '💖'));
  for (let i = 0; i < 6; i++) {
    const s = el('span', {}, ['💕', '💖', '✨', '🩷'][i % 4]);
    s.style.left = `${(e ? e.clientX - rect.left : rect.width / 2) + (Math.random() - 0.5) * 120}px`;
    s.style.top = `${(e ? e.clientY - rect.top : rect.height / 2) + (Math.random() - 0.5) * 60}px`;
    s.style.animationDelay = `${i * 60}ms`;
    container.append(s);
  }
  setTimeout(() => (container.innerHTML = ''), 1300);
}

$('nudge').onclick = async () => {
  $('nudge').classList.remove('sent');
  void $('nudge').offsetWidth;
  $('nudge').classList.add('sent');
  try {
    const r = await api('/api/nudge', {});
    toast(r.throttled ? 'Sent just now already 💕' : 'Sent! They know you are thinking of them 💭');
  } catch (e) {
    toast(`Oops 😿 ${e.message}`);
  }
};
$('draw-back').onclick = () => (location.hash = '#draw');

// ---------- Home-screen widgets (Android companion app) ----------

const WIDGET_APK = 'https://github.com/nc619/daily-kitty/releases/download/widgets/kitty-widgets.apk';
const isAndroid = /Android/i.test(navigator.userAgent);

function widgetSteps(withHide) {
  const param = me() === 'him' ? `t=${encodeURIComponent(token)}` : `k=${encodeURIComponent(herKey)}`;
  const connect = `intent://setup?${param}#Intent;scheme=dailykitty;package=com.dailykitty.widget;S.browser_fallback_url=${encodeURIComponent(WIDGET_APK)};end`;
  return [
    el('p', { class: 'eyebrow' }, '📱 Home-screen widgets'),
    el('p', { class: 'hint' }, "Today's kitty and your sweetie's latest drawing, right on your home screen."),
    el('ol', {},
      el('li', {}, 'Get the little widget app', el('br'), el('a', { class: 'btn small outline', href: WIDGET_APK }, '⬇️ Download Kitty Widgets')),
      el('li', {}, 'Open the download and install it (allow Chrome to install apps if asked)'),
      el('li', {}, 'Link it to you', el('br'), el('a', { class: 'btn small', href: connect }, '🔗 Connect the widgets')),
      el('li', {}, 'In Kitty Widgets, tap "Allow background updates" so they refresh every day'),
      el('li', {}, 'Long-press your home screen → Widgets → Kitty Widgets')),
    withHide ? el('button', { class: 'btn small ghost', onclick: () => { save('kitty_widget_hidden', '1'); $('widget-card').hidden = true; } }, 'Hide this') : null,
  ];
}

function renderWidgetCard() {
  const card = $('widget-card');
  const show = isAndroid && unlocked() && !load('kitty_widget_hidden');
  card.hidden = !show;
  if (show && !card.children.length) card.append(...widgetSteps(true));
  const settings = $('widget-settings');
  settings.innerHTML = '';
  if (me() === 'him') settings.append(...widgetSteps(false));
}

// ---------- Router ----------

const VIEWS = ['home', 'memories', 'draw', 'calendar', 'dates'];
const currentView = () => {
  const v = location.hash.slice(1);
  return VIEWS.includes(v) && (v === 'home' || unlocked()) ? v : 'home';
};

function route() {
  if (location.hash.startsWith('#invite-')) {
    const id = location.hash.slice(8);
    history.replaceState(null, '', '#home');
    const ev = ((state && state.events) || []).find((e) => e.id === id);
    if (ev && isInviteForMe(ev)) openInvite(ev);
    else refresh().then(() => {
      const fresh = ((state && state.events) || []).find((e) => e.id === id);
      if (fresh && isInviteForMe(fresh)) openInvite(fresh);
    });
  }
  const v = currentView();
  VIEWS.forEach((name) => ($(`view-${name}`).hidden = name !== v));
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
  window.scrollTo(0, 0);
  if (v === 'memories') loadMemories();
  if (v === 'draw') openDraw();
  if (v === 'calendar') renderCalendar();
  if (v === 'dates') renderDates();
  if (v !== 'home') $('nav').classList.remove('fresh');
}
window.addEventListener('hashchange', route);

// ---------- Notifications & install ----------

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function syncPush() {
  $('notif').hidden = !(pushSupported && Notification.permission === 'default');
  if (!pushSupported || Notification.permission !== 'granted' || !state || !state.vapidKey) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = urlBase64ToUint8Array(state.vapidKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).toString() !== key.toString()) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/api/subscribe', { subscription: sub.toJSON() });
  } catch (e) {
    console.warn('Push setup failed', e);
  }
}

$('notif-btn').onclick = async () => {
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    toast('Notifications on 🔔');
    syncPush();
  } else $('notif').hidden = true;
};

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install').hidden = false;
});
$('install-btn').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install').hidden = true;
};
window.addEventListener('appinstalled', () => ($('install').hidden = true));

// ---------- Secret unlock: tap the title 7 times ----------

let taps = 0;
let lastTap = 0;
$('title').addEventListener('click', () => {
  const now = Date.now();
  taps = now - lastTap < 600 ? taps + 1 : 1;
  lastTap = now;
  $('title').classList.add('tapped');
  setTimeout(() => $('title').classList.remove('tapped'), 150);
  if (taps >= 7) {
    taps = 0;
    if (me() === 'him') return openSheet('tab-settings');
    $('passphrase').value = '';
    $('unlock-error').hidden = true;
    $('unlock').hidden = false;
    $('passphrase').focus();
  }
});
$('unlock-cancel').onclick = () => ($('unlock').hidden = true);
$('unlock-form').onsubmit = async (e) => {
  e.preventDefault();
  const passphrase = $('passphrase').value;
  if (!passphrase.trim()) return;
  try {
    const r = await api('/api/unlock', { passphrase });
    if (!r.ok) {
      $('unlock-error').textContent = 'Nope 🙀';
      $('unlock-error').hidden = false;
      return;
    }
    token = r.token;
    save('kitty_token', token);
    $('unlock').hidden = true;
    toast(r.created ? 'Passphrase saved. Sweetie mode unlocked 💕' : 'Sweetie mode unlocked 💕');
    await refresh();
  } catch (err) {
    $('unlock-error').textContent = err.status === 429 ? 'Too many tries, wait a bit 🙀' : 'Nope 🙀';
    $('unlock-error').hidden = false;
  }
};

// Also reachable without the secret taps.
$('locked').addEventListener('click', (() => {
  let n = 0;
  let t = 0;
  return () => {
    n = Date.now() - t < 600 ? n + 1 : 1;
    t = Date.now();
    if (n >= 7) {
      n = 0;
      $('unlock').hidden = false;
      $('passphrase').focus();
    }
  };
})());

// ---------- Send sheet ----------

let picked = null; // { imageUrl, credit } | { blob, kind: 'photo' } | { file, kind: 'video' }

function openSheet(tabId = 'tab-kitty') {
  $('sheet').hidden = false;
  history.pushState({ sheet: true }, '');
  selectTab(tabId);
}
function closeSheet() {
  $('sheet').hidden = true;
}
window.addEventListener('popstate', () => {
  if (!$('sheet').hidden) closeSheet();
  if (!$('viewer').hidden) closeViewer();
});
$('fab').onclick = () => openSheet();
document.querySelectorAll('[data-close-sheet]').forEach((b) => (b.onclick = () => history.back()));

function selectTab(id) {
  document.querySelectorAll('#sheet-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
  document.querySelectorAll('#sheet .tab-body').forEach((b) => (b.hidden = b.id !== id));
  if (id === 'tab-kitty' && !$('pool').children.length) loadPool();
  if (id === 'tab-gift') loadGifts();
  if (id === 'tab-settings') loadSettings();
}
document.querySelectorAll('#sheet-tabs .tab').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));

$('lock-btn').onclick = async () => {
  await api('/api/lock', {}).catch(() => {});
  token = null;
  save('kitty_token', null);
  state = null;
  save('kitty_state', null);
  closeSheet();
  history.back();
  toast('Sweetie mode hidden 🤫');
  refresh();
};

// Kitty tab
function showPicked(node) {
  const box = $('picked-preview');
  box.innerHTML = '';
  box.append(node);
  $('picked').hidden = false;
  $('picked').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearPicked() {
  picked = null;
  $('picked').hidden = true;
  $('picked-preview').innerHTML = '';
  $('caption').value = '';
  setProgress($('upload-bar'), null);
  document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
}
$('cancel-pick').onclick = clearPicked;

async function loadPool() {
  const pool = $('pool');
  pool.innerHTML = '<div class="loading-cell">Fetching kitties… 🐾</div>';
  try {
    const { items, stats } = await api('/api/pool');
    $('pool-stats').textContent = me() === 'him' ? `· ${stats.total} kitties` : '';
    pool.innerHTML = '';
    for (const item of items) {
      const img = el('img', { src: item.url, alt: 'Kitty', loading: 'lazy' });
      img.onclick = () => {
        document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
        img.classList.add('selected');
        picked = { imageUrl: item.url, credit: item.credit };
        showPicked(el('img', { src: item.url, alt: '' }));
      };
      const cell = el('div', { class: 'cell' }, img);
      if (me() === 'him') {
        cell.append(el('button', {
          class: 'x',
          title: 'Never show this one',
          onclick: async () => {
            if (!confirm('Remove this kitty from the pool forever?')) return;
            await api('/api/pool/remove', { url: item.url }).catch(() => {});
            cell.remove();
          },
        }, '✕'));
      }
      pool.append(cell);
    }
  } catch {
    pool.innerHTML = '<div class="loading-cell">Couldn\'t fetch kitties right now 😿</div>';
  }
}
$('more').onclick = loadPool;

$('gallery').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
  if (file.type.startsWith('video/')) {
    picked = { file, kind: 'video' };
    showPicked(el('video', { src: URL.createObjectURL(file), controls: true, playsinline: true }));
    return;
  }
  try {
    const blob = await resizeImage(file);
    picked = { blob, kind: 'photo' };
    showPicked(el('img', { src: URL.createObjectURL(blob), alt: '' }));
  } catch {
    toast("Can't read that photo 😿 Try another one");
  }
};

$('send-kitty').onclick = () => {
  if (!picked) return;
  withButton($('send-kitty'), 'Sending…', async () => {
    const caption = $('caption').value;
    let body;
    if (picked.imageUrl) body = { imageUrl: picked.imageUrl, credit: picked.credit, caption };
    else {
      const file = picked.blob || picked.file;
      const up = await upload(file, file.name || 'photo.jpg', (f) => setProgress($('upload-bar'), f));
      body = { mediaId: up.id, caption };
    }
    const post = await api('/api/send-kitty', body);
    toast({ kitty: 'Kitty sent! 🐱💕', photo: 'Photo sent! 📸💕', video: 'Video sent! 🎬💕' }[post.kind]);
    clearPicked();
    refresh();
  });
};

// Note tab
for (const text of NOTE_PRESETS) {
  $('presets').append(el('button', { class: 'chip', onclick: () => ($('note-input').value = text) }, text));
}
$('send-note').onclick = () => {
  const message = $('note-input').value.trim();
  if (!message) return toast('Write something first 💭');
  withButton($('send-note'), 'Sending…', async () => {
    const r = await api('/api/send-note', { message });
    $('note-input').value = '';
    toast(r.delivered ? 'Note sent! 💌' : "Note saved 💌 (their notifications aren't on yet)");
  });
};

// Gift tab (his side)
const giftDraft = { mediaId: null, musicId: null };

async function loadGifts() {
  const list = $('gift-list');
  list.innerHTML = '';
  let gifts = [];
  try {
    ({ gifts } = await api('/api/gifts'));
  } catch {
    return;
  }
  if (!gifts.length) return;
  const card = el('section', { class: 'card form-card' }, el('h3', { class: 'section-title tight' }, 'Your gifts'));
  for (const g of gifts) {
    const thumb = g.mime.startsWith('video/')
      ? el('video', { class: 'thumb', src: g.url + '#t=0.5', muted: true, preload: 'metadata' })
      : el('img', { class: 'thumb', src: g.url, alt: '' });
    const status = { draft: 'Not sent yet', sent: 'Sent, waiting to be opened', opened: `Opened ${g.openedAt ? formatTime(g.openedAt) : ''} 💖` }[g.status];
    card.append(el('div', { class: 'gift-item' },
      thumb,
      el('div', { class: 'info' }, el('b', {}, g.title), el('span', { class: `status ${g.status}` }, status)),
    ));
    card.append(el('div', { class: 'row' },
      el('button', { class: 'btn small outline', onclick: () => { closeSheet(); history.back(); showGift(g, true); } }, '👀 Preview'),
      g.status === 'draft'
        ? el('button', {
          class: 'btn small',
          onclick: async (e) => {
            if (!confirm('Send this gift to her now? 🎁')) return;
            await withButton(e.target, 'Sending…', async () => {
              const r = await api(`/api/gifts/${g.id}/send`, {});
              toast(r.delivered ? 'Gift sent! 🎁 Now wait for the magic…' : "Gift sent 🎁 (her notifications aren't on yet, she'll see it when she opens the app)");
              loadGifts();
            });
          },
        }, '🎁 Send now')
        : null,
      el('button', {
        class: 'btn small ghost danger',
        onclick: async () => {
          if (!confirm('Delete this gift?')) return;
          await api(`/api/gifts/${g.id}`, null, 'DELETE').catch(() => {});
          loadGifts();
        },
      }, 'Delete'),
    ));
  }
  list.append(card);
}

$('gift-file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  giftDraft.mediaId = null;
  try {
    const blob = file.type.startsWith('image/') ? await resizeImage(file, 2400, 0.9) : file;
    const up = await upload(blob, file.name, (f) => setProgress($('gift-file-bar'), f));
    giftDraft.mediaId = up.id;
    toast('Uploaded ✅');
  } catch (err) {
    setProgress($('gift-file-bar'), null);
    e.target.value = '';
    toast(`Upload failed 😿 ${err.message}`);
  }
};
$('gift-music').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  giftDraft.musicId = null;
  try {
    const up = await upload(file, file.name, (f) => setProgress($('gift-music-bar'), f));
    giftDraft.musicId = up.id;
    toast('Music uploaded 🎶');
  } catch (err) {
    setProgress($('gift-music-bar'), null);
    e.target.value = '';
    toast(`Upload failed 😿 ${err.message}`);
  }
};
$('gift-save').onclick = () => {
  if (!giftDraft.mediaId) return toast('Pick the video or photo first (and wait for the upload) 🎬');
  withButton($('gift-save'), 'Saving…', async () => {
    await api('/api/gifts', {
      mediaId: giftDraft.mediaId,
      musicId: giftDraft.musicId,
      title: $('gift-title').value,
      message: $('gift-message').value,
      teaser: $('gift-teaser').value,
      unlocks: $('gift-unlocks').checked,
    });
    giftDraft.mediaId = giftDraft.musicId = null;
    ['gift-file', 'gift-music', 'gift-title', 'gift-message', 'gift-teaser'].forEach((id) => ($(id).value = ''));
    setProgress($('gift-file-bar'), null);
    setProgress($('gift-music-bar'), null);
    toast('Gift saved 🎁 Preview it, then send it when the moment is right');
    loadGifts();
  });
};

// Settings tab (his side)
async function loadSettings() {
  if (!state) return;
  $('her-link').value = state.herLink || '';
  $('her-unlocked').checked = !!state.herUnlocked;
  try {
    const [{ used, limit }, { stats }] = await Promise.all([api('/api/storage'), api('/api/pool')]);
    setProgress($('storage-bar'), used / limit);
    $('storage-info').textContent = `${(used / 1048576).toFixed(0)} MB of ${(limit / 1048576).toFixed(0)} MB used for photos, videos and music`;
    const src = [stats.pexels && 'Pexels', stats.unsplash && 'Unsplash'].filter(Boolean);
    $('pool-info').textContent = `${stats.total} kitties in the pool, ${stats.used} already shown`
      + (src.length ? ` (including ${stats.external} from ${src.join(' & ')})` : '')
      + '. The daily kitty never repeats until all have been shown.';
  } catch { /* offline */ }
}
$('copy-link').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('her-link').value);
    toast('Link copied 📋');
  } catch {
    $('her-link').select();
  }
};
$('share-link').onclick = () => {
  if (navigator.share) navigator.share({ title: 'Daily Kitty 🐾', text: 'A little something for you 🐱', url: $('her-link').value }).catch(() => {});
  else $('copy-link').click();
};
$('new-link').onclick = async () => {
  if (!confirm('Make a new link? The old one stops working (her phone too, until she opens the new link).')) return;
  state = await api('/api/settings', { newHerLink: true });
  loadSettings();
};
$('reset-her').onclick = async (e) => {
  if (!confirm('Fresh start for her?\n\n• Her app goes back to "just kitties"\n• Her private link changes (the old one stops working)\n• Everything sent from her side is deleted (photos, notes, drawings, plans)\n• Your gifts go back to "not sent yet"\n\nYour own photos, notes and plans stay.')) return;
  await withButton(e.currentTarget, 'Resetting…', async () => {
    state = await api('/api/reset-her', {});
    save('kitty_state', state);
    loadSettings();
    renderAll();
    toast('Fresh start done 🎂 Send her the new link on the big day');
  });
};
$('her-unlocked').onchange = async (e) => {
  state = await api('/api/settings', { herUnlocked: e.target.checked });
  toast(e.target.checked ? 'Her full app is unlocked 🔓' : 'Her app is back to just kitties 🔒');
};
$('pool-add').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  let n = 0;
  for (const file of files) {
    try {
      const blob = await resizeImage(file, 1600, 0.88);
      const up = await upload(blob, file.name);
      await api('/api/pool/add', { mediaId: up.id });
      n++;
    } catch { /* skip */ }
  }
  toast(`${n} kitt${n === 1 ? 'y' : 'ies'} added to the pool 🐱`);
  loadSettings();
};

// ---------- Memories ----------

let posts = [];
let memFilter = 'all';
const MEM_FILTERS = [
  ['all', 'All'],
  ['us', '💌 From us'],
  ['photo', '📸 Photos'],
  ['video', '🎬 Videos'],
  ['doodle', '🎨 Drawings'],
  ['gift', '🎁 Gifts'],
  ['kitty', '🐱 Kitties'],
];
MEM_FILTERS.forEach(([key, label]) => {
  $('mem-filters').append(el('button', {
    'data-f': key,
    class: key === memFilter ? 'active' : '',
    onclick: () => {
      memFilter = key;
      document.querySelectorAll('#mem-filters button').forEach((b) => b.classList.toggle('active', b.dataset.f === key));
      renderMemories();
    },
  }, label));
});

async function loadPosts() {
  try {
    ({ posts } = await api('/api/posts'));
  } catch { /* offline */ }
  return posts;
}

async function loadMemories() {
  renderMemories();
  await loadPosts();
  renderMemories();
}

function memItem(p) {
  const badge = { video: '▶ video', doodle: '🎨', gift: '🎁', photo: '📸' }[p.kind];
  const media = p.mime && p.mime.startsWith('video/')
    ? el('video', { src: p.url + '#t=0.5', muted: true, preload: 'metadata', playsinline: true })
    : el('img', { src: p.url, alt: '', loading: 'lazy' });
  return el('button', { class: `mem-item kind-${p.kind}`, onclick: () => openViewer(p) },
    media,
    badge ? el('span', { class: 'badge' }, badge) : null,
    p.hearts && Object.keys(p.hearts).length ? el('span', { class: 'heart' }, '💖') : null);
}

function renderMemories() {
  const list = posts.filter((p) => {
    if (memFilter === 'all') return true;
    if (memFilter === 'us') return p.from !== 'daily';
    return p.kind === memFilter;
  });
  const grid = $('mem-grid');
  grid.innerHTML = '';
  list.forEach((p) => grid.append(memItem(p)));
  $('mem-empty').hidden = list.length > 0;
}

// ---------- Viewer ----------

let viewing = null;
function openViewer(p) {
  viewing = p;
  const box = $('viewer-media');
  box.innerHTML = '';
  box.append(p.mime && p.mime.startsWith('video/')
    ? el('video', { src: p.url, controls: true, autoplay: true, playsinline: true })
    : el('img', { src: p.url, alt: '', class: p.kind === 'doodle' ? 'doodle' : '' }));
  const who = p.from === 'daily' ? '☀️ Daily kitty' : p.from === me() ? 'From you' : 'From your sweetie';
  $('viewer-caption').textContent = p.caption || '';
  $('viewer-caption').hidden = !p.caption;
  $('viewer-meta').textContent = `${who} · ${formatTime(p.at)}${p.credit ? ` · 📷 ${p.credit}` : ''}`;
  $('viewer-download').href = p.download || p.url;
  $('viewer-heart').textContent = p.hearts && p.hearts[me()] ? '💖 Loved' : '🤍 Love';
  $('viewer-delete').hidden = !(p.from === me() || (me() === 'him' && p.from === 'daily'));
  $('viewer-replay').hidden = p.kind !== 'gift';
  $('viewer').hidden = false;
  history.pushState({ viewer: true }, '');
}
function closeViewer() {
  $('viewer').hidden = true;
  $('viewer-media').innerHTML = '';
  viewing = null;
}
$('viewer-close').onclick = () => history.back();
$('viewer-heart').onclick = async () => {
  if (!viewing) return;
  viewing.hearts = { ...(viewing.hearts || {}), [me()]: Date.now() };
  $('viewer-heart').textContent = '💖 Loved';
  api('/api/heart', { postId: viewing.id }).catch(() => {});
};
$('viewer-delete').onclick = async () => {
  if (!viewing || !confirm('Delete this for both of you?')) return;
  await api(`/api/posts/${viewing.id}`, null, 'DELETE').catch((e) => toast(e.message));
  posts = posts.filter((p) => p.id !== viewing.id);
  history.back();
  renderMemories();
  renderDoodleBook();
  refresh();
};
$('viewer-replay').onclick = () => {
  const p = viewing;
  history.back();
  showGift({ id: p.giftId, url: p.url, mime: p.mime, musicUrl: p.musicUrl, title: p.caption, message: p.message || '', teaser: 'Your gift 🎁' }, true);
};

// ---------- Draw ----------

const padCanvas = $('pad');
const pctx = padCanvas.getContext('2d');
let strokes = [];
let stroke = null;
let penColor = COLORS[1];
let penSize = SIZES[1];
let erasing = false;

COLORS.forEach((c, i) => {
  const b = el('button', { title: c, class: i === 1 ? 'active' : '' });
  b.style.background = c;
  b.onclick = () => {
    penColor = c;
    erasing = false;
    $('eraser').classList.remove('active');
    document.querySelectorAll('#colors button').forEach((x) => x.classList.toggle('active', x === b));
  };
  $('colors').append(b);
});
SIZES.forEach((s, i) => {
  const dot = el('i');
  dot.style.width = dot.style.height = `${s + 3}px`;
  const b = el('button', { class: i === 1 ? 'active' : '' }, dot);
  b.onclick = () => {
    penSize = s;
    document.querySelectorAll('#sizes button').forEach((x) => x.classList.toggle('active', x === b));
  };
  $('sizes').append(b);
});
$('eraser').onclick = () => {
  erasing = !erasing;
  $('eraser').classList.toggle('active', erasing);
};
$('undo').onclick = () => {
  strokes.pop();
  redrawPad();
};
$('clear').onclick = () => {
  if (strokes.length > 3 && !confirm('Clear the whole drawing?')) return;
  strokes = [];
  redrawPad();
};

function sizePad() {
  const w = padCanvas.clientWidth;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  padCanvas.width = Math.round(w * dpr);
  padCanvas.height = Math.round(w * dpr);
  redrawPad();
}

function drawStroke(ctx, s, W, from = 1) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = (s.size * W) / 360;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pts = s.points;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * W, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[from - 1][0] * W, pts[from - 1][1] * W);
  for (let i = from; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * W);
  ctx.stroke();
}

function redrawPad(ctx = pctx, W = padCanvas.width) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, W);
  strokes.forEach((s) => drawStroke(ctx, s, W));
}

function padPoint(e) {
  const r = padCanvas.getBoundingClientRect();
  return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.width))];
}
padCanvas.addEventListener('pointerdown', (e) => {
  try {
    padCanvas.setPointerCapture(e.pointerId);
  } catch { /* not a real pointer */ }
  stroke = { color: erasing ? '#ffffff' : penColor, size: erasing ? penSize * 2.5 : penSize, points: [padPoint(e)] };
  strokes.push(stroke);
  drawStroke(pctx, stroke, padCanvas.width);
});
padCanvas.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const events = coalesced.length ? coalesced : [e];
  const start = stroke.points.length;
  events.forEach((ev) => stroke.points.push(padPoint(ev)));
  drawStroke(pctx, stroke, padCanvas.width, start);
});
['pointerup', 'pointercancel'].forEach((t) => padCanvas.addEventListener(t, () => (stroke = null)));
window.addEventListener('resize', () => !$('view-draw').hidden && sizePad());

async function openDraw() {
  requestAnimationFrame(sizePad);
  await loadPosts();
  renderDoodleBook();
}

function renderDoodleBook() {
  const list = posts.filter((p) => p.kind === 'doodle');
  const grid = $('doodle-grid');
  grid.innerHTML = '';
  list.forEach((p) => grid.append(memItem(p)));
  $('doodle-empty').hidden = list.length > 0;
}

$('send-doodle').onclick = () => {
  if (!strokes.length) return toast('Draw something first ✏️');
  withButton($('send-doodle'), 'Sending…', async () => {
    const out = document.createElement('canvas');
    out.width = out.height = 1080;
    redrawPad(out.getContext('2d'), 1080);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    const up = await upload(blob, 'drawing.png');
    await api('/api/doodle', { mediaId: up.id, caption: $('doodle-caption').value });
    strokes = [];
    redrawPad();
    $('doodle-caption').value = '';
    toast('Drawing sent! 🎨💕');
    await loadPosts();
    renderDoodleBook();
  });
};

// ---------- Calendar ----------

let calMonth = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
})();
let selectedDay = null;

function eventRow(ev, date) {
  const when = ev.type === 'trip' && ev.end
    ? `${prettyDate(ev.start, { day: 'numeric', month: 'short' })} → ${prettyDate(ev.end, { day: 'numeric', month: 'short' })}`
    : `${prettyDate(date || ev.start)}${ev.time ? ` · ${ev.time}` : ''}`;
  let status = null;
  if (ev.type === 'date' && ev.status === 'pending') {
    status = isInviteForMe(ev) ? el('span', { class: 'status answer' }, '💌 answer me') : el('span', { class: 'status waiting' }, '⏳ waiting');
  } else if (ev.status === 'declined') {
    status = el('span', { class: 'status declined' }, '🥺 not this time');
  } else if (ev.type === 'date' && ev.status === 'accepted') {
    status = el('span', { class: 'status' }, '💖 yes');
  }
  return el('button', { class: `event ${ev.status === 'declined' ? 'declined' : ''}`, onclick: () => (isInviteForMe(ev) ? openInvite(ev) : openEvent({ ev })) },
    el('span', { class: 'emoji' }, EVENT_EMOJI[ev.type] || '📌'),
    el('span', {}, el('b', {}, ev.title, status), el('span', { class: 'when' }, when)),
    date && ev.status !== 'declined' ? el('span', { class: 'in' }, inDays(date)) : null);
}

function renderCalendar() {
  if (!state) return;
  const events = liveEvents();
  const today = todayStr();

  // Highlights
  const hl = $('cal-highlights');
  hl.innerHTML = '';
  const trip = upcoming(events, 1, (e) => e.type === 'trip')[0];
  if (trip) {
    const n = daysBetween(today, trip.ev.start);
    hl.append(el('div', { class: 'highlight trip' },
      el('div', { class: 'big' }, n <= 0 ? 'Together now 💞' : `${n} day${n > 1 ? 's' : ''}`),
      el('div', {}, n <= 0 ? trip.ev.title : `until ${trip.ev.title} ✈️`)));
  }
  if (state.togetherSince) {
    const n = daysBetween(state.togetherSince, today);
    hl.append(el('div', { class: 'highlight love' }, el('div', { class: 'big' }, `${n.toLocaleString()} days`), el('div', {}, 'of us 💞')));
  }
  $('together-date').value = state.togetherSince || '';

  // Month grid
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  $('cal-month').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const grid = $('cal-grid');
  grid.innerHTML = '';
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const d = new Date(y, m, i - offset + 1);
    const ds = ymd(d);
    const on = events.filter((ev) => occursOn(ev, ds));
    const types = [...new Set(on.map((ev) => (ev.status === 'pending' ? 'date pending' : ev.type)))];
    const cls = ['day'];
    if (d.getMonth() !== m) cls.push('other-month');
    if (ds === today) cls.push('today');
    if (ds === selectedDay) cls.push('selected');
    if (types.includes('trip')) cls.push('trip-day');
    grid.append(el('button', {
      class: cls.join(' '),
      onclick: () => {
        selectedDay = selectedDay === ds ? null : ds;
        renderCalendar();
      },
    }, String(d.getDate()), el('span', { class: 'dots' }, types.map((t) => el('i', { class: `dot ${t}` })))));
  }

  // List: selected day, or upcoming
  const list = $('day-list');
  list.innerHTML = '';
  if (selectedDay) {
    $('day-title').textContent = prettyDate(selectedDay, { weekday: 'long', day: 'numeric', month: 'long' });
    const on = events.filter((ev) => occursOn(ev, selectedDay));
    on.forEach((ev) => list.append(eventRow(ev)));
    if (!on.length) list.append(el('p', { class: 'hint' }, 'Nothing planned yet. Add something? 💭'));
  } else {
    $('day-title').textContent = 'Coming up';
    const next = upcoming(events, 12);
    next.forEach((x) => list.append(eventRow(x.ev, x.date)));
    if (!next.length) list.append(el('p', { class: 'hint' }, 'Add your next trip, your anniversary, birthdays and date nights ✨'));
  }
}
$('cal-prev').onclick = () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
  renderCalendar();
};
$('cal-next').onclick = () => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
  renderCalendar();
};
$('add-event').onclick = () => openEvent({ date: selectedDay || todayStr() });
$('together-save').onclick = async () => {
  try {
    state = await api('/api/settings', { togetherSince: $('together-date').value || null });
    save('kitty_state', state);
    toast('Saved 💞');
    renderCalendar();
    renderHome();
  } catch (e) {
    toast(e.message);
  }
};

// Event editor
let editing = null;
let evType = 'date';
function setEvType(t) {
  evType = t;
  document.querySelectorAll('#event-types button').forEach((b) => b.classList.toggle('active', b.dataset.type === t));
  $('ev-end-wrap').hidden = t !== 'trip';
  $('ev-time-wrap').hidden = t === 'trip' || t === 'special';
  $('ev-yearly-wrap').hidden = t !== 'special';
  $('ev-submit').textContent = t === 'date' && !editing ? 'Send invitation 💌' : 'Save';
}
document.querySelectorAll('#event-types button').forEach((b) => (b.onclick = () => {
  setEvType(b.dataset.type);
  if (b.dataset.type === 'special' && !editing) $('ev-yearly').checked = true;
}));

function openEvent({ ev, date, type, title, notes }) {
  editing = ev || null;
  $('event-heading').textContent = ev ? 'Edit plan' : 'New plan';
  setEvType(ev ? ev.type : type || 'date');
  $('ev-title').value = ev ? ev.title : title || '';
  $('ev-start').value = ev ? ev.start : date || todayStr();
  $('ev-end').value = ev ? ev.end || '' : '';
  $('ev-time').value = ev ? ev.time || '' : type === 'date' ? '20:00' : '';
  $('ev-yearly').checked = ev ? !!ev.yearly : false;
  $('ev-notes').value = ev ? ev.notes || '' : notes || '';
  $('ev-delete').hidden = !ev;
  $('event-sheet').hidden = false;
}
$('ev-cancel').onclick = () => ($('event-sheet').hidden = true);
$('event-form').onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    id: editing && editing.id,
    type: evType,
    title: $('ev-title').value,
    start: $('ev-start').value,
    end: evType === 'trip' ? $('ev-end').value : null,
    time: evType === 'trip' || evType === 'special' ? null : $('ev-time').value,
    yearly: evType === 'special' && $('ev-yearly').checked,
    notes: $('ev-notes').value,
  };
  try {
    await api('/api/events', body);
    $('event-sheet').hidden = true;
    const moved = editing && (editing.start !== body.start || (editing.time || '') !== (body.time || ''));
    toast(evType === 'date' && (!editing || moved || editing.status === 'declined')
      ? 'Invitation sent 💌 Waiting for your sweetie…'
      : editing ? 'Updated ✨' : 'Added to your calendar 📅');
    await refresh();
    renderCalendar();
    renderDates();
  } catch (err) {
    toast(err.message);
  }
};
$('ev-delete').onclick = async () => {
  if (!editing || !confirm('Delete this plan?')) return;
  await api(`/api/events/${editing.id}`, null, 'DELETE').catch(() => {});
  $('event-sheet').hidden = true;
  await refresh();
  renderCalendar();
  renderDates();
};

// ---------- Date invitations ----------

function renderInvites() {
  const box = $('invites');
  box.innerHTML = '';
  const invites = unlocked() ? liveEvents().filter(isInviteForMe) : [];
  invites.forEach((ev) => box.append(el('button', { class: 'invite-chip', onclick: () => openInvite(ev) },
    el('span', { class: 'env' }, '💌'),
    el('span', {}, el('b', {}, 'You have a date invitation!'), el('span', { class: 'small' }, 'Tap to open it')))));
  box.hidden = !invites.length;
}

const inviteKey = (ev) => `${ev.id}|${ev.start}|${ev.time || ''}`;
function maybeOpenInvite() {
  if (!unlocked() || !$('invite').hidden || !$('gift').hidden) return;
  const seen = load('kitty_seen_invites', true) || [];
  const fresh = liveEvents().find((ev) => isInviteForMe(ev) && !seen.includes(inviteKey(ev)));
  if (fresh) openInvite(fresh);
}

let inviting = null;
function openInvite(ev) {
  inviting = ev;
  const seen = load('kitty_seen_invites', true) || [];
  if (!seen.includes(inviteKey(ev))) save('kitty_seen_invites', [...seen, inviteKey(ev)].slice(-50));
  $('envelope').classList.remove('open');
  $('invite-card').hidden = true;
  $('invite-tap').hidden = false;
  $('invite').hidden = false;
  $('invite-title').textContent = ev.title;
  const n = daysBetween(todayStr(), ev.start);
  $('invite-when').textContent = `${prettyDate(ev.start, { weekday: 'long', day: 'numeric', month: 'long' })}${ev.time ? ` at ${ev.time}` : ''}`
    + (n > 1 ? ` · in ${n} days` : n === 1 ? ' · tomorrow' : n === 0 ? ' · tonight!' : '');
  $('invite-notes').textContent = ev.notes || '';
  $('invite-notes').hidden = !ev.notes;
}
function closeInvite() {
  $('invite').hidden = true;
  inviting = null;
}
$('envelope').onclick = () => {
  if ($('envelope').classList.contains('open')) return;
  $('envelope').classList.add('open');
  $('invite-tap').hidden = true;
  setTimeout(() => ($('invite-card').hidden = false), 1000);
};
$('invite-close').onclick = closeInvite;
async function answerInvite(answer, btn) {
  if (!inviting) return;
  const ev = inviting;
  await withButton(btn, '…', async () => {
    await api(`/api/events/${ev.id}/respond`, { answer });
    closeInvite();
    toast(answer === 'yes' ? "It's a date! 💖 Your sweetie will be so happy" : 'Okay, maybe another time 🥺');
    if (answer === 'yes') heartBurst($('heart-burst'));
    await refresh();
    renderCalendar();
    renderDates();
  });
}
$('invite-yes').onclick = (e) => answerInvite('yes', e.currentTarget);
$('invite-no').onclick = (e) => answerInvite('no', e.currentTarget);
$('invite-later').onclick = () => {
  const ev = inviting;
  closeInvite();
  openEvent({ ev });
  toast('Pick another day or time, then save to send it back 💌');
};

// ---------- Date nights ----------

function renderDates() {
  if (!state) return;
  const planned = upcoming(state.events || [], 20, (e) => e.type === 'date');
  $('planned').hidden = !planned.length;
  $('planned-list').innerHTML = '';
  planned.forEach((x) => $('planned-list').append(eventRow(x.ev, x.date)));

  const box = $('ideas');
  if (box.children.length) return;
  const card = ([emoji, title, desc]) => el('div', { class: 'idea', 'data-idea': title },
    el('span', { class: 'e' }, emoji),
    el('b', {}, title),
    el('p', {}, desc),
    el('button', { onclick: () => openEvent({ type: 'date', title: `${title} ${emoji}`, notes: desc, date: nextFriday() }) }, '🗓️ Plan it'));
  for (const g of DATE_IDEAS) {
    box.append(el('section', { class: 'idea-group' }, el('h3', {}, g.group), el('div', { class: 'ideas' }, g.items.map(card))));
  }
  box.append(el('details', { class: 'other-ideas' },
    el('summary', {}, `💡 Other ideas (${OTHER_IDEAS.length})`),
    el('div', { class: 'ideas' }, OTHER_IDEAS.map(card))));
}

function nextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
  return ymd(d);
}

$('surprise').onclick = () => {
  const all = [...document.querySelectorAll('.idea-group .idea')];
  const pickEl = all[Math.floor(Math.random() * all.length)];
  pickEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  pickEl.classList.remove('flash');
  void pickEl.offsetWidth;
  pickEl.classList.add('flash');
};

// ---------- Gift reveal ----------

let giftShownId = null;
function maybeShowGift(gift) {
  if (giftShownId === gift.id || !$('gift').hidden) return;
  showGift(gift, false);
}

function fadeVolume(audio, to, ms) {
  const from = audio.volume;
  const startT = performance.now();
  return new Promise((resolve) => {
    const step = (t) => {
      const k = Math.min(1, (t - startT) / ms);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function showGift(gift, preview) {
  giftShownId = gift.id;
  const overlay = $('gift');
  overlay.hidden = false;
  overlay.classList.remove('revealed');
  $('gift-stage').classList.remove('gone');
  $('gift-reveal').hidden = true;
  $('gift-after').hidden = true;
  $('gift-close').hidden = !preview;
  $('gift-title-text').classList.remove('show');
  $('gift-media').classList.remove('show');
  $('gift-teaser-text').textContent = preview ? '👀 Preview: this is what she will see' : 'Something special is waiting for you…';
  const box = $('giftbox');
  box.className = 'giftbox';

  const isVideo = gift.mime && gift.mime.startsWith('video/');
  const mediaEl = isVideo
    ? el('video', { src: gift.url, preload: 'auto', playsinline: true })
    : el('img', { src: gift.url, alt: '' });
  const music = gift.musicUrl ? el('audio', { src: gift.musicUrl, preload: 'auto', loop: true }) : null;
  $('gift-media').innerHTML = '';
  $('gift-media').append(mediaEl);

  const finish = () => {
    if (music) fadeVolume(music, 0, 1200).then(() => music.pause());
    if (isVideo) mediaEl.pause();
    overlay.hidden = true;
    $('gift-media').innerHTML = '';
    stopConfetti();
    if (!preview) {
      refresh();
      if (gift.unlocks !== false) $('nav').classList.add('fresh');
    }
  };
  $('gift-close').onclick = finish;
  $('gift-done').onclick = finish;

  const showAfter = () => {
    $('gift-message-text').textContent = gift.message || '';
    $('gift-message-text').hidden = !gift.message;
    $('gift-unlock-text').hidden = preview || gift.unlocks === false;
    $('gift-done').textContent = preview ? 'Close preview' : gift.unlocks === false ? 'Close 💞' : "Let's explore 💞";
    $('gift-after').hidden = false;
    burstConfetti(0.5);
  };

  box.onclick = async () => {
    box.onclick = null;
    box.classList.add('shake');
    if (music) {
      music.volume = 0;
      music.play().then(() => fadeVolume(music, 0.85, 2500)).catch(() => {});
    }
    if (isVideo) {
      // Start the video inside this tap so the browser allows sound, then wait at the start.
      mediaEl.muted = true;
      mediaEl.play().then(() => {
        mediaEl.pause();
        mediaEl.currentTime = 0;
        mediaEl.muted = false;
      }).catch(() => (mediaEl.muted = false));
    }
    if (!preview) api(`/api/gifts/${gift.id}/open`, {}).catch(() => {});
    await sleep(650);
    box.classList.remove('shake');
    box.classList.add('open');
    burstConfetti(1);
    await sleep(900);
    $('gift-stage').classList.add('gone');
    overlay.classList.add('revealed');
    $('gift-reveal').hidden = false;
    $('gift-close').hidden = false;
    $('gift-title-text').textContent = gift.title || '🎁';
    await sleep(100);
    $('gift-title-text').classList.add('show');
    await sleep(1800);
    $('gift-media').classList.add('show');
    if (isVideo) {
      if (music) fadeVolume(music, 0, 1600).then(() => music.pause());
      await sleep(400);
      mediaEl.currentTime = 0;
      mediaEl.onended = showAfter;
      mediaEl.onclick = () => (mediaEl.paused ? mediaEl.play() : mediaEl.pause());
      mediaEl.play().catch(() => {
        const btn = el('button', { class: 'gift-play', onclick: () => { btn.remove(); mediaEl.play(); } }, '▶️');
        $('gift-media').append(btn);
      });
    } else {
      mediaEl.classList.add('kenburns');
      await sleep(4500);
      showAfter();
    }
  };
}

// Confetti: hearts, sparkles and paper bits
const confettiCanvas = $('confetti');
const cctx = confettiCanvas.getContext('2d');
let particles = [];
let confettiRaf = null;
function burstConfetti(strength) {
  const W = (confettiCanvas.width = innerWidth * devicePixelRatio);
  const H = (confettiCanvas.height = innerHeight * devicePixelRatio);
  const cx = W / 2;
  const cy = H * 0.5;
  const symbols = ['💖', '💕', '✨', '🌸', '💗'];
  const colors = ['#ff7aa8', '#ffd6e5', '#ffe08a', '#b9a3f0', '#8fdcc2', '#ffffff'];
  for (let i = 0; i < 140 * strength; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const v = (8 + Math.random() * 14) * devicePixelRatio;
    particles.push({
      x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      life: 1, decay: 0.006 + Math.random() * 0.008,
      emoji: Math.random() < 0.35 ? symbols[Math.floor(Math.random() * symbols.length)] : null,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: (6 + Math.random() * 8) * devicePixelRatio,
    });
  }
  if (!confettiRaf) confettiRaf = requestAnimationFrame(tickConfetti);
}
function tickConfetti() {
  const W = confettiCanvas.width;
  const H = confettiCanvas.height;
  cctx.clearRect(0, 0, W, H);
  particles = particles.filter((p) => p.life > 0 && p.y < H + 50);
  for (const p of particles) {
    p.vy += 0.25 * devicePixelRatio;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    p.life -= p.decay;
    cctx.save();
    cctx.globalAlpha = Math.max(0, p.life);
    cctx.translate(p.x, p.y);
    cctx.rotate(p.r);
    if (p.emoji) {
      cctx.font = `${p.size * 2.2}px serif`;
      cctx.fillText(p.emoji, 0, 0);
    } else {
      cctx.fillStyle = p.color;
      cctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    cctx.restore();
  }
  confettiRaf = particles.length ? requestAnimationFrame(tickConfetti) : null;
}
function stopConfetti() {
  particles = [];
  cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
}

// ---------- Start ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'refresh') refresh();
    if (e.data.type === 'open' && e.data.url) {
      const hash = new URL(e.data.url, location.href).hash;
      if (hash) location.hash = hash;
      refresh();
    }
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000);

if (state && (token || herKey)) renderAll();
route();
refresh();
