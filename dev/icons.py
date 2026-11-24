import asyncio, sys
from playwright.async_api import async_playwright
svg = open(sys.argv[1]).read()
mask = svg.replace('rx="112"', 'rx="0"').replace('<path', '<g transform="translate(51 51) scale(.8)"><path',1).replace('</svg>','</g></svg>') if False else svg.replace('rx="112"','rx="0"')
async def main():
    async with async_playwright() as p:
        import os
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None)
        for size, name, s in [(180,"icon-180.png",svg),(192,"icon-192.png",svg),(512,"icon-512.png",svg),(512,"icon-maskable-512.png",mask)]:
            pg = await b.new_page(viewport={"width":size,"height":size})
            html = f'<html><body style="margin:0;background:transparent">{s.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ",1)}</body></html>'
            await pg.set_content(html)
            await pg.screenshot(path=os.path.join(os.path.dirname(sys.argv[1]), name), omit_background=True)
        await b.close()
asyncio.run(main())
