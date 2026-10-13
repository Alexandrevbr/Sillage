/* Onglet Carte : toutes les sorties en carte de chaleur, et le tracé de chaque compétition.
 * Leaflet (assets/leaflet) dessine les tracés ; le fond de carte vectoriel OpenFreeMap (gratuit, sans clé) est dessiné
 * par MapLibre GL via le pont maplibre-gl-leaflet (assets/maplibre). Bibliothèques et tracés (data/routes.json) ne sont
 * chargés qu’à l’ouverture de l’onglet. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const ui = { range: 'all', kind: 'all', sel: null, group: null };
  let pendingFocus = null;
  const page = () => document.getElementById('carte');
  const visible = () => page() && !page().hidden;
  const run = (fn) => {
    try {
      fn();
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }
  };

  /* ---------- Leaflet et le fond de carte à la demande ---------- */
  // La carte et les tracés s’affichent dès que Leaflet est là ; le fond de carte (MapLibre, plus lourd) arrive ensuite.
  let leaflet = 'idle';
  let gl = 'idle';
  const script = (src) => new Promise((resolve, reject) => {
    const js = document.createElement('script');
    js.src = src;
    js.onload = resolve;
    js.onerror = reject;
    document.head.append(js);
  });
  const loadLibs = () => {
    if (leaflet !== 'idle') return;
    leaflet = 'loading';
    gl = 'loading';
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'assets/leaflet/leaflet.css';
    // Avant les styles de la page, pour que nos réglages l’emportent.
    document.head.insertBefore(css, document.head.querySelector('style'));
    const lf = script('assets/leaflet/leaflet.js');
    lf.then(() => {
      leaflet = 'ready';
    }, () => {
      leaflet = 'error';
    }).then(() => {
      if (visible()) run(drawMap);
    });
    // Le pont a besoin de Leaflet et de MapLibre.
    Promise.all([lf, script('assets/maplibre/maplibre-gl.js')])
      .then(() => script('assets/maplibre/leaflet-maplibre-gl.js'))
      .then(() => {
        gl = 'ready';
        run(setBase);
      }, () => {
        gl = 'error';
      });
  };

  /* ---------- Tracés : polylignes encodées de Strava (précision 1e-5) ---------- */
  const decode = (str) => {
    const pts = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let b;
      let shift = 0;
      let res = 0;
      do {
        b = str.charCodeAt(i++) - 63;
        res |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      return res & 1 ? ~(res >> 1) : res >> 1;
    };
    while (i < str.length) {
      lat += next();
      if (i >= str.length) break;
      lng += next();
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  };

  let runs = null; // sorties avec tracé, décodées une fois
  let byId = new Map();
  let lastDay = 0;
  let years = [];
  const prepare = (rows) => {
    runs = rows.map((r) => {
      const pts = decode(r.p);
      let s = 90;
      let w = 180;
      let n = -90;
      let e = -180;
      pts.forEach(([a, b]) => {
        if (a < s) s = a;
        if (a > n) n = a;
        if (b < w) w = b;
        if (b > e) e = b;
      });
      return { ...r, p: null, pts, box: [[s, w], [n, e]] };
    }).filter((r) => r.pts.length > 1);
    byId = new Map(runs.map((r) => [r.id, r]));
    lastDay = runs.reduce((m, r) => Math.max(m, r.day), 0);
    const count = new Map();
    runs.forEach((r) => count.set(r.year, (count.get(r.year) || 0) + 1));
    years = [...count.entries()].filter(([, n]) => n >= 20).map(([y]) => y).sort((a, b) => b - a).slice(0, 3);
  };

  // Zone habituelle : la case de 0,1° d’où partent le plus de sorties, puis les tracés partis à moins de ~25 km, sans les points extrêmes.
  const homeBounds = () => {
    const key = (p) => `${Math.round(p[0] * 10)}|${Math.round(p[1] * 10)}`;
    const count = new Map();
    runs.forEach((r) => count.set(key(r.pts[0]), (count.get(key(r.pts[0])) || 0) + 1));
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0].split('|').map((v) => Number(v) / 10);
    const near = runs.filter((r) => Math.abs(r.pts[0][0] - top[0]) < 0.25 && Math.abs(r.pts[0][1] - top[1]) < 0.35);
    const lats = [];
    const lngs = [];
    near.forEach((r) => r.pts.forEach((p, i) => {
      if (i % 2 === 0) {
        lats.push(p[0]);
        lngs.push(p[1]);
      }
    }));
    lats.sort((a, b) => a - b);
    lngs.sort((a, b) => a - b);
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    return [[q(lats, 0.05), q(lngs, 0.05)], [q(lats, 0.95), q(lngs, 0.95)]];
  };

  /* ---------- Carte ---------- */
  let map = null;
  let renderer = null;
  let base = null; // fond de carte (couche MapLibre)
  let baseUrl = '';
  let heat = null;
  let selLayer = null;
  let home = null;
  let theme = null;
  let sig = '';
  let touch = false;
  const isDark = () => {
    const c = d3.rgb(SR.rgb(SR.col.panel, 'rgb(255, 255, 255)'));
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
  };
  const STYLE = (dark) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
  const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/">OpenMapTiles</a>';
  const webgl = () => {
    try {
      const ctx = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      const lose = ctx && ctx.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return !!ctx;
    } catch (err) {
      return false;
    }
  };

  // Fond de carte clair ou sombre selon le thème. Sans WebGL, ou si le service ne répond pas, les tracés restent sur le fond du panneau.
  function setBase() {
    if (!map || gl !== 'ready') return;
    const url = STYLE(isDark());
    if (base) {
      if (url !== baseUrl) {
        baseUrl = url;
        base.getMaplibreMap().setStyle(url);
      }
      return;
    }
    if (!webgl()) {
      gl = 'error';
      return;
    }
    const layer = window.L.maplibreGL({ style: url, attributionControl: { customAttribution: ATTRIBUTION } });
    try {
      layer.addTo(map);
    } catch (err) {
      gl = 'error';
      map.off(layer.getEvents(), layer);
      if (layer.getContainer()) layer.getContainer().remove();
      return;
    }
    base = layer;
    baseUrl = url;
    const glMap = layer.getMaplibreMap();
    // Tuiles momentanément indisponibles : rien à signaler, la carte reste utilisable.
    glMap.on('error', () => {});
    glMap.once('load', () => layer.getContainer().classList.add('is-on'));
  }

  const build = (box) => {
    const L = window.L;
    touch = L.Browser.mobile || (L.Browser.touch && !(window.matchMedia && window.matchMedia('(pointer: fine)').matches));
    box.replaceChildren();
    renderer = L.canvas({ padding: 0.4, tolerance: touch ? 10 : 5 });
    map = L.map(box, {
      renderer,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 3,
      maxZoom: 18,
      // Sur mobile, un doigt fait défiler la page ; deux doigts déplacent et zooment la carte.
      dragging: !touch,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    map.attributionControl.setPrefix(false);
    heat = L.layerGroup().addTo(map);
    selLayer = L.layerGroup().addTo(map);
    // Molette active seulement après un clic dans la carte, pour ne pas gêner le défilement de la page.
    map.on('click', () => map.scrollWheelZoom.enable());
    box.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
    map.on('click', (e) => {
      if (!e.originalEvent || !e.originalEvent.defaultPrevented) select(null, false);
    });
    if (touch) {
      const hint = SR.el('div', 'sr-maphint', 'Deux doigts pour déplacer la carte');
      box.append(hint);
      let timer = null;
      box.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        hint.classList.add('is-on');
        clearTimeout(timer);
        timer = setTimeout(() => hint.classList.remove('is-on'), 1400);
      }, { passive: true });
    }
    home = homeBounds();
    map.fitBounds(home, { padding: [12, 12] });
    setBase();
  };

  const filtered = () => runs.filter((r) => (ui.kind === 'races' ? r.race : true)
    && (ui.range === 'all' ? true : ui.range === '12m' ? r.day > lastDay - 365 : String(r.year) === ui.range));

  const drawHeat = () => {
    const L = window.L;
    const list = filtered();
    heat.clearLayers();
    const dark = isDark();
    const color = SR.rgb(SR.col.orange, 'rgb(235, 104, 52)');
    const races = ui.kind === 'races';
    const base = races ? 0.9 : list.length > 400 ? 0.3 : list.length > 150 ? 0.4 : 0.55;
    const op = Math.min(1, base + (dark && !races ? 0.12 : 0));
    const w = races ? 3 : 2;
    // Les plus anciennes d’abord : les plus récentes passent au-dessus.
    [...list].sort((a, b) => a.day - b.day).forEach((r) => {
      const line = L.polyline(r.pts, { renderer, color, weight: w, opacity: op, smoothFactor: 1.2, bubblingMouseEvents: false });
      line.on('click', (e) => {
        if (e.originalEvent) e.originalEvent.preventDefault();
        select(r.id, false);
      });
      if (!touch) {
        line.on('mouseover', () => line.setStyle({ weight: w + 1.5, opacity: 1 }));
        line.on('mouseout', () => line.setStyle({ weight: w, opacity: op }));
      }
      heat.addLayer(line);
    });
    drawSel(false);
  };

  // Tracé choisi : liseré couleur du fond, trait bleu, départ (rond vide) et arrivée (rond plein).
  // Une boucle choisie plus bas dans l’onglet : tous ses passages en bleu.
  const drawSel = (fly) => {
    const L = window.L;
    selLayer.clearLayers();
    const blue = SR.rgb(SR.col.blue, 'rgb(42, 120, 214)');
    const panel = SR.rgb(SR.col.panel, 'rgb(255, 255, 255)');
    if (ui.group) {
      const rs = ui.group.ids.map((id) => byId.get(id)).filter(Boolean);
      if (!rs.length) return;
      rs.forEach((r) => selLayer.addLayer(L.polyline(r.pts, { renderer, color: panel, weight: 6, opacity: 0.9, interactive: false })));
      rs.forEach((r) => selLayer.addLayer(L.polyline(r.pts, { renderer, color: blue, weight: 2.5, opacity: 0.85, interactive: false })));
      if (fly) {
        const s = Math.min(...rs.map((r) => r.box[0][0]));
        const w = Math.min(...rs.map((r) => r.box[0][1]));
        const n = Math.max(...rs.map((r) => r.box[1][0]));
        const e = Math.max(...rs.map((r) => r.box[1][1]));
        map.flyToBounds([[s, w], [n, e]], { padding: [24, 24], maxZoom: 15, duration: 0.7 });
      }
      return;
    }
    const r = ui.sel && byId.get(ui.sel);
    if (!r) return;
    selLayer.addLayer(L.polyline(r.pts, { renderer, color: panel, weight: 7.5, opacity: 0.95, interactive: false }));
    selLayer.addLayer(L.polyline(r.pts, { renderer, color: blue, weight: 3.5, opacity: 1, interactive: false }));
    selLayer.addLayer(L.circleMarker(r.pts[0], { renderer, radius: 5, color: blue, weight: 2.5, fillColor: panel, fillOpacity: 1, interactive: false }));
    selLayer.addLayer(L.circleMarker(r.pts[r.pts.length - 1], { renderer, radius: 5, color: panel, weight: 2, fillColor: blue, fillOpacity: 1, interactive: false }));
    if (fly) map.flyToBounds(r.box, { padding: [30, 30], maxZoom: 15, duration: 0.7 });
  };

  const select = (id, fly) => {
    ui.sel = id;
    ui.group = null;
    drawSel(fly);
    renderInfo();
    renderList();
  };

  /* ---------- Textes autour de la carte ---------- */
  const b = (t) => SR.el('b', null, t);
  const txt = (t) => document.createTextNode(t);
  const renderStats = () => {
    const el = $('#map-stats');
    const list = filtered();
    const km = list.reduce((s, r) => s + r.km, 0);
    const n = list.length;
    const line = SR.el('span');
    line.append(b(SR.n0(n)), txt(ui.kind === 'races' ? ` compétition${n > 1 ? 's' : ''}` : ` sortie${n > 1 ? 's' : ''}`), txt(' · '), b(`${SR.n0(km)} km`));
    el.replaceChildren(line);
  };

  const renderInfo = () => {
    const el = $('#map-info');
    const r = ui.sel && byId.get(ui.sel);
    const reset = SR.el('button', null, r ? 'Tout voir' : 'Recentrer');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      select(null, false);
      map.flyToBounds(home, { padding: [12, 12], duration: 0.7 });
    });
    if (ui.group) {
      reset.textContent = 'Tout voir';
      el.replaceChildren(SR.el('span', 'sr-mapinfo__title', ui.group.label), SR.el('span', null, `${SR.n0(ui.group.ids.length)} passages en bleu`), reset);
      return;
    }
    if (!r) {
      el.replaceChildren(SR.el('span', null, touch ? 'Touchez un tracé pour voir la sortie' : 'Cliquez sur un tracé pour voir la sortie'), reset);
      return;
    }
    const parts = [SR.el('span', 'sr-mapinfo__title', r.race ? r.event : r.name), SR.el('span', null, `${SR.dday(r.date)}${r.city ? ` · ${r.city}` : ''}`)];
    const stat = SR.el('span');
    if (r.race) {
      stat.append(b(SR.dur(r.time_s)), txt(' · '), b(`${SR.pace(r.race_pace_s)}/km`), txt(` sur ${SR.n1(r.race_km)} km`), ...(r.place ? [txt(' · '), b(r.place)] : []));
    } else {
      stat.append(b(`${SR.n1(r.km)} km`), txt(' en '), b(SR.dur(r.moving_s)), txt(' · '), b(`${SR.pace(r.pace_s)}/km`));
    }
    parts.push(stat);
    el.replaceChildren(...parts, reset);
  };

  const renderList = () => {
    const box = $('#c-maprace');
    const races = runs.filter((r) => r.race).sort((a, b2) => b2.day - a.day);
    if (!races.length) {
      box.classList.remove('dash-skeleton');
      box.replaceChildren(SR.el('p', 'sr-empty', 'Aucune compétition avec tracé.'));
      return;
    }
    box.classList.remove('dash-skeleton');
    $('#maprace-note').textContent = `${races.length} courses avec leur tracé GPS · ${touch ? 'touchez' : 'cliquez sur'} une course pour la voir sur la carte`;
    box.replaceChildren(...races.map((r) => {
      const li = SR.el('li');
      const btn = SR.el('button', 'sr-qbtn');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(r.id === ui.sel));
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = r.id === ui.sel ? SR.col.blue : SR.col.orange;
      const main = SR.el('span', 'sr-qbtn__main');
      main.append(SR.el('span', 'sr-list__name', r.event),
        SR.el('span', 'sr-list__sub', `${SR.dmed(r.date)}${r.category && r.category !== r.event ? ` · ${r.category}` : ''}${r.place ? ` · ${r.place}` : ''}`));
      const val = SR.el('span', 'sr-list__value', SR.dur(r.time_s));
      val.append(SR.el('small', null, `${SR.pace(r.race_pace_s)}/km`));
      btn.append(sw, main, val);
      btn.addEventListener('click', () => {
        // Le tracé choisi s’affiche par-dessus, quel que soit le filtre de la carte.
        select(r.id, true);
        // Sur téléphone, la liste est sous la carte : on remonte jusqu’à elle.
        const m = $('#c-map').getBoundingClientRect();
        if (m.top < 0 || m.bottom > window.innerHeight) $('#card-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      li.append(btn);
      return li;
    }));
  };

  const setSeg = (id, v) => $(`#${id}`).querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
  const buildRange = () => {
    const group = $('#map-range');
    const opts = [['all', 'Tout'], ['12m', '12 mois'], ...years.map((y) => [String(y), String(y)])];
    group.replaceChildren(...opts.map(([v, l]) => {
      const btn = SR.el('button', null, l);
      btn.type = 'button';
      btn.dataset.v = v;
      btn.setAttribute('aria-pressed', String(v === ui.range));
      return btn;
    }));
  };
  const onSeg = (id, key) => {
    $(`#${id}`).addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn || !map) return;
      ui[key] = btn.dataset.v;
      setSeg(id, btn.dataset.v);
      run(drawMap);
    });
  };
  onSeg('map-range', 'range');
  onSeg('map-kind', 'kind');

  const fail = (box, msg) => {
    box.classList.remove('dash-skeleton');
    box.replaceChildren(SR.el('div', 'sr-failed', msg));
    $('#c-maprace').classList.remove('dash-skeleton');
  };

  function drawMap() {
    const box = $('#c-map');
    const res = dash.data('map_runs');
    if (res.status === 'error') {
      fail(box, 'Failed to load');
      return;
    }
    loadLibs();
    if (leaflet === 'error') {
      fail(box, 'Carte indisponible');
      return;
    }
    if (res.status !== 'ok' || leaflet !== 'ready') return;
    if (!runs) prepare(res.data);
    if (!runs.length) {
      fail(box, 'Aucun tracé GPS pour l’instant');
      return;
    }
    box.classList.remove('dash-skeleton');
    if (!map) {
      build(box);
      buildRange();
      if (pendingFocus) {
        ui.group = pendingFocus;
        pendingFocus = null;
      }
    }
    map.invalidateSize();
    const dark = isDark();
    if (dark !== theme) {
      theme = dark;
      setBase();
      sig = '';
    }
    const s = `${ui.range}|${ui.kind}|${theme}`;
    if (s !== sig) {
      sig = s;
      drawHeat();
      renderStats();
      renderList();
      renderInfo();
    }
  }

  // Met en avant un ensemble de tracés (une boucle habituelle) et remonte jusqu’à la carte.
  SR.mapFocus = (ids, label) => {
    const g = { ids, label };
    const card = $('#card-map');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!map) {
      pendingFocus = g;
      return;
    }
    ui.sel = null;
    ui.group = g;
    drawSel(true);
    renderInfo();
    renderList();
  };

  SR.pages = SR.pages || {};
  Object.assign(SR.pages, { carte: [drawMap] });
})();
