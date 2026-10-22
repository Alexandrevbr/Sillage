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
        ctx = await b.new_context(viewport={'width': 1200, 'height': 630}, device_scale_factor=1, color_scheme='light', reduced_motion='reduce')
        pg = await ctx.new_page()
        await pg.goto(url, wait_until='networkidle')
        await pg.wait_for_timeout(1500)
        # L’en-tête de l’accueil seul, plein cadre : le sillage de mes sorties, le logo, le titre, les chiffres clés et les records.
        await pg.add_style_tag(content=(
            '.page{padding:0!important} .sr{gap:0!important;max-width:none!important} '
            '.sr > :not(#apercu):not(.sr-top){display:none!important} #apercu > :not(.sr-cover){display:none!important} '
            '.sr-top{position:absolute;top:34px;left:48px;z-index:5} .sr-sync{display:none!important} '
            '.sr-brand__word b{color:#fff!important} .sr-brand__word small{color:#a9bbff!important} '
            '.sr-cover{border-radius:0!important;min-height:630px!important;height:630px;padding:120px 48px 40px!important;box-shadow:none!important} '
            '.sr-cover__credit,.sr-lede,.sr-kpi__sub{display:none!important} .sr-cover .sr-title{font-size:76px!important}'
        ))
        await pg.evaluate('window.dispatchEvent(new Event("resize"))')
        await pg.wait_for_timeout(900)
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
