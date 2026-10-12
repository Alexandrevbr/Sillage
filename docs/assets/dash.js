/* Sillage — mini-runtime autonome.
 *
 * Remplace le runtime du tableau de bord Claude : charge les fichiers de data/,
 * exécute les calculs déclarés avec dash.calc (à la demande, une seule fois chacun)
 * et prévient la page quand de nouvelles données sont prêtes.
 * API utilisée par la page : dash.calc, dash.data, dash.colors, dash.onData, dash.setLink.
 */
(() => {
  // Les sources « lazy » ne sont chargées que lorsqu’un graphique les demande (onglets Entraînement et Carte).
  const DATASETS = {
    activities: { url: 'data/activities.json' },
    races: { url: 'data/races.json' },
    hr_streams: { url: 'data/hr_streams.json' },
    hr_zones: { url: 'data/hr_zones.json' },
    meta: { url: 'data/meta.json' },
    goal: { url: 'data/goal.json' },
    laps: { url: 'data/laps.json', lazy: true },
    efforts: { url: 'data/efforts.json', lazy: true },
    routes: { url: 'data/routes.json', lazy: true },
  };
  const LOADING = Object.freeze({ status: 'loading', data: null });
  const ERROR = Object.freeze({ status: 'error', data: null });

  const raw = new Map(); // source → { status, data }
  const defs = new Map(); // calcul → { inputs, fn }
  const memo = new Map(); // calcul → résultat figé
  const listeners = [];
  const clone = typeof structuredClone === 'function' ? structuredClone : (v) => JSON.parse(JSON.stringify(v));

  const get = (id, path = []) => {
    if (Object.prototype.hasOwnProperty.call(DATASETS, id)) {
      if (!raw.has(id) && !started.has(id)) load(id);
      return raw.get(id) || LOADING;
    }
    const def = defs.get(id);
    if (!def) {
      console.error(`[sillage] source inconnue : ${id}`);
      return ERROR;
    }
    if (memo.has(id)) return memo.get(id);
    if (path.includes(id)) {
      console.error(`[sillage] boucle de calcul : ${[...path, id].join(' → ')}`);
      return ERROR;
    }
    const ins = def.inputs.map((i) => get(i, [...path, id]));
    if (ins.some((r) => r.status === 'error')) {
      memo.set(id, ERROR);
      return ERROR;
    }
    if (ins.some((r) => r.status !== 'ok')) return LOADING;
    try {
      // Chaque calcul reçoit sa propre copie : il ne peut pas abîmer les données des autres.
      const out = def.fn(...ins.map((r) => clone(r.data)));
      const res = Object.freeze({ status: 'ok', data: out });
      memo.set(id, res);
      return res;
    } catch (err) {
      console.error(`[sillage] le calcul « ${id} » a échoué`, err);
      memo.set(id, ERROR);
      return ERROR;
    }
  };

  let queued = false;
  const notify = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      listeners.forEach((cb) => {
        try {
          cb();
        } catch (err) {
          console.error('[sillage] dessin en échec', err);
        }
      });
    });
  };

  window.dash = {
    colors: Object.freeze(Array.from({ length: 8 }, (_, i) => `var(--cds-chart-categorical-${i + 1})`)),
    calc(id, def) {
      if (defs.has(id)) console.warn(`[sillage] calcul déclaré deux fois : ${id}`);
      defs.set(id, { inputs: [], ...def });
    },
    data: (id) => get(id),
    onData(cb) {
      listeners.push(cb);
      if (raw.size) notify();
    },
    setLink(id) {
      try {
        history.replaceState(history.state, '', id ? `#${encodeURIComponent(id)}` : `${location.pathname}${location.search}`);
      } catch (err) {
        /* adresse non modifiable (aperçu local) */
      }
    },
  };

  const started = new Set();
  function load(id) {
    started.add(id);
    const { url } = DATASETS[id];
    fetch(url, { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => raw.set(id, Object.freeze({ status: 'ok', data })))
      .catch((err) => {
        console.error(`[sillage] impossible de charger ${url}`, err);
        raw.set(id, ERROR);
      })
      .finally(notify);
  }
  Object.entries(DATASETS).forEach(([id, d]) => {
    if (!d.lazy) load(id);
  });

  // Les largeurs de texte des graphiques dépendent de la police : on redessine une fois chargée.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(notify);
})();
