"""Render the app with mocked network and screenshot each view.
Usage (from the project root):  python3 dev/fixtures.py dev/fx && python3 dev/shoot.py . dev/fx dev/shots
Set CHROME_PATH to use an installed Chrome; otherwise Playwright's bundled Chromium is used
(run `python3 -m playwright install chromium` once)."""
import asyncio, json, sys, os, base64
from playwright.async_api import async_playwright
APP, FX, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)
fx = lambda n: open(os.path.join(FX, n)).read()
MODELS = json.load(open(os.path.join(FX, "models.json")))
PNG1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")

async def route(r):
    u = r.request.url
    if u.startswith("http://app.test/"):
        p = os.path.join(APP, u.split("http://app.test/")[1].split("?")[0].split("#")[0] or "index.html")
        ct = {"js": "application/javascript", "css": "text/css", "html": "text/html", "png": "image/png", "svg": "image/svg+xml", "webmanifest": "application/json"}.get(p.rsplit(".", 1)[-1], "text/plain")
        return await r.fulfill(path=p, content_type=ct)
    j = lambda body: r.fulfill(status=200, content_type="application/json", body=body, headers={"access-control-allow-origin": "*"})
    if "ensemble-api.open-meteo" in u: return await j(fx("ensemble.json"))
    if "air-quality-api" in u: return await j(fx("air.json"))
    if "geocoding-api" in u: return await j(fx("geocode.json"))
    if "api.open-meteo.com" in u:
        if "minutely_15" in u: return await j(fx("forecast_best.json"))
        if "forecast_days=7" in u:
            m = u.split("models=")[1].split("&")[0]
            return await j(json.dumps(MODELS.get(m, MODELS["ecmwf_ifs"])))
        return await j(fx("forecast_model.json"))
    if "weather/warning" in u: return await j(fx("warnings.json"))
    if "weather/forecast" in u: return await j(fx("met.json"))
    if "weather-maps.json" in u: return await j(fx("radar.json"))
    if "bigdatacloud" in u: return await j(json.dumps({"locality": "Petaling Jaya", "principalSubdivision": "Selangor"}))
    if "cdnjs.cloudflare.com" in u and "leaflet" in u:
        local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "leaflet.js" if u.endswith(".js") else "leaflet.css")
        if os.path.exists(local): return await r.fulfill(path=local)
        return await r.fulfill(status=200, body="")
    if u.endswith(".png") or "basemaps" in u or "tiles.example" in u: return await r.fulfill(status=200, content_type="image/png", body=PNG1)
    if "fonts.g" in u: return await r.fulfill(status=200, body="", content_type="text/css")
    return await r.fulfill(status=404, body="")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        for name, vp in [("phone", {"width": 390, "height": 844}), ("desktop", {"width": 1280, "height": 900})]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=2 if name == "phone" else 1, timezone_id="Asia/Kuala_Lumpur",
                                      permissions=["geolocation"], geolocation={"latitude": 3.107, "longitude": 101.606})
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
            await pg.route("**/*", route)
            await pg.goto("http://app.test/index.html#forecast")
            await pg.wait_for_timeout(2500)
            await pg.screenshot(path=f"{OUT}/{name}-forecast.png", full_page=True)
            # expand first day + switch hourly metric
            await pg.click(".day>button")
            await pg.click('#hourMetric button[data-k="prob"]')
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f"{OUT}/{name}-forecast-prob.png", full_page=True)
            for v in ["radar", "models", "air"]:
                await pg.click(f'.tabs button[data-view="{v}"]')
                await pg.wait_for_timeout(1200)
                await pg.screenshot(path=f"{OUT}/{name}-{v}.png", full_page=True)
            await pg.click("#locBtn"); await pg.fill("#searchInput", "Petal"); await pg.wait_for_timeout(800)
            await pg.screenshot(path=f"{OUT}/{name}-search.png")
            print(name, "errors:", errs[:10])
            await ctx.close()
        await b.close()
asyncio.run(main())
