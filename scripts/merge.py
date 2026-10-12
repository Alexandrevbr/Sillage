"""Applique la synchro à docs/data/ : activités, flux cardio, zones et décisions sur les compétitions.

    python3 scripts/merge.py            → applique, vérifie avec node scripts/check.cjs, met à jour meta.json
    python3 scripts/merge.py --dry-run  → montre ce qui changerait, sans rien écrire

Rien n'est écrit si la vérification échoue. Le message de commit est écrit dans .sync/commit.txt.
"""
import argparse
import datetime as dt
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CATEGORIES, DATA, ROOT, RUN_TYPES, STAGE, STATE, hms, load, save  # noqa: E402

FIELDS = ('id', 'event', 'category', 'distance_km', 'official_s', 'place')


def fail(msg):
    print(f'✗ {msg}')
    sys.exit(1)


def check_decisions(dec, acts, race_by):
    if not isinstance(dec, dict) or not isinstance(dec.get('upsert', []), list) or not isinstance(dec.get('remove', []), list):
        fail('decisions.json doit être un objet {"upsert": [...], "remove": [...], "notes": "..."}')
    out, warnings = [], []
    for r in dec.get('upsert', []):
        rid = str(r.get('id', ''))
        a = acts.get(rid)
        if not a:
            fail(f'compétition {rid} : activité inconnue')
        if a['sport_type'] not in RUN_TYPES:
            fail(f'compétition {rid} : ce n’est pas une course à pied ({a["sport_type"]})')
        cat = r.get('category')
        if cat not in CATEGORIES:
            fail(f'compétition {rid} : catégorie « {cat} » inconnue (autorisées : {", ".join(CATEGORIES)})')
        event = str(r.get('event') or '').strip()
        if not event:
            fail(f'compétition {rid} : nom d’épreuve vide')
        fixed, given = CATEGORIES[cat], r.get('distance_km')
        if fixed is not None:
            if given not in (None, fixed):
                warnings.append(f'{rid} : distance_km {given} remplacée par {fixed} (catégorie {cat})')
            dist = fixed
        elif given is None:
            old = race_by.get(rid) or {}
            dist = old.get('distance_km') if old.get('category') == cat else None  # on ne perd pas une distance déjà notée
        else:
            gps = (a.get('distance') or 0) / 1000
            if not isinstance(given, (int, float)) or given <= 0:
                fail(f'compétition {rid} : distance_km doit être un nombre de km')
            if gps and not 0.8 <= given / gps <= 1.25:
                fail(f'compétition {rid} : distance officielle {given} km incohérente avec le GPS ({gps:.2f} km)')
            dist = round(float(given), 4)
        off = r.get('official_s')
        if off is not None:
            if not isinstance(off, int) or off <= 0:
                fail(f'compétition {rid} : official_s doit être un nombre entier de secondes')
            ratio = off / a['elapsed_time'] if a.get('elapsed_time') else 1
            if not 0.85 <= ratio <= 1.15:
                warnings.append(f'{rid} : chrono officiel {hms(off)} loin du temps Strava {hms(a.get("elapsed_time"))}, à vérifier')
        place = r.get('place')
        out.append({'id': rid, 'event': event, 'category': cat, 'distance_km': dist,
                    'official_s': off, 'place': str(place).strip() if place not in (None, '') else None})
    remove = [str(x) for x in dec.get('remove', [])]
    return out, remove, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    staged = load(STAGE / 'activities.json')
    if not staged:
        fail('rien dans .sync/activities.json : lancer list_activities puis scripts/harvest.py')
    decisions = load(STAGE / 'decisions.json')
    if decisions is None:
        fail('.sync/decisions.json manquant : analyser .sync/review.md et écrire les décisions (même vides)')

    acts = {a['id']: a for a in load(DATA / 'activities.json', [])}
    races = load(DATA / 'races.json', [])
    rows = load(DATA / 'hr_streams.json', [])
    zones = load(DATA / 'hr_zones.json', [])
    state = load(STATE, {})
    no_hr = set(state.get('no_hr', []))

    # ----- activités -----
    added, changed = [], []
    for a in staged['activities']:
        old = acts.get(a['id'])
        if old is None:
            added.append(a)
        elif any(old.get(k) != a.get(k) for k in a):
            changed.append(a)
        acts[a['id']] = a
    act_list = sorted(acts.values(), key=lambda a: (a['start_local'], a['id']))

    # ----- flux cardio -----
    by_id = {}
    for r in rows:
        by_id.setdefault(r['id'], []).append(r)
    new_streams = []
    for p in sorted((STAGE / 'streams').glob('*.json')) if (STAGE / 'streams').exists() else []:
        aid = p.stem
        a = acts.get(aid)
        if not a or a['sport_type'] not in RUN_TYPES:
            continue
        s = load(p, {})
        hr, v, g = s.get('heart_rate') or [], s.get('velocity_smooth') or [], s.get('grade_smooth') or []
        if not hr or not any(hr):
            no_hr.add(aid)
            by_id.pop(aid, None)
            continue
        no_hr.discard(aid)
        if aid not in by_id:
            new_streams.append(aid)
        by_id[aid] = [{'id': aid, 'point': i, 'hr': hr[i], 'speed': v[i] if i < len(v) else None,
                       'grade': g[i] if i < len(g) else None} for i in range(len(hr))]
    order = {a['id']: i for i, a in enumerate(act_list)}
    row_list = [r for aid in sorted(by_id, key=lambda x: order.get(x, -1)) for r in by_id[aid]]

    # ----- zones -----
    new_zones = load(STAGE / 'zones.json')
    zones_changed = bool(new_zones) and new_zones != zones
    if zones_changed:
        zones = new_zones

    # ----- compétitions -----
    race_by = {r['id']: r for r in races}
    upserts, remove, warnings = check_decisions(decisions, acts, race_by)
    race_added, race_updated, race_removed = [], [], []
    for r in upserts:
        old = race_by.get(r['id'])
        if old is None:
            race_added.append(r)
        elif any(old.get(k) != r.get(k) for k in FIELDS):
            race_updated.append(r)
        race_by[r['id']] = r
    for rid in remove:
        if race_by.pop(rid, None):
            race_removed.append(rid)
    race_list = sorted(race_by.values(), key=lambda r: acts[r['id']]['start_local'] if r['id'] in acts else '')
    orphans = [r['id'] for r in race_list if r['id'] not in acts]
    if orphans:
        fail(f'compétitions sans activité : {orphans}')

    runs = [a for a in act_list if a['sport_type'] in RUN_TYPES]
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    meta = [{'synced_at': now, 'activities': len(act_list), 'runs': len(runs), 'races': len(race_list),
             'hr_runs': len(by_id), 'last_activity': act_list[-1]['start_local'] if act_list else None}]

    # ----- résumé -----
    lines = []
    if added:
        lines.append(f'{len(added)} nouvelle(s) activité(s) : ' + ', '.join(f"{a['start_local'][:10]} {a['name']}" for a in added))
    if changed:
        lines.append(f'{len(changed)} activité(s) mise(s) à jour')
    if new_streams:
        lines.append(f'{len(new_streams)} sortie(s) avec cardio ajoutée(s)')
    if race_added:
        lines.append('compétition(s) ajoutée(s) : ' + ', '.join(f"{r['event']} ({r['category']})" for r in race_added))
    if race_updated:
        lines.append('compétition(s) corrigée(s) : ' + ', '.join(r['event'] for r in race_updated))
    if race_removed:
        lines.append(f'compétition(s) retirée(s) : {", ".join(race_removed)}')
    if zones_changed:
        lines.append('zones cardio mises à jour')
    title = f'Synchro Strava du {now[:10]}' + ('' if lines else ' (rien de neuf)')
    notes = str(decisions.get('notes') or '').strip()
    body = '\n'.join(f'- {x}' for x in lines) + (f'\n\nAnalyse : {notes}' if notes else '')
    print(title)
    print(body or '- aucun changement')
    for w in warnings:
        print(f'! {w}')

    if args.dry_run:
        print('(essai : rien n’a été écrit)')
        return

    # ----- écriture dans un dossier temporaire, vérification, puis remplacement -----
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        save(t / 'activities.json', act_list)
        save(t / 'races.json', race_list)
        save(t / 'hr_streams.json', row_list)
        save(t / 'hr_zones.json', zones)
        save(t / 'meta.json', meta)
        res = subprocess.run(['node', str(ROOT / 'scripts' / 'check.cjs'), str(t)], capture_output=True, text=True)
        print(res.stdout.strip())
        if res.returncode != 0:
            print(res.stderr.strip())
            fail('vérification en échec : docs/data/ n’a pas été modifié')
        for name in ('activities.json', 'races.json', 'hr_streams.json', 'hr_zones.json', 'meta.json'):
            shutil.copyfile(t / name, DATA / name)
    state.update({'last_sync': now, 'no_hr': sorted(no_hr)})
    save(STATE, state)
    (STAGE / 'commit.txt').write_text(title + '\n\n' + body + '\n', encoding='utf-8')
    print('✓ docs/data/ à jour · message de commit dans .sync/commit.txt')


if __name__ == '__main__':
    main()
