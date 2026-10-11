# Sillage

Mes courses Strava depuis 2018 : volume, allures, cardio, dénivelé et compétitions.
En ligne sur **https://sillage.alexandrebarreau.fr**.

## Comment ça marche

- `docs/` est le site, servi tel quel par GitHub Pages (branche `main`, dossier `/docs`). Il n’y a
  pas d’étape de build.
- `docs/data/` contient les données Strava : activités, compétitions, points cardio et zones.
- Chaque nuit vers 2 h, une tâche planifiée Claude suit [SYNC.md](SYNC.md) :
  1. elle récupère les nouvelles sorties via le connecteur Strava ;
  2. elle décide lesquelles sont des compétitions ;
  3. elle vérifie que tout le site se recalcule sans erreur ;
  4. elle pousse sur `main`.
- Si une nuit échoue, rien n’est poussé, et la synchro suivante rattrape tout : elle relit
  toujours les 14 derniers jours.

## Voir le site en local

```sh
python3 -m http.server 8000 -d docs   # puis http://localhost:8000
```

## Vérifier les données

```sh
node scripts/check.cjs   # recalcule les 49 calculs du site sur docs/data/
```

## Structure

| Chemin | Rôle |
| --- | --- |
| `docs/index.html` | la page |
| `docs/assets/dash.js` | mini-runtime : chargement des données et calculs à la demande |
| `docs/assets/calcs*.js` | les calculs (une fonction pure par indicateur) |
| `docs/assets/kit.js`, `app.js`, `cardio.js` | formats, graphiques (d3), onglets |
| `scripts/harvest.py` | lit les réponses du connecteur Strava et prépare la fiche d’analyse |
| `scripts/merge.py` | applique la synchro après vérification |
| `scripts/check.cjs` | vérification complète des données |
| `scripts/og.py` | image d’aperçu des liens partagés |
| `sync/state.json` | mémoire de la synchro (sorties sans cardio, dernière synchro) |

Police : Newsreader (SIL Open Font License). Graphiques : d3 (ISC).
