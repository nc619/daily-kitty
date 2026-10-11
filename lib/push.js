// Web Push notifications. VAPID keys are generated once and kept in the store.
const { store, persist } = require('./store');

let webpush = null;
try {
  webpush = require('web-push');
} catch {
  console.warn('web-push not installed: notifications disabled.');
}

function init() {
  if (!webpush) return;
  if (!store.db.vapid) {
    store.db.vapid = webpush.generateVAPIDKeys();
    persist();
  }
  webpush.setVapidDetails(process.env.PUSH_CONTACT || 'mailto:kitty@example.com', store.db.vapid.publicKey, store.db.vapid.privateKey);
}

function publicKey() {
  return webpush && store.db.vapid ? store.db.vapid.publicKey : null;
}

/** Remembers a phone. role 'sender' = your phone, 'sweetie' = hers. */
function subscribe(sub, role) {
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) return false;
  store.db.subs = store.db.subs.filter((s) => s.endpoint !== sub.endpoint);
  store.db.subs.push({ endpoint: sub.endpoint, keys: sub.keys, role, updatedAt: Date.now() });
  persist();
  return true;
}

/** Sends to every phone matching `filter(sub)`. Dead subscriptions are cleaned up. */
function send(payload, filter = () => true) {
  if (!webpush) return Promise.resolve([]);
  const body = JSON.stringify(payload);
  return Promise.all(
    store.db.subs.filter(filter).map((sub) =>
      webpush
        .sendNotification(sub, body, { TTL: 24 * 3600, urgency: 'high' })
        .then(() => ({ ok: true, role: sub.role }))
        .catch((e) => {
          if (e.statusCode === 404 || e.statusCode === 410) {
            store.db.subs = store.db.subs.filter((s) => s.endpoint !== sub.endpoint);
            persist();
          }
          console.error('Push failed:', e.statusCode || '', e.body || e.message);
          return { ok: false, role: sub.role };
        })
    )
  );
}

module.exports = { init, publicKey, subscribe, send };
