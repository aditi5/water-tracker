"""Headless test: iPhone viewport, +1 clicks, screenshots, console errors, ICS download + validation, offline."""
import json, subprocess, sys, time, datetime, pathlib
from playwright.sync_api import sync_playwright
from icalendar import Calendar

ROOT = pathlib.Path(__file__).parent
SHOTS = ROOT / "screenshots"; SHOTS.mkdir(exist_ok=True)
PORT = 8765
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors, results = [], {}
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                            timezone_id="Asia/Kolkata", accept_downloads=True,
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))
        url = f"http://127.0.0.1:{PORT}/"
        page.goto(url); page.wait_for_load_state("networkidle")

        # Seed 6 previous days of sample history (test context only) so the chart has content.
        page.evaluate("""() => {
          const f = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'});
          const s = {settings:{glassMl:250,goalMl:2000,unit:'glasses',times:['09:00','11:00','13:00','15:00','17:00','19:00','21:00']},days:{}};
          const amounts=[2250,1500,2000,2500,1750,2000];
          amounts.forEach((ml,i)=>{ const d=new Date(Date.now()-(6-i)*86400000); const k=f.format(d);
            const n=ml/250; s.days[k]={goal:2000,entries:Array.from({length:n},(_,j)=>({t:d.getTime()-j*3600000,ml:250}))}; });
          localStorage.setItem('water.v1', JSON.stringify(s));
        }""")
        page.reload(); page.wait_for_load_state("networkidle")

        for _ in range(3):
            page.click("#addGlass"); page.wait_for_timeout(150)
        page.click("#undoBtn"); page.click("#addGlass")
        page.click("#customToggle"); page.fill("#customMl", "150"); page.click("#customForm button")
        page.wait_for_timeout(2200)  # let toast fade and ring animate
        results["today_ml"] = page.inner_text("#mlNow")
        results["glasses"] = page.inner_text("#glassesText")
        results["streak"] = page.inner_text("#streakTop")
        page.screenshot(path=str(SHOTS / "1-main.png"))

        page.click(".tab[data-view=history]"); page.wait_for_timeout(800)
        results["history_stats"] = [page.inner_text(s) for s in ("#streakNum", "#avgNum", "#hitNum")]
        page.screenshot(path=str(SHOTS / "3-history.png"))

        page.click(".tab[data-view=settings]"); page.wait_for_timeout(300)
        page.fill("#newTime", "10:30"); page.click("#addTimeForm button")
        page.click("#timesList button[data-time='10:30']")  # remove it again
        results["times"] = page.eval_on_selector_all("#timesList li", "els => els.map(e => e.firstChild.textContent)")
        # goal edit in ml, then back to glasses
        page.click("#unitMl"); page.fill("#goalInput", "2500"); page.dispatch_event("#goalInput", "change")
        results["goal_after_ml_edit"] = page.inner_text("#mlGoal")
        page.click("#unitGlasses"); page.fill("#goalInput", "8"); page.dispatch_event("#goalInput", "change")
        results["goal_after_glasses_edit"] = page.inner_text("#mlGoal")
        with page.expect_download() as dl:
            page.click("#icsBtn")
        d = dl.value
        ics_path = ROOT / "screenshots" / "water-reminders.ics"
        d.save_as(str(ics_path))
        page.wait_for_timeout(1900)
        page.evaluate("() => { const c = document.getElementById('timesList').closest('.card'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 70); }")
        page.wait_for_timeout(200)
        page.screenshot(path=str(SHOTS / "2-settings-reminders.png"))

        # Nudge: simulate last glass 3h ago during reminder hours
        page.click(".tab[data-view=today]")
        page.evaluate("""() => { const s=JSON.parse(localStorage.getItem('water.v1'));
          const f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}); const k=f.format(new Date());
          s.days[k].entries.forEach(e=>e.t-=3*3600000); localStorage.setItem('water.v1',JSON.stringify(s)); }""")
        page.reload(); page.wait_for_load_state("networkidle")
        results["nudge_visible"] = page.is_visible("#nudge")
        results["nudge_text"] = page.inner_text("#nudge") if results["nudge_visible"] else None
        if results["nudge_visible"]:
            page.screenshot(path=str(SHOTS / "4-nudge.png"))

        # Service worker + offline
        results["sw_active"] = page.evaluate("async () => { const r = await navigator.serviceWorker.ready; return !!r.active; }")
        page.reload(); page.wait_for_load_state("networkidle")
        ctx.set_offline(True)
        errors_before = len(errors)
        page.reload(); page.wait_for_load_state("load")
        results["offline_loads"] = page.is_visible("#addGlass")
        del errors[errors_before:]  # offline noise not counted
        ctx.set_offline(False)
        b.close()
finally:
    srv.terminate()

# ---- ICS validation ----
raw = ics_path.read_bytes()
text = raw.decode("utf-8")
checks = {}
checks["crlf_only"] = "\n" not in text.replace("\r\n", "")
checks["max_line_octets"] = max(len(l.encode()) for l in raw.decode().split("\r\n"))
cal = Calendar.from_ical(raw)
evs = [c for c in cal.walk("VEVENT")]
checks["events"] = len(evs)
ev_info = []
for e in evs:
    dt = e.decoded("DTSTART")
    alarms = e.walk("VALARM")
    ev_info.append({
        "summary": str(e["SUMMARY"]), "start": dt.isoformat(), "tz": str(dt.tzinfo),
        "tzid_param": e["DTSTART"].params.get("TZID"),
        "duration": str(e.decoded("DURATION")), "rrule": e["RRULE"].to_ical().decode(),
        "alarm": [(str(a["ACTION"]), str(a.decoded("TRIGGER"))) for a in alarms],
    })
checks["all_ok"] = all(
    i["summary"] == "Drink water 💧" and i["tzid_param"] == "Asia/Kolkata" and i["duration"] == "0:05:00"
    and i["rrule"] == "FREQ=DAILY" and i["alarm"] == [("DISPLAY", "0:00:00")] and i["start"].endswith("+05:30")
    for i in ev_info) and len(ev_info) == 7 and checks["crlf_only"] and checks["max_line_octets"] <= 75
checks["required_props"] = all(k in e for e in evs for k in ("UID", "DTSTAMP", "DTSTART"))
print(json.dumps({"results": results, "ics_checks": checks, "events": ev_info, "errors": errors}, indent=1, ensure_ascii=False))
