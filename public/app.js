// Daily Kitty: front end.
const $ = (id) => document.getElementById(id);

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

let token = load('kitty_token');
let state = load('kitty_state', true); // last known state, so the app shows something instantly
let picked = null; // { image: dataUrl } or { imageUrl }

// ---------- Small helpers ----------

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

async function api(path, body) {
  const opts = { method: body ? 'POST' : 'GET', headers: {} };
  if (token) opts.headers['x-sweetie-token'] = token;
  if (body) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

function formatTime(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return time;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}

// ---------- Home ----------

function render() {
  $('today').textContent = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  const kitty = state && state.current;
  const frame = $('kitty-frame');
  const img = $('kitty-img');
  if (kitty) {
    frame.classList.remove('empty');
    if (img.dataset.src !== kitty.imageUrl) {
      img.dataset.src = kitty.imageUrl;
      frame.classList.add('loading');
      img.onload = () => frame.classList.remove('loading');
      img.onerror = () => frame.classList.remove('loading');
      img.src = kitty.imageUrl;
    }
    $('kitty-label').textContent = kitty.sentBy === 'sweetie' ? '💌 A special kitty from your sweetie' : "☀️ Today's kitty";
    $('kitty-caption').textContent = kitty.caption || '';
    $('kitty-caption').hidden = !kitty.caption;
    $('kitty-time').textContent = `Arrived ${formatTime(kitty.sentAt)}`;
  } else if (state) {
    frame.classList.remove('loading');
    frame.classList.add('empty');
    $('kitty-label').textContent = '';
    $('kitty-time').textContent = '';
  }

  const note = state && state.note;
  const showNote = note && Date.now() - note.sentAt < 864e5;
  $('note').hidden = !showNote;
  if (showNote) {
    $('note-text').textContent = note.message;
    $('note-time').textContent = formatTime(note.sentAt);
  }

  $('fab').hidden = !(token && state && state.isSender);
}

let refreshing = null;
function refresh() {
  if (refreshing) return refreshing;
  const slow = setTimeout(() => ($('waking').hidden = false), 2500);
  refreshing = api('/api/state')
    .then((s) => {
      state = s;
      save('kitty_state', s);
      if (token && !s.isSender) {
        token = null;
        save('kitty_token', null);
      }
      render();
      syncPush();
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(slow);
      $('waking').hidden = true;
      refreshing = null;
    });
  return refreshing;
}

// ---------- Notifications ----------

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
    if (sub && sub.options.applicationServerKey &&
        new Uint8Array(sub.options.applicationServerKey).toString() !== key.toString()) {
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
    toast('Kitty notifications on 🔔');
    syncPush();
  } else {
    $('notif').hidden = true;
  }
};

// ---------- Install banner ----------

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
    if (token && state && state.isSender) return openPanel();
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

// ---------- Sweetie panel ----------

function openPanel() {
  $('panel').hidden = false;
  history.pushState({ panel: true }, '');
  if (!$('pool').children.length) loadPool();
}
function closePanel() {
  $('panel').hidden = true;
}
window.addEventListener('popstate', closePanel);
$('fab').onclick = openPanel;
$('panel-close').onclick = () => history.back();

$('panel-lock').onclick = async () => {
  await api('/api/lock', {}).catch(() => {});
  token = null;
  save('kitty_token', null);
  if (state) state.isSender = false;
  history.back();
  render();
  syncPush(); // this phone goes back to getting love notes
  toast('Sweetie mode hidden 🤫');
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-body').forEach((b) => (b.hidden = b.id !== tab.dataset.tab));
  };
});

// Kitty tab

function showPicked(src) {
  $('picked-img').src = src;
  $('picked').hidden = false;
  $('picked').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearPicked() {
  picked = null;
  $('picked').hidden = true;
  $('caption').value = '';
  document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
}
$('cancel-pick').onclick = clearPicked;

async function loadPool() {
  const pool = $('pool');
  pool.innerHTML = '<div class="loading-cell">Fetching kitties… 🐾</div>';
  try {
    const { urls } = await api('/api/pool');
    pool.innerHTML = '';
    for (const url of urls) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Kitty';
      img.loading = 'lazy';
      img.onclick = () => {
        document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
        img.classList.add('selected');
        picked = { imageUrl: url };
        showPicked(url);
      };
      pool.appendChild(img);
    }
  } catch {
    pool.innerHTML = '<div class="loading-cell">Couldn\'t fetch kitties right now 😿</div>';
  }
}
$('more').onclick = loadPool;

// Shrinks a gallery photo so it uploads quickly (and fixes its rotation).
async function resizeImage(file, max = 1600, quality = 0.85) {
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
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('gallery').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const image = await resizeImage(file);
    document.querySelectorAll('.pool img.selected').forEach((i) => i.classList.remove('selected'));
    picked = { image };
    showPicked(image);
  } catch {
    toast("Can't read that photo 😿 Try another one");
  }
};

async function withButton(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await fn();
  } catch (e) {
    toast(`Oops, that didn't send 😿 (${e.message})`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

$('send-kitty').onclick = () => {
  if (!picked) return;
  withButton($('send-kitty'), 'Sending…', async () => {
    const r = await api('/api/send-kitty', { ...picked, caption: $('caption').value });
    toast(picked.image ? 'Photo sent! 📸💕' : 'Kitty sent! 🐱💕');
    clearPicked();
    state = { ...state, current: r.current };
    save('kitty_state', state);
    render();
  });
};

// Note tab

for (const text of NOTE_PRESETS) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = text;
  chip.onclick = () => ($('note-input').value = text);
  $('presets').appendChild(chip);
}

$('send-note').onclick = () => {
  const message = $('note-input').value.trim();
  if (!message) return toast('Write something first 💭');
  withButton($('send-note'), 'Sending…', async () => {
    const r = await api('/api/send-note', { message });
    $('note-input').value = '';
    toast(r.delivered ? 'Note sent! 💌' : "Note saved 💌 (her notifications aren't on yet)");
  });
};

// ---------- Start ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'refresh') refresh();
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh();
});
setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000);

render();
refresh();
