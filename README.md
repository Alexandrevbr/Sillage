# Sillage

Mes performances en course à pied depuis 2018 : volume, allures, cardio, dénivelé, compétitions (ce que dit ma
dernière course, mon niveau sur les 10 dernières) et gestion de course,
préparation de la prochaine course objectif, charge d’entraînement, séances clés, carte, boucles et
segments, et un récap à partager en story.
En ligne sur **https://sillage.alexandrebarreau.fr**.

## Comment ça marche

- `docs/` est le site, servi tel quel par GitHub Pages (branche `main`, dossier `/docs`). Il n’y a
  pas d’étape de build.
- `docs/data/` contient les données Strava : activités, compétitions, points cardio, zones, tracés
  GPS, tours de la montre, meilleurs efforts et passages sur les segments, plus le calendrier des
  courses à venir (`goal.json`).
- Chaque nuit vers 2 h, une tâche planifiée Claude suit [SYNC.md](SYNC.md) :
  1. elle récupère les nouvelles sorties via le connecteur Strava ;
  2. elle décide lesquelles sont des compétitions ;
  3. elle vérifie que tout le site se recalcule sans erreur ;
  4. elle pousse sur `main`.
- En journée, de 7 h à 23 h, une seconde tâche regarde toutes les heures s’il y a une nouvelle
  sortie et la publie aussitôt (« Vérification horaire » dans [SYNC.md](SYNC.md)). S’il n’y a rien
  de nouveau, elle ne pousse rien.
- Les tours, meilleurs efforts et segments de l’historique arrivent par lots : chaque nuit complète
  les nouvelles sorties plus 20 anciennes (les compétitions d’abord, puis des plus récentes aux plus
  anciennes).
- Chaque nuit laisse une ligne dans [sync/journal.md](sync/journal.md), même en cas d’échec. Une
  vérification horaire n’en laisse une que si elle publie une nouvelle sortie.
- Si une nuit échoue, aucune donnée n’est poussée, et la synchro suivante rattrape tout : elle
  relit toujours les 14 derniers jours.

## Changer d’objectif ou de calendrier

L’onglet Objectif lit `docs/data/goal.json` : une ligne par course à venir.

```json
{"event": "Semi de Boulogne", "date": "2026-11-15", "category": "Semi", "distance_km": 21.0975, "role": "objectif", "target_s": 4320}
```

- `role` : `objectif` pour la course visée (une seule à la fois), sinon un mot libre affiché tel
  quel (`préparation`, `récupération active`…).
- `target_s` : chrono visé en secondes (`4320` = 1h12′00″), ou `null`.
- Après la course, l’onglet affiche le résultat pendant 3 semaines, puis attend le prochain
  objectif.

## Voir le site en local

```sh
python3 -m http.server 8000 -d docs   # puis http://localhost:8000
```

## Vérifier les données

```sh
node scripts/check.cjs   # recalcule tous les calculs du site sur docs/data/
```

## Structure

| Chemin | Rôle |
| --- | --- |
| `docs/index.html` | la page |
| `docs/assets/dash.js` | mini-runtime : chargement des données et calculs à la demande |
| `docs/assets/calcs*.js` | les calculs (une fonction pure par indicateur) |
| `docs/assets/kit.js`, `app.js`, `cardio.js` | formats, graphiques (d3), onglets historiques |
| `docs/assets/train.js` | onglets Objectif, Entraînement et Séances |
| `docs/assets/map.js` | onglet Carte : tracés avec Leaflet, fond de carte OpenFreeMap avec MapLibre GL (chargés seulement à l’ouverture de l’onglet) |
| `docs/assets/more.js` | gestion de course, plan d’allure, charge et reprise, boucles et segments, récap partageable |
| `scripts/harvest.py` | lit les réponses du connecteur Strava et prépare la fiche d’analyse |
| `scripts/merge.py` | applique la synchro après vérification |
| `scripts/check.cjs` | vérification complète des données |
| `scripts/publish.py` | journal, commit et push de la synchro (ou du seul journal en cas d’échec) |
| `scripts/og.py` | image d’aperçu des liens partagés |
| `sync/journal.md` | une ligne par nuit : ce qui a changé, compétitions repérées, échecs |
| `sync/state.json` | mémoire de la synchro (sorties sans cardio, dernière synchro) |

Police : Manrope, comme ALLURE (SIL Open Font License). Graphiques : d3 (ISC). Carte : Leaflet (BSD 2-Clause),
MapLibre GL JS (BSD 3-Clause) et maplibre-gl-leaflet (ISC) ; fond de carte [OpenFreeMap](https://openfreemap.org)
(gratuit, sans clé), © OpenMapTiles, données © OpenStreetMap contributors.
