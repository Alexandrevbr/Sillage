"""Chemins et outils partagés par les scripts de synchro de Sillage."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'docs' / 'data'
STAGE = ROOT / '.sync'  # zone de travail de la synchro (jamais versionnée)
STATE = ROOT / 'sync' / 'state.json'  # mémoire de la synchro (versionnée)

RUN_TYPES = ('Run', 'TrailRun', 'VirtualRun')
CATEGORIES = {  # catégorie → distance officielle fixe en km (None : celle de l'épreuve, notée course par course)
    '10 km': 10,
    'Semi': 21.0975,
    '20 km': 20,
    'Marathon': 42.195,
    'Paris-Versailles': 16.2,
    'Trail': None,
    'Relais': None,
    'Autre': None,
}
STREAMS = ['heart_rate', 'velocity_smooth', 'grade_smooth']
RESOLUTION = 40


def load(path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save(path, data, compact=False):
    """Écriture atomique : un fichier à moitié écrit ne remplace jamais l'ancien.

    Une liste est écrite à raison d'un élément par ligne (diffs Git lisibles, fichier compact) ;
    compact=True écrit tout sur une ligne.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    one = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))  # noqa: E731
    with open(tmp, 'w', encoding='utf-8') as f:
        if compact:
            f.write(one(data))
        elif isinstance(data, list):
            f.write('[\n' + ',\n'.join(one(x) for x in data) + '\n]' if data else '[]')
        else:
            json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


def flat(a):
    """Activité du connecteur Strava (list_activities) → ligne de docs/data/activities.json."""
    s = a.get('summary') or {}
    cad = s.get('avg_cadence')
    return {
        'id': str(a['id']),
        'name': a.get('name'),
        'sport_type': a.get('sport_type'),
        'start_local': a.get('start_local'),
        'distance': s.get('distance'),
        'moving_time': s.get('moving_time'),
        'elapsed_time': s.get('elapsed_time'),
        'elevation_gain': s.get('elevation_gain'),
        'avg_cadence': round(cad, 2) if isinstance(cad, (int, float)) else None,
        'relative_effort': s.get('relative_effort'),
        'kudos_count': s.get('kudos_count'),
        'pr_count': s.get('pr_count'),
        'location_summary': a.get('location_summary'),
    }


def pace(sec_per_km):
    if not sec_per_km:
        return '—'
    t = round(sec_per_km)
    return f"{t // 60}'{t % 60:02d}\"/km"


def hms(sec):
    if sec is None:
        return '—'
    t = round(sec)
    h, m, s = t // 3600, t % 3600 // 60, t % 60
    return f'{h}h{m:02d}\'{s:02d}"' if h else f'{m}\'{s:02d}"'


EFFORT_NAMES = {  # meilleurs efforts Strava → libellés du site
    'Fastest400': '400 m', 'FastestHalfMile': '800 m', 'Fastest1k': '1 km', 'FastestMile': '1 mile',
    'Fastest2Mile': '2 miles', 'Fastest5k': '5 km', 'Fastest10k': '10 km', 'Fastest15k': '15 km',
    'Fastest10Mile': '10 miles', 'Fastest20k': '20 km', 'FastestHalfMarathon': 'Semi', 'Fastest30k': '30 km',
    'FastestMarathon': 'Marathon',
}


def perf_of(out):
    """Réponse de get_activity_performance → tours et meilleurs efforts (les segments sont ignorés)."""
    def r(v, n=1):
        return round(v, n) if isinstance(v, (int, float)) else None

    efforts = {}
    for e in out.get('best_efforts') or []:
        name = EFFORT_NAMES.get(e.get('type_value') or e.get('name'), e.get('display_text'))
        if name and isinstance(e.get('value'), (int, float)):
            efforts[name] = int(e['value'])
    laps = [{
        'd': r(l.get('distance')), 'mt': l.get('moving_time'), 'et': l.get('elapsed_time'),
        'hr': r(l.get('avg_hr')), 'hrmax': l.get('max_hr'), 'cad': r(l.get('avg_cadence')),
        'el': r(l.get('elevation_gain')), 'g': r(l.get('avg_grade'), 2),
    } for l in out.get('laps') or []]
    return {'efforts': efforts, 'laps': laps}
