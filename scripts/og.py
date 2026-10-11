"""Régénère l'image d'aperçu des liens partagés (docs/assets/og.png, 1200 × 630) à partir du site.

    python3 scripts/og.py

Facultatif : sans Playwright (Chromium), le script ne fait rien et le dit.
"""
import asyncio
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'


async def shoot(url, out):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1200, 'height': 630}, device_scale_factor=1, color_scheme='light')
        pg = await ctx.new_page()
        await pg.goto(url, wait_until='networkidle')
        await pg.wait_for_timeout(1500)
        await pg.add_style_tag(content='.page{padding:22px 24px!important} .sr > :not(.sr-hero){display:none!important} '
                                       '.sr-hero{min-height:586px;display:flex;flex-direction:column;justify-content:center}')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=str(out))
        await b.close()


def main():
    try:
        import playwright  # noqa: F401
    except ImportError:
        print('Playwright absent : aperçu non régénéré (sans conséquence).')
        return
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(DOCS))
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as srv:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            asyncio.run(shoot(f'http://127.0.0.1:{srv.server_address[1]}/', DOCS / 'assets' / 'og.png'))
            print('✓ docs/assets/og.png régénérée')
        except Exception as err:  # l'aperçu est un bonus : ne jamais bloquer la synchro
            print(f'Aperçu non régénéré : {err}')
        finally:
            srv.shutdown()


if __name__ == '__main__':
    sys.exit(main())
