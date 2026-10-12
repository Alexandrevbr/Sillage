"""Publie la synchro : une ligne dans sync/journal.md, commit, push sur main.

    python3 scripts/publish.py                      → après un scripts/merge.py réussi
    python3 scripts/publish.py --failed "raison"    → en cas d'échec : seul le journal est poussé

Le journal garde une trace de chaque nuit (réussie ou non), lisible directement sur GitHub.
"""
import argparse
import datetime as dt
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, STAGE  # noqa: E402

JOURNAL = ROOT / 'sync' / 'journal.md'
HEADER = '# Journal de synchro\n\nUne ligne par synchro, la plus récente en haut.\n\n'
KEEP = 400  # lignes conservées


def git(*args):
    res = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f'git {" ".join(args)} : {(res.stderr or res.stdout).strip()}')
    return res.stdout.strip()


def log(line):
    old = JOURNAL.read_text(encoding='utf-8') if JOURNAL.exists() else HEADER
    head, _, rest = old.partition('\n\n- ')
    entries = ('- ' + rest).splitlines() if rest else []
    entries = [line] + [e for e in entries if e.strip()]
    JOURNAL.parent.mkdir(parents=True, exist_ok=True)
    JOURNAL.write_text(HEADER + '\n'.join(entries[:KEEP]) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--failed', help='raison de l’échec, en une phrase')
    args = ap.parse_args()
    now = dt.datetime.now(ZoneInfo('Europe/Paris')).strftime('%Y-%m-%d %H:%M')

    if args.failed:
        title = f'Synchro en échec du {now[:10]}'
        body = ' '.join(args.failed.split())
        log(f'- {now} · ÉCHEC · {body}')
        paths = ['sync/journal.md']
    else:
        msg = STAGE / 'commit.txt'
        if not msg.exists():
            sys.exit('✗ .sync/commit.txt manquant : lancer d’abord scripts/merge.py (ou --failed "raison")')
        title, _, body = msg.read_text(encoding='utf-8').partition('\n')
        body = body.strip()
        summary = ' ; '.join(x[2:] for x in body.splitlines() if x.startswith('- ')) or 'rien de neuf'
        notes = next((x[len('Analyse : '):] for x in body.splitlines() if x.startswith('Analyse : ')), '')
        log(f'- {now} · {summary}' + (f' · {notes}' if notes else ''))
        try:
            subprocess.run([sys.executable, str(ROOT / 'scripts' / 'og.py')], cwd=ROOT, timeout=180)
        except Exception as err:  # l'aperçu est un bonus
            print(f'Aperçu non régénéré : {err}')
        paths = ['docs', 'sync']

    git('add', *paths)
    if not git('status', '--porcelain', '--', *paths):
        print('Rien à publier.')
        return
    git('commit', '-m', title, '-m', body or '—')
    try:
        git('push', 'origin', 'HEAD:main')
    except RuntimeError:
        git('pull', '--rebase', 'origin', 'main')  # quelqu'un a poussé entre-temps
        git('push', 'origin', 'HEAD:main')
    print(f'✓ publié sur main : {title}')


if __name__ == '__main__':
    main()
