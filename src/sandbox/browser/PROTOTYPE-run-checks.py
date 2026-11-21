# PROTOTYPE runner: opens PROTOTYPE-browser-kernel.html in Chromium, Firefox and WebKit and prints the checks.
# Serve the folder first: python3 -m http.server 8765 (from src/sandbox/browser), then:
#   ~/.claude/skills/seo/.venv/bin/python src/sandbox/browser/PROTOTYPE-run-checks.py [http|file]
import json, pathlib, sys
from playwright.sync_api import sync_playwright

here = pathlib.Path(__file__).resolve().parent
mode = sys.argv[1] if len(sys.argv) > 1 else "http"
url = "http://localhost:8765/PROTOTYPE-browser-kernel.html" if mode == "http" else (here / "PROTOTYPE-browser-kernel.html").as_uri()

with sync_playwright() as p:
    for name in ["chromium", "firefox", "webkit"]:
        browser = getattr(p, name).launch()
        page = browser.new_page()
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
        page.goto(url)
        try:
            results = page.evaluate("runChecks()")
        except Exception as e:  # noqa: BLE001
            results = [{"name": "page", "pass": False, "detail": str(e)}]
        print(f"\n=== {name} {browser.version} ({mode}) ===")
        for r in results:
            print(f"{'PASS' if r['pass'] else 'FAIL'}  {r['name']}  | {r['detail']}")
        noisy = [l for l in logs if "error" in l.lower()]
        if noisy:
            print("console:", json.dumps(noisy[:6], indent=1))
        browser.close()
