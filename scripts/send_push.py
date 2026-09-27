"""Send one "Drink water" Web Push to the subscription stored in PUSH_SUBSCRIPTION.

Env vars (set as GitHub Actions secrets):
  PUSH_SUBSCRIPTION  JSON copied from the app (Settings > Enable notifications > Copy notification code)
  VAPID_PRIVATE_KEY  VAPID private key (raw base64url); the matching public key is in app.js
  VAPID_SUBJECT      mailto: contact for the push service
Optional: PUSH_TITLE, PUSH_BODY to override the message.
Exit codes: 0 = sent, or no subscription configured yet; 1 = error (incl. expired subscription).
"""
import datetime, json, os, random, sys

MESSAGES = [
    "Time for a glass of water, Aditi 💙",
    "A few sips now keeps the headache away 🌊",
    "Hydration check! Grab a glass 🥤",
    "Your body will thank you — drink some water ✨",
    "Quick water break? You've got this 💪",
]


def main():
    sub_raw = (os.environ.get("PUSH_SUBSCRIPTION") or "").strip()
    if not sub_raw:
        print("PUSH_SUBSCRIPTION secret is not set: no subscription yet, nothing to send. "
              "Enable notifications in the app and save the copied code as the PUSH_SUBSCRIPTION secret.")
        return 0

    key = (os.environ.get("VAPID_PRIVATE_KEY") or "").strip()
    subject = (os.environ.get("VAPID_SUBJECT") or "").strip() or "mailto:noreply@example.com"
    if not key:
        print("::error::VAPID_PRIVATE_KEY secret is missing, cannot sign the push.")
        return 1

    try:
        sub = json.loads(sub_raw)
        assert sub["endpoint"] and sub["keys"]["p256dh"] and sub["keys"]["auth"]
    except Exception:
        print("::error::PUSH_SUBSCRIPTION is not valid subscription JSON (needs endpoint, keys.p256dh, keys.auth). "
              "Copy the notification code from the app again.")
        return 1

    from pywebpush import webpush, WebPushException

    now_ist = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))
    payload = {
        "title": os.environ.get("PUSH_TITLE") or "Drink water 💧",
        "body": os.environ.get("PUSH_BODY") or random.choice(MESSAGES),
        "ts": now_ist.isoformat(timespec="minutes"),
    }
    host = sub["endpoint"].split("/")[2]
    try:
        resp = webpush(
            subscription_info=sub,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=key,
            vapid_claims={"sub": subject},
            ttl=3600,  # drop the reminder if the phone is unreachable for over an hour
            headers={"Urgency": "high"},
        )
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        detail = (getattr(e.response, "text", "") or "")[:300]
        if status in (404, 410):
            print(f"::error::Push subscription has expired or was removed (HTTP {status} from {host}). "
                  "Open the app from the Home Screen, tap Settings > Enable notifications again, "
                  "and update the PUSH_SUBSCRIPTION secret with the new code.")
        else:
            print(f"::error::Push failed (HTTP {status} from {host}): {e} {detail}")
        return 1
    print(f"Push sent at {payload['ts']} IST via {host}: HTTP {resp.status_code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
