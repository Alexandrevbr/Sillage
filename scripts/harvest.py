"""Rassemble ce que le connecteur Strava a renvoyé pendant la synchro et prépare l'analyse.

    python3 scripts/harvest.py --plan          → fenêtre à relire (à passer à list_activities)
    python3 scripts/harvest.py                 → lit les réponses du connecteur, prépare .sync/
    python3 scripts/harvest.py --backlog 40    → idem, avec 40 anciennes sorties à compléter (tours, records, segments)
    python3 scripts/harvest.py --quick [--plan] → vérification horaire : fenêtre courte, nouvelles sorties seulement

Les réponses sont lues à deux endroits, fusionnés :
  1. le journal de la session Claude en cours (~/.claude/projects/**/*.jsonl récents) ;
  2. en secours, les réponses copiées telles quelles dans .sync/raw/*.json
     (list_*.json, streams_<id>.json, zones.json).
Produit dans .sync/ : activities.json, routes.json, streams/<id>.json, perf/<id>.json, zones.json
et review.md (la fiche à lire pour décider quelles sorties sont des compétitions).
"""
import argparse
import datetime as dt
import json
import re
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATA, RESOLUTION, RUN_TYPES, STAGE, STATE, STREAMS, flat, hms, load, pace, perf_of, save  # noqa: E402

WINDOW_DAYS = 14  # on relit les 14 derniers jours : titres, descriptions et kudos changent après coup
QUICK_DAYS = 1  # vérification horaire : la veille de la dernière sortie connue suffit à voir les nouvelles
BACKLOG = 20  # anciennes sorties complétées chaque nuit (tours, meilleurs efforts et segments ; réponses longues)


def window_start(quick=False):
    acts = load(DATA / 'activities.json', [])
    last = max((a['start_local'] for a in acts), default='2018-01-01T00:00:00')
    d = dt.date.fromisoformat(last[:10]) - dt.timedelta(days=QUICK_DAYS if quick else WINDOW_DAYS)
    return f'{d.isoformat()}T00:00:00'


def transcripts(max_age_h):
    seen, out = set(), []
    for home in {Path.home(), Path('/root')}:
        base = home / '.claude' / 'projects'
        try:
            files = list(base.glob('**/*.jsonl'))
        except OSError:
            continue
        for p in files:
            try:
                if p.resolve() in seen or time.time() - p.stat().st_mtime > max_age_h * 3600:
                    continue
            except OSError:
                continue
            seen.add(p.resolve())
            out.append(p)
    return out


def text_of(content):
    if isinstance(content, list):
        return ''.join(x.get('text', '') for x in content if isinstance(x, dict))
    return content or ''


def from_transcripts(max_age_h):
    """Renvoie [(outil, entrée, sortie_json)] pour les appels Strava réussis des journaux récents."""
    calls = []
    for path in transcripts(max_age_h):
        uses = {}
        try:
            lines = open(path, encoding='utf-8', errors='replace')
        except OSError:
            continue
        with lines:
            for line in lines:
                if 'Strava' not in line and 'strava' not in line and 'tool_result' not in line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                c = (o.get('message') or {}).get('content')
                if not isinstance(c, list):
                    continue
                for b in c:
                    if not isinstance(b, dict):
                        continue
                    if b.get('type') == 'tool_use':
                        name = b.get('name', '')
                        for tool in ('list_activities', 'get_activity_streams', 'get_athlete_zones', 'get_activity_performance'):
                            if name.endswith(tool) and 'strava' in name.lower():
                                uses[b.get('id')] = (tool, b.get('input') or {})
                    elif b.get('type') == 'tool_result' and b.get('tool_use_id') in uses:
                        txt = text_of(b.get('content')).strip()
                        if b.get('is_error') and 'saved to' not in txt:  # une réponse trop longue est « en erreur » mais enregistrée
                            continue
                        out = parse_result(txt)
                        if out is None:
                            continue
                        tool, inp = uses[b['tool_use_id']]
                        calls.append((tool, inp, out))
    return calls


def parse_result(txt):
    """Réponse JSON en ligne, ou réponse trop longue que la session a enregistrée dans un fichier."""
    if txt.startswith('{'):
        try:
            return json.loads(txt)
        except ValueError:
            return None
    for p in re.findall(r'(/[^\s"\'<>()]+?\.(?:json|txt))', txt):
        try:
            raw = Path(p).read_text(encoding='utf-8', errors='replace').strip()
            data = json.loads(raw)
        except (OSError, ValueError):
            continue
        if isinstance(data, list):  # blocs de contenu [{type: text, text: …}]
            try:
                data = json.loads(text_of(data).strip())
            except ValueError:
                continue
        if isinstance(data, dict):
            return data
    return None


def from_raw():
    calls = []
    raw = STAGE / 'raw'
    if not raw.exists():
        return calls
    for p in sorted(raw.glob('*.json')):
        try:
            out = json.load(open(p, encoding='utf-8'))
        except ValueError as err:
            print(f'! {p.name} illisible : {err}')
            continue
        if p.name.startswith('list'):
            calls.append(('list_activities', {}, out))
        elif p.name.startswith('streams_'):
            calls.append(('get_activity_streams', {'activity_id': p.stem.split('_', 1)[1], 'resolution': RESOLUTION}, out))
        elif p.name.startswith('zones'):
            calls.append(('get_athlete_zones', {}, out))
        elif p.name.startswith('perf_'):
            calls.append(('get_activity_performance', {'activity_id': p.stem.split('_', 1)[1]}, out))
    return calls


def thin(values, n=RESOLUTION):
    """Secours : ramène un flux trop fin à n points répartis (premier et dernier gardés)."""
    if not values or len(values) <= n:
        return values
    step = (len(values) - 1) / (n - 1)
    return [values[round(i * step)] for i in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', action='store_true', help='affiche la fenêtre à relire et s’arrête')
    ap.add_argument('--hours', type=float, default=12, help='âge maximal des journaux de session lus')
    ap.add_argument('--backlog', type=int, default=BACKLOG, help='anciennes sorties à compléter (tours, records, segments)')
    ap.add_argument('--quick', action='store_true', help='vérification horaire : fenêtre courte, sans arriéré')
    args = ap.parse_args()
    if args.quick:
        args.backlog = 0

    start = window_start(args.quick)
    if args.plan:
        print(f'{"Vérification horaire" if args.quick else "Fenêtre à relire"} : depuis {start}')
        print(f'→ list_activities(range_start="{start}", ordering="StartDateLocalAsc", first=100, include_polyline=true) ; '
              'paginer avec after=end_cursor tant que has_next_page')
        return

    calls = from_transcripts(args.hours) + from_raw()
    acts, streams, zones, desc, trainer, routes, perf = {}, {}, None, {}, {}, {}, {}
    for tool, inp, out in calls:
        if tool == 'list_activities':
            for a in out.get('activities') or []:
                if not a.get('id'):
                    continue
                f = flat(a)
                acts[f['id']] = f
                desc[f['id']] = (a.get('description') or '').strip()
                trainer[f['id']] = bool(a.get('is_trainer'))
                if a.get('reduced_polyline') and f['sport_type'] in RUN_TYPES:
                    routes[f['id']] = a['reduced_polyline']
        elif tool == 'get_activity_performance':
            aid = str(inp.get('activity_id') or '')
            if aid:
                perf[aid] = perf_of(out)
        elif tool == 'get_activity_streams':
            aid = str(inp.get('activity_id') or '')
            if not aid:
                continue
            res = inp.get('resolution')
            s = {k: out.get(k) for k in STREAMS if isinstance(out.get(k), list)}
            if res != RESOLUTION:
                s = {k: thin(v) for k, v in s.items()}
            prev = streams.get(aid)
            if prev is None or (res == RESOLUTION and prev.get('_res') != RESOLUTION):
                streams[aid] = {**s, '_res': res}
        elif tool == 'get_athlete_zones' and out.get('heart_rate_zones'):
            zones = [{'zone': i + 1, 'min_bpm': z.get('min'), 'max_bpm': z.get('max')} for i, z in enumerate(out['heart_rate_zones'])]

    STAGE.mkdir(exist_ok=True)
    (STAGE / 'streams').mkdir(exist_ok=True)
    (STAGE / 'perf').mkdir(exist_ok=True)
    for aid, pf in perf.items():
        save(STAGE / 'perf' / f'{aid}.json', pf, compact=True)
    staged_routes = load(STAGE / 'routes.json', {})
    staged_routes.update(routes)
    if staged_routes:
        save(STAGE / 'routes.json', staged_routes, compact=True)
    in_window = {k: v for k, v in acts.items() if v['start_local'] >= start}
    save(STAGE / 'activities.json', {'window_start': start, 'activities': list(acts.values()),
                                     'descriptions': desc, 'is_trainer': trainer})
    for aid, s in streams.items():
        save(STAGE / 'streams' / f'{aid}.json', {k: v for k, v in s.items() if k != '_res'}, compact=True)
    if zones:
        save(STAGE / 'zones.json', zones)

    # ----- ce qui manque encore -----
    known = {a['id']: a for a in load(DATA / 'activities.json', [])}
    rows = load(DATA / 'hr_streams.json', [])
    with_hr = {r['id'] for r in rows}
    state = load(STATE, {})
    no_hr = set(state.get('no_hr', []))
    staged = {p.stem for p in (STAGE / 'streams').glob('*.json')}
    runs = [a for a in acts.values() if a['sport_type'] in RUN_TYPES]
    todo = [a['id'] for a in runs if a['id'] not in with_hr and a['id'] not in no_hr and a['id'] not in staged]
    new = [a for a in acts.values() if a['id'] not in known]

    print(f'Journaux lus : {len(transcripts(args.hours))} · appels Strava trouvés : {len(calls)}')
    if not calls and not args.quick:
        print('! Aucune réponse Strava trouvée dans le journal de la session : copier chaque réponse du connecteur '
              'telle quelle dans .sync/raw/ (list_1.json, streams_<id>.json, zones.json), puis relancer ce script. Voir SYNC.md.')
    print(f'Activités vues : {len(acts)} (dont {len(in_window)} dans la fenêtre depuis {start[:10]}) · nouvelles : {len(new)}')
    for a in sorted(new, key=lambda x: x['start_local']):
        print(f"  + {a['start_local'][:16]} {a['sport_type']:<10} {(a['distance'] or 0) / 1000:5.1f} km  {a['name']}")
    if args.quick and not new:
        why = 'aucune nouvelle activité' if calls else 'aucune réponse Strava trouvée dans le journal de la session'
        print(f'Vérification horaire : {why}. Rien à publier : s’arrêter ici, sans merge ni publish '
              '(la synchro de la nuit relit les 14 derniers jours).')
        return
    print(f'Flux cardio en attente : {len(staged)} · zones : {"oui" if zones else "non"}')
    if todo:
        print(f'À récupérer ({len(todo)}) : get_activity_streams(activity_id=…, streams={STREAMS}, resolution={RESOLUTION}) pour :')
        print('  ' + ' '.join(todo))
    else:
        print('Aucun flux cardio à récupérer.')

    # ----- tours, meilleurs efforts et segments : les nouvelles sorties, puis l'arriéré -----
    # Une sortie est complète quand ses segments sont connus (même zéro) ; l'arriéré passe les compétitions en premier,
    # puis les sorties les plus récentes.
    done = {r['id'] for r in load(DATA / 'seg_efforts.json', [])} | set(state.get('perf_empty', []))
    staged_perf = {p.stem for p in (STAGE / 'perf').glob('*.json')}
    race_ids = {r['id'] for r in load(DATA / 'races.json', [])}
    allruns = sorted([a for a in {**known, **acts}.values() if a['sport_type'] in RUN_TYPES],
                     key=lambda a: a['start_local'], reverse=True)
    missing = [a['id'] for a in allruns if a['id'] not in done and a['id'] not in staged_perf]
    fresh = [i for i in missing if i in acts and i not in known]
    rest = [i for i in missing if i not in fresh]
    rest = [i for i in rest if i in race_ids] + [i for i in rest if i not in race_ids]
    quota = max(0, args.backlog - len([i for i in staged_perf if i in known]))  # l'arriéré déjà traité cette session compte
    perf_todo = fresh + rest[:quota]
    print(f'Tours, records et segments : {len(done)} sorties complètes, {len(staged_perf)} en attente, {len(missing)} restantes.')
    if perf_todo:
        print(f'À récupérer ({len(perf_todo)}) : get_activity_performance(activity_id=…), une à la fois, '
              'et relancer ce script toutes les 10 sorties, pour :')
        print('  ' + ' '.join(perf_todo))
    else:
        print('Aucun tour, record ni segment à récupérer cette fois.')
    have_routes = {r['id'] for r in load(DATA / 'routes.json', [])} | set(staged_routes)
    no_route = [a['id'] for a in allruns if a['id'] not in have_routes]
    print(f'Tracés GPS : {len(have_routes)} connus · {len(no_route)} sorties sans tracé'
          + (' : rattrapage à faire avec list_activities(first=100, include_polyline=true, ordering="StartDateLocalAsc") '
             'sur tout l’historique, en paginant' if len(no_route) > 50 else ' (tapis ou GPS coupé)' if no_route else ''))

    write_review(start, acts, desc, trainer, streams, known, rows)
    print(f'Fiche d’analyse : {STAGE / "review.md"}')


def avg_hr(aid, streams, rows):
    if aid in streams and streams[aid].get('heart_rate'):
        hr = [h for h in streams[aid]['heart_rate'][1:] if h]
    else:
        hr = [r['hr'] for r in rows if r['id'] == aid and r['point'] > 0 and r['hr']]
    return round(statistics.mean(hr)) if hr else None


def write_review(start, acts, desc, trainer, streams, known, rows):
    races = load(DATA / 'races.json', [])
    by_race = {r['id']: r for r in races}
    plan = {g['date']: g for g in load(DATA / 'goal.json', [])}
    allacts = {**known, **acts}
    runs_window = sorted((a for a in acts.values() if a['sport_type'] in RUN_TYPES and a['start_local'] >= start),
                         key=lambda a: a['start_local'])

    # Repères : allure habituelle des 90 derniers jours (hors compétitions) et records par catégorie.
    last = max((a['start_local'] for a in allacts.values()), default=start)
    since = (dt.date.fromisoformat(last[:10]) - dt.timedelta(days=90)).isoformat()
    easy = [a['moving_time'] / (a['distance'] / 1000) for a in allacts.values()
            if a['sport_type'] in RUN_TYPES and a['start_local'] >= since and a['id'] not in by_race
            and a.get('distance') and a['distance'] > 3000 and a.get('moving_time')]
    best = {}
    for r in races:
        a = allacts.get(r['id'])
        if not a or r['category'] in ('Relais', 'Autre'):
            continue
        t = r['official_s'] if r.get('official_s') is not None else a['elapsed_time']
        if r['category'] not in best or t < best[r['category']][0]:
            best[r['category']] = (t, r['event'], a['start_local'][:10])

    L = []
    L.append('# Fiche d’analyse — compétitions\n')
    L.append(f'Fenêtre relue : depuis le {start[:10]}. Pour CHAQUE course à pied ci-dessous, décider si c’est une compétition '
             '(voir les règles de SYNC.md), puis écrire .sync/decisions.json.\n')
    if easy:
        q = statistics.quantiles(easy, n=10)
        L.append(f'Repère d’allure (sorties > 3 km des 90 derniers jours, hors compétitions) : médiane {pace(statistics.median(easy))}, '
                 f'10 % les plus rapides sous {pace(q[0])}.\n')
    if best:
        L.append('Records en compétition : ' + ' · '.join(f'{c} {hms(t)} ({e}, {d})' for c, (t, e, d) in best.items()) + '\n')
    L.append('\n## Courses à pied de la fenêtre\n')
    if not runs_window:
        L.append('_Aucune course à pied dans la fenêtre._\n')
    for a in runs_window:
        km = (a['distance'] or 0) / 1000
        p = a['moving_time'] / km if km else None
        status = by_race.get(a['id'])
        L.append(f"### {a['id']} · {a['start_local'][:10]} {a['start_local'][11:16]} · {a['name']}")
        L.append(f"- {a['sport_type']}{' (tapis / home trainer)' if trainer.get(a['id']) else ''} · {km:.2f} km · "
                 f"mouvement {hms(a['moving_time'])} · écoulé {hms(a['elapsed_time'])} · {pace(p)} · D+ {a['elevation_gain'] or 0} m")
        L.append(f"- FC moyenne : {avg_hr(a['id'], streams, rows) or '—'} bpm · effort relatif : {a.get('relative_effort') or '—'} · "
                 f"lieu : {a.get('location_summary') or '—'} · nouvelle : {'oui' if a['id'] not in known else 'non'}")
        d = desc.get(a['id'])
        L.append(f'- Description : {d}' if d else '- Description : (aucune)')
        g = plan.get(a['start_local'][:10])
        if g:
            L.append(f"- Course prévue ce jour-là au calendrier (goal.json) : {g['event']} · {g['category']} · {g['distance_km']} km")
        if status:
            L.append(f"- Déjà enregistrée comme compétition : {json.dumps(status, ensure_ascii=False)}")
        L.append('')

    L.append('## Exemples : compétitions déjà reconnues (titre Strava → fiche)\n')
    for r in sorted(races, key=lambda r: allacts.get(r['id'], {}).get('start_local', '')):
        a = allacts.get(r['id'], {})
        L.append(f"- {a.get('start_local', '?')[:10]} · « {a.get('name', '?')} » · {(a.get('distance') or 0) / 1000:.2f} km → "
                 f"{r['event']} / {r['category']} / distance_km {r['distance_km']} / official_s {r['official_s']} / place {r['place']}")
    (STAGE / 'review.md').write_text('\n'.join(L) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
