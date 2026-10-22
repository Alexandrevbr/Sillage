/* Onglet Carte : toutes les sorties en carte de chaleur, le tracé de chaque compétition, la carte de la boucle
 * habituelle choisie et les vignettes des boucles.
 * Leaflet (assets/leaflet) dessine les tracés ; le fond de carte vectoriel OpenFreeMap (gratuit, sans clé) est dessiné
 * par MapLibre GL via le pont maplibre-gl-leaflet (assets/maplibre). Bibliothèques et tracés (data/routes.json) ne sont
 * chargés qu’à l’ouverture de l’onglet. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const ui = { range: 'all', kind: 'all', sel: null };
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
  // Les cartes et les tracés s’affichent dès que Leaflet est là ; le fond de carte (MapLibre, plus lourd) arrive ensuite.
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
      if (!visible()) return;
      run(drawMap);
      run(drawLoopMap);
    });
    // Le pont a besoin de Leaflet et de MapLibre.
    Promise.all([lf, script('assets/maplibre/maplibre-gl.js')])
      .then(() => script('assets/maplibre/leaflet-maplibre-gl.js'))
      .then(() => {
        gl = 'ready';
        [map, lm.map].forEach((m) => m && run(() => setBase(m)));
        run(renderThumbs);
      }, () => {
        gl = 'error';
      });
  };

  /* ---------- Tracés : polylignes encodées (précision 1e-5) ---------- */
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
  // Tracés décodés, dès que les données sont là (null sinon).
  const routesReady = () => {
    const res = dash.data('map_runs');
    if (res.status !== 'ok') return null;
    if (!runs) prepare(res.data);
    return runs;
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
  const unionBox = (rs) => [
    [Math.min(...rs.map((r) => r.box[0][0])), Math.min(...rs.map((r) => r.box[0][1]))],
    [Math.max(...rs.map((r) => r.box[1][0])), Math.max(...rs.map((r) => r.box[1][1]))],
  ];

  /* ---------- Fond de carte ---------- */
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

  // Fond clair ou sombre selon le thème, pour chaque carte Leaflet. Sans WebGL, ou si le service ne répond pas,
  // les tracés restent sur le fond du panneau.
  const bases = new Map(); // carte Leaflet → { layer, url }
  function setBase(m) {
    if (!m || gl !== 'ready') return;
    const url = STYLE(isDark());
    const cur = bases.get(m);
    if (cur) {
      if (cur.url !== url) {
        cur.url = url;
        cur.layer.getMaplibreMap().setStyle(url);
      }
      return;
    }
    if (!webgl()) {
      gl = 'error';
      return;
    }
    const layer = window.L.maplibreGL({ style: url, attributionControl: { customAttribution: ATTRIBUTION } });
    try {
      layer.addTo(m);
    } catch (err) {
      gl = 'error';
      m.off(layer.getEvents(), layer);
      if (layer.getContainer()) layer.getContainer().remove();
      return;
    }
    bases.set(m, { layer, url });
    const glMap = layer.getMaplibreMap();
    // Tuiles momentanément indisponibles : rien à signaler, la carte reste utilisable.
    glMap.on('error', () => {});
    glMap.once('load', () => layer.getContainer().classList.add('is-on'));
  }

  // Carte Leaflet aux réglages du site. Sur mobile, un doigt fait défiler la page, deux doigts déplacent et zooment
  // la carte ; à la souris, la molette ne zoome qu’après un clic dans la carte.
  let touch = false;
  const newMap = (box) => {
    const L = window.L;
    touch = L.Browser.mobile || (L.Browser.touch && !(window.matchMedia && window.matchMedia('(pointer: fine)').matches));
    box.replaceChildren();
    const renderer = L.canvas({ padding: 0.4, tolerance: touch ? 10 : 5 });
    const m = L.map(box, {
      renderer,
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 3,
      maxZoom: 18,
      dragging: !touch,
      scrollWheelZoom: false,
      attributionControl: true,
    });
    m.attributionControl.setPrefix(false);
    m.on('click', () => m.scrollWheelZoom.enable());
    box.addEventListener('mouseleave', () => m.scrollWheelZoom.disable());
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
    return { map: m, renderer };
  };

  // Tracé mis en avant : liseré couleur du fond, trait bleu, départ (rond vide) et arrivée (rond plein).
  const drawTrace = (group, rend, r) => {
    const L = window.L;
    const blue = SR.rgb(SR.col.blue, 'rgb(42, 120, 214)');
    const panel = SR.rgb(SR.col.panel, 'rgb(255, 255, 255)');
    group.addLayer(L.polyline(r.pts, { renderer: rend, color: panel, weight: 7.5, opacity: 0.95, interactive: false }));
    group.addLayer(L.polyline(r.pts, { renderer: rend, color: blue, weight: 3.5, opacity: 1, interactive: false }));
    group.addLayer(L.circleMarker(r.pts[0], { renderer: rend, radius: 5, color: blue, weight: 2.5, fillColor: panel, fillOpacity: 1, interactive: false }));
    group.addLayer(L.circleMarker(r.pts[r.pts.length - 1], { renderer: rend, radius: 5, color: panel, weight: 2, fillColor: blue, fillOpacity: 1, interactive: false }));
  };

  const failBox = (box, msg) => {
    box.classList.remove('dash-skeleton');
    box.replaceChildren(SR.el('div', 'sr-failed', msg));
  };

  /* ---------- Carte de toutes les sorties ---------- */
  let map = null;
  let renderer = null;
  let heat = null;
  let selLayer = null;
  let home = null;
  let theme = null;
  let sig = '';

  const build = (box) => {
    const L = window.L;
    ({ map, renderer } = newMap(box));
    heat = L.layerGroup().addTo(map);
    selLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      if (!e.originalEvent || !e.originalEvent.defaultPrevented) select(null, false);
    });
    home = homeBounds();
    map.fitBounds(home, { padding: [12, 12] });
    setBase(map);
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

  const drawSel = (fly) => {
    selLayer.clearLayers();
    const r = ui.sel && byId.get(ui.sel);
    if (!r) return;
    drawTrace(selLayer, renderer, r);
    if (fly) map.flyToBounds(r.box, { padding: [30, 30], maxZoom: 15, duration: 0.7 });
  };

  const select = (id, fly) => {
    ui.sel = id;
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
    failBox(box, msg);
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
    routesReady();
    if (!runs.length) {
      fail(box, 'Aucun tracé GPS pour l’instant');
      return;
    }
    box.classList.remove('dash-skeleton');
    if (!map) {
      build(box);
      buildRange();
    }
    map.invalidateSize();
    const dark = isDark();
    if (dark !== theme) {
      theme = dark;
      setBase(map);
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
    // Les vignettes des boucles attendaient peut-être les tracés.
    run(renderThumbs);
  }

  /* ---------- Carte de la boucle choisie (section Boucles habituelles) ---------- */
  // Tous les passages en orange ; en bleu, le meilleur, ou le passage montré dans le graphique.
  const lm = { box: null, req: null, map: null, renderer: null, all: null, sel: null, sig: '', pick: null };
  // req : { key, ids (passages), best (id du meilleur passage) }
  SR.loopMap = (box, req) => {
    lm.box = box;
    lm.req = req;
    run(drawLoopMap);
  };
  SR.loopPick = (id) => {
    const v = id || null;
    if (lm.pick === v) return;
    lm.pick = v;
    if (lm.map) drawLoopSel();
  };
  const drawLoopSel = () => {
    lm.sel.clearLayers();
    const r = byId.get(lm.pick) || byId.get(lm.req.best) || byId.get(lm.req.ids[0]);
    if (r) drawTrace(lm.sel, lm.renderer, r);
  };
  function drawLoopMap() {
    const box = lm.box;
    const req = lm.req;
    if (!box || !req || !visible()) return;
    const res = dash.data('map_runs');
    if (res.status === 'error') {
      failBox(box, 'Failed to load');
      return;
    }
    loadLibs();
    if (leaflet === 'error') {
      failBox(box, 'Carte indisponible');
      return;
    }
    if (leaflet !== 'ready' || !routesReady()) return;
    const rs = req.ids.map((id) => byId.get(id)).filter(Boolean);
    if (!rs.length) return;
    const L = window.L;
    box.classList.remove('dash-skeleton');
    const fresh = !lm.map;
    if (fresh) {
      ({ map: lm.map, renderer: lm.renderer } = newMap(box));
      lm.all = L.layerGroup().addTo(lm.map);
      lm.sel = L.layerGroup().addTo(lm.map);
    }
    lm.map.invalidateSize();
    const s = `${req.key}|${isDark()}`;
    if (s !== lm.sig) {
      const moved = fresh || !lm.sig.startsWith(`${req.key}|`);
      lm.sig = s;
      if (moved) lm.pick = null;
      lm.all.clearLayers();
      const orange = SR.rgb(SR.col.orange, 'rgb(235, 104, 52)');
      const op = rs.length > 20 ? 0.4 : 0.55;
      rs.forEach((r) => lm.all.addLayer(L.polyline(r.pts, { renderer: lm.renderer, color: orange, weight: 2, opacity: op, interactive: false })));
      drawLoopSel();
      if (fresh) lm.map.fitBounds(unionBox(rs), { padding: [16, 16], maxZoom: 16 });
      else if (moved) lm.map.flyToBounds(unionBox(rs), { padding: [16, 16], maxZoom: 16, duration: 0.6 });
    }
    setBase(lm.map);
  }

  /* ---------- Vignettes des boucles ---------- */
  // Une carte MapLibre hors écran, photographiée boucle par boucle : un vrai fond de carte dans chaque vignette.
  // items : [{ key, id (passage dont on montre le tracé), shape (repli) }] ; onThumb(key, url de l’image).
  const TW = 240;
  const TH = 156;
  let thumbReq = null;
  let thumbBusy = false;
  SR.loopThumbs = (items, onThumb) => {
    const dark = isDark();
    const key = `${items.map((it) => it.id).join(',')}|${dark}`;
    if (!thumbReq || thumbReq.key !== key) thumbReq = { key, items, dark, onThumb, started: false };
    else thumbReq.onThumb = onThumb;
    loadLibs();
    run(renderThumbs);
  };
  function renderThumbs() {
    const req = thumbReq;
    if (!req || req.started || thumbBusy || gl !== 'ready' || !window.maplibregl || !routesReady()) return;
    if (!webgl()) {
      gl = 'error';
      return;
    }
    req.started = true;
    thumbBusy = true;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:${-TW - 200}px;top:0;width:${TW}px;height:${TH}px;pointer-events:none;`;
    document.body.append(host);
    let glm = null;
    let over = false;
    let loadTimer = null;
    const done = () => {
      if (over) return;
      over = true;
      clearTimeout(loadTimer);
      if (glm) glm.remove();
      host.remove();
      thumbBusy = false;
      if (thumbReq && !thumbReq.started) run(renderThumbs);
    };
    try {
      glm = new window.maplibregl.Map({
        container: host,
        style: STYLE(req.dark),
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        pixelRatio: Math.min(3, window.devicePixelRatio || 1),
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });
    } catch (err) {
      done();
      return;
    }
    glm.on('error', () => {});
    loadTimer = setTimeout(done, 15000);
    const orange = SR.rgb(SR.col.orange, 'rgb(235, 104, 52)');
    const panel = SR.rgb(SR.col.panel, 'rgb(255, 255, 255)');
    glm.once('load', () => {
      clearTimeout(loadTimer);
      if (over) return;
      // Sans noms de rues ni de lieux : à cette taille, ils ne se lisent pas.
      glm.getStyle().layers.forEach((l) => {
        if (l.type === 'symbol') glm.setLayoutProperty(l.id, 'visibility', 'none');
      });
      glm.addSource('sr-loop', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const isLine = ['==', ['geometry-type'], 'LineString'];
      const round = { 'line-cap': 'round', 'line-join': 'round' };
      glm.addLayer({ id: 'sr-loop-casing', type: 'line', source: 'sr-loop', filter: isLine, layout: round, paint: { 'line-color': panel, 'line-width': 6, 'line-opacity': 0.9 } });
      glm.addLayer({ id: 'sr-loop-line', type: 'line', source: 'sr-loop', filter: isLine, layout: round, paint: { 'line-color': orange, 'line-width': 3 } });
      glm.addLayer({
        id: 'sr-loop-start', type: 'circle', source: 'sr-loop', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': panel, 'circle-stroke-color': orange, 'circle-stroke-width': 2 },
      });
      let i = 0;
      const next = () => {
        if (over) return;
        if (thumbReq !== req || i >= req.items.length) {
          done();
          return;
        }
        const it = req.items[i++];
        const r = byId.get(it.id);
        const pts = r ? r.pts : it.shape;
        if (!pts || pts.length < 2) {
          next();
          return;
        }
        const coords = pts.map((p) => [p[1], p[0]]);
        glm.getSource('sr-loop').setData({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[0] } },
          ],
        });
        const lngs = coords.map((c) => c[0]);
        const lats = coords.map((c) => c[1]);
        glm.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 16, maxZoom: 15.5, animate: false });
        let shot = false;
        let timer = null;
        const snap = () => {
          if (shot || over) return;
          shot = true;
          clearTimeout(timer);
          glm.getCanvas().toBlob((blob) => {
            if (blob && thumbReq === req) run(() => req.onThumb(it.key, URL.createObjectURL(blob)));
            next();
          });
        };
        // Photo dès que les tuiles sont dessinées (au plus tard après 8 s).
        timer = setTimeout(snap, 8000);
        glm.once('idle', snap);
      };
      next();
    });
  }

  SR.pages = SR.pages || {};
  SR.pages.carte = (SR.pages.carte || []).concat([drawMap]);
})();
