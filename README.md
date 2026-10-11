# Daily Kitty 🐾

A cute kitty every morning, and secretly a little world for a long-distance couple. It is built like qui-de-nous: a small Node server plus a PWA that you install from Chrome.

## What's in it

**For her, from day one:** the daily kitty at 09:00 (hand-picked photos, never repeated) with a notification, plus your love notes.

**The gift 🎁:** prepare a video or photo (with optional background music, a title and a message) in your panel, preview it, and send it when the moment is right.
- She gets a mysterious notification and an animated gift box.
- Confetti, then the video plays with sound and your message appears.
- Opening it **unlocks her full app**:
  - **Memories 🖼️:** every photo, video, drawing and gift, all downloadable.
  - **Draw 🎨:** draw for each other. Drawings arrive as a notification with the picture, so they show on the lock screen. They live in the doodle book.
  - **Calendar 📅:** trips, date nights, special days (yearly), a countdown to the next visit, and a "days together" count. The morning notification lists today's plans.
  - **Date nights 🌙:** around 30 long-distance date ideas, each one plannable into the calendar.
  - **Home extras:** a "thinking of you" nudge, double-tap the kitty to send a 💖, both your clocks when you're in different time zones, and photos and videos from each other.

**Your side:** tap the "Daily Kitty 🐾" title 7 times and enter your passphrase. The first one ever entered becomes the passphrase. Then the 💌 button gives you:
- **Kitty / Note:** send from the pool, from your gallery (photo or video), or a love note.
- **Gift 🎁:** create, preview and send gifts.
- **⚙️ Settings:**
  - **her private link:** she must open the app from it once, and anyone without it only sees a locked page.
  - **her app unlock switch**
  - **storage:** a meter of space used.
  - **kitty pool:** add your own photos, or ✕ to remove kitties you don't like.

## Kitty pool
`lib/cat-pool.json` holds about 100 hand-picked, freely licensed kitten photos from Wikimedia Commons, with credit shown in the app. When they run out, it falls back to TheCatAPI (photos only, no GIFs).

## Running it
```bash
npm install
npm start   # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres. Without it, data goes to `data/`. Media is stored in 1 MB chunks (`kitty_media_chunks`). |
| `TIME_ZONE` / `DAILY_HOUR` | When the daily kitty and the calendar digest arrive (default `Europe/London`, `9`). |
| `MEDIA_LIMIT_MB` | Storage cap for uploads (default 900, for Neon's 1 GB free plan). |
| `SENDER_PASSPHRASE` | Optional. Fixes your passphrase. |

Deploy: Render Blueprint (`render.yaml`). `.github/workflows/daily-kitty.yml` wakes the free server every morning.
