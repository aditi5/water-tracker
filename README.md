# Water reminder 💧
Personal water-tracker PWA. Static files only (no build, no CDNs). Open on iPhone in Safari → Share → Add to Home Screen.
- `index.html`, `styles.css`, `app.js` — the app (data in localStorage, day resets at IST midnight)
- `sw.js` — offline cache + Web Push handler (bump `VERSION` after editing files)
- `make_icons.py` — regenerates icons; `test_app.py` — headless Playwright test + .ics validation

## Push reminders (iPhone, iOS 16.4+)
- `.github/workflows/remind.yml` runs at 09:00, 11:00 … 21:00 IST (cron in UTC, may start a few minutes late) and on manual `workflow_dispatch`.
- `scripts/send_push.py` sends the push with pywebpush. Secrets: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SUBSCRIPTION` (the code copied from Settings > Enable notifications in the Home Screen app). No subscription = exits 0; expired subscription (404/410) = fails.
- The VAPID public key is in `app.js`. Push times are fixed; the in-app times only affect the .ics calendar fallback.
- GitHub disables scheduled workflows after 60 days without repo activity: re-enable in the Actions tab (or push a commit).
- `test_push.py` — headless test of the notification UI + service-worker push handling.
