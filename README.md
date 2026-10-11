# Daily Kitty 🐾

A cute kitty every morning. It is built the same way as qui-de-nous: a small Node server plus a PWA that you install from Chrome. It needs no APK and no Android Studio.

**What she sees:** a new kitty every day at 09:00, with a notification that shows the picture. She also sees your love notes.

**What you see (hidden):** tap the **"Daily Kitty 🐾" title 7 times quickly** and enter the passphrase. The **first passphrase ever entered becomes the passphrase**, so do this first on your phone. A "Send something 💌" button then appears, only on your phone. From there you can:
- send a photo from your gallery, or a kitty from the pool, with an optional message. It replaces today's kitty and she gets a notification with the picture.
- send a love note ("Your sweetie misses you 🥺", etc.). She gets it as a notification and sees it in the app for 24 h.

The 🔒 icon in the panel hides sweetie mode again.

## Running it

```bash
npm install
npm start   # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres URL. It can be the same database as qui-de-nous, because the tables are prefixed with `kitty_`. Without it, data goes to `data/`. |
| `TIME_ZONE` | Default `Europe/London` |
| `DAILY_HOUR` | Default `9` |
| `SENDER_PASSPHRASE` | Optional. Fixes the passphrase instead of using the first one entered. |

## Deploy
Render → New → Blueprint → pick this repo (see `render.yaml`).

Render's free plan sleeps when nobody uses it. To make sure the daily kitty still goes out, `.github/workflows/daily-kitty.yml` wakes the server every morning by calling `POST /api/daily`. The app also delivers the daily kitty if someone opens it after 09:00 and it hasn't gone out yet.

## Install on the phones
1. Open the Render URL in Chrome.
2. Tap **Install**, or use ⋮ → Add to home screen.
3. Tap **Turn on** for notifications.
4. On Samsung: Settings → Apps → Chrome → Battery → **Unrestricted**, so notifications aren't delayed.
