"""Headless push UI test: iPhone viewport, Safari-tab vs Home Screen (standalone) modes, enable flow,
local test notification, and a CDP-delivered push event handled by sw.js."""
import json, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent
SHOTS = ROOT / "screenshots"; SHOTS.mkdir(exist_ok=True)
PORT = 8766
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors, R = [], {}
url = f"http://127.0.0.1:{PORT}/"

def ctx_for(b, standalone):
    if standalone:  # non-incognito profile: Chromium disables the Push API in incognito contexts
        import tempfile
        ctx = pw.chromium.launch_persistent_context(tempfile.mkdtemp(), channel="chromium", viewport={"width": 390, "height": 844}, device_scale_factor=3,
                        is_mobile=True, has_touch=True, timezone_id="Asia/Kolkata", user_agent=UA)
    else:
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                        timezone_id="Asia/Kolkata", user_agent=UA)
    if standalone:
        ctx.add_init_script("Object.defineProperty(navigator, 'standalone', {get: () => true});")
        ctx.grant_permissions(["notifications"], origin=url.rstrip("/"))
    p = ctx.pages[0] if ctx.pages else ctx.new_page()
    p.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    return ctx, p

def open_settings(p):
    p.goto(url); p.wait_for_load_state("networkidle")
    p.evaluate("navigator.serviceWorker.ready")
    p.click(".tab[data-view=settings]"); p.wait_for_timeout(400)
    p.evaluate("document.getElementById('pushCard').scrollIntoView({block:'start'}); window.scrollBy(0,-70)")

try:
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        # 1) Opened in a Safari tab: must show the Home Screen note, button disabled
        ctx, p = ctx_for(b, False)
        open_settings(p)
        R["safari_note"] = p.inner_text("#pushNote")
        R["safari_btn_disabled"] = p.is_disabled("#pushEnable")
        R["sw_version"] = p.evaluate("fetch('sw.js').then(r=>r.text()).then(t=>t.match(/VERSION = '([^']+)'/)[1])")
        p.screenshot(path=str(SHOTS / "5-push-safari-tab.png")); ctx.close()

        # 2) Home Screen app: enable -> subscribe -> code box -> copy -> test notification
        ctx, p = ctx_for(b, True)
        open_settings(p)
        R["standalone_btn_enabled"] = p.is_enabled("#pushEnable")
        real = True
        p.click("#pushEnable"); p.wait_for_timeout(4000)
        if p.is_hidden("#pushSubBox"):
            # Headless Chromium has no push service; stub subscribe() to exercise the rest of the UI flow.
            real = False
            R["real_subscribe_error"] = p.inner_text("#pushStatus")
            p.evaluate("""() => { PushManager.prototype.getSubscription = async () => null;
              PushManager.prototype.subscribe = async function (o) { window.__opts = o; return {endpoint:'https://web.push.apple.com/QFAKE',
                expirationTime:null, keys:{p256dh:'BFAKE',auth:'AFAKE'}, toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:this.keys};}}; }; }""")
            p.click("#pushEnable"); p.wait_for_timeout(1000)
            R["subscribe_opts"] = p.evaluate("({uvo: window.__opts.userVisibleOnly, keyLen: window.__opts.applicationServerKey.length, first: window.__opts.applicationServerKey[0]})")
        R["real_subscribe"] = real
        R["code_json"] = json.loads(p.input_value("#pushCode"))
        R["note_after_enable"] = p.inner_text("#pushNote")
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=url.rstrip("/"))
        p.click("#pushCopy"); p.wait_for_timeout(500)
        R["clipboard_matches"] = p.evaluate("navigator.clipboard.readText()") == p.input_value("#pushCode")
        R["copy_note"] = p.inner_text("#pushCopyNote")
        p.click("#pushTest"); p.wait_for_timeout(1500)
        R["test_status"] = p.inner_text("#pushStatus")
        R["notifications_after_test"] = p.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(ns=>ns.map(n=>[n.title,n.body,n.tag]))")
        p.wait_for_timeout(1900)
        p.screenshot(path=str(SHOTS / "6-push-enabled.png"))

        # 2b) Real end-to-end push through the browser's push service using scripts/send_push.py
        #     (only when a real subscription was created and a VAPID private key file is provided locally).
        import os
        kf = os.environ.get("VAPID_PRIVATE_KEY_FILE")
        if real and kf:
            env = dict(os.environ, PUSH_SUBSCRIPTION=p.input_value("#pushCode"), VAPID_PRIVATE_KEY=open(kf).read().strip(),
                       VAPID_SUBJECT="mailto:test@example.com", PUSH_BODY="End-to-end test push")
            out = subprocess.run([os.environ.get("PUSH_PYTHON", sys.executable), str(ROOT / "scripts/send_push.py")],
                                 env=env, capture_output=True, text=True, timeout=60)
            R["e2e_script"] = (out.returncode, out.stdout.strip(), out.stderr.strip()[-300:])
            got = []
            for _ in range(30):
                got = p.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications({tag:'water'})).then(ns=>ns.map(n=>[n.title,n.body]))")
                if got: break
                p.wait_for_timeout(1000)
            R["e2e_notification"] = got
            p.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications()).then(ns=>ns.forEach(n=>n.close()))")

        # 3) Deliver push events to the SW via CDP and check the notification it shows
        cdp = ctx.new_cdp_session(p)
        regs = []
        cdp.on("ServiceWorker.workerRegistrationUpdated", lambda e: regs.extend(e["registrations"]))
        cdp.send("ServiceWorker.enable"); p.wait_for_timeout(800)
        reg_id = next(r["registrationId"] for r in regs if not r.get("isDeleted"))
        origin = url.rstrip("/")
        cdp.send("ServiceWorker.deliverPushMessage", {"origin": origin, "registrationId": reg_id,
                 "data": json.dumps({"title": "Drink water 💧", "body": "Hello from the workflow"})})
        p.wait_for_timeout(1500)
        R["push_json_notifications"] = p.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications({tag:'water'})).then(ns=>ns.map(n=>[n.title,n.body,n.tag,n.renotify,n.icon.split('/').pop()]))")
        cdp.send("ServiceWorker.deliverPushMessage", {"origin": origin, "registrationId": reg_id, "data": ""})
        p.wait_for_timeout(1500)
        R["push_empty_notifications"] = p.evaluate("navigator.serviceWorker.ready.then(r=>r.getNotifications({tag:'water'})).then(ns=>ns.map(n=>[n.title,n.body]))")
        ctx.close(); b.close()
finally:
    srv.terminate()

m = json.loads((ROOT / "manifest.json").read_text())
R["manifest_ok"] = all(k in m for k in ("name", "short_name", "start_url", "display", "icons")) and m["display"] == "standalone" \
    and all((ROOT / i["src"]).exists() for i in m["icons"])
print(json.dumps({"results": R, "errors": errors}, indent=1, ensure_ascii=False))
