# Water reminder 💧
Personal water-tracker PWA. Static files only (no build, no CDNs). Open on iPhone in Safari → Share → Add to Home Screen.
- `index.html`, `styles.css`, `app.js` — the app (data in localStorage, day resets at IST midnight)
- `sw.js` — offline cache (bump `VERSION` after editing files)
- `make_icons.py` — regenerates icons; `test_app.py` — headless Playwright test + .ics validation
