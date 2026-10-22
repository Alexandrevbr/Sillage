/* Accueil : l’en-tête « sillage » (tous mes tracés autour de Paris), les cartes « En ce moment »,
 * et les constats en tête des onglets Historique et Carte. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const DAY = 864e5;
  const txt = (s) => document.createTextNode(s);
  const hl = (s) => SR.el('span', 'sr-hl', s);
  const run = (fn) => {
    try {
      fn();
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }
  };
  const entered = new Set();
  const enter = (el) => {
    const card = el && el.closest('.sr-card, .sr-lead, .sr-now');
    if (!card || entered.has(card)) return;
    entered.add(card);
    card.classList.add('sr-enter');
  };
  const today = () => {
    const n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY;
  };
  const dayOf = (iso) => SR.utc(iso).getTime() / DAY;
  const gapTxt = (s) => {
    const a = Math.round(Math.abs(s));
    return a < 60 ? `${a} s` : SR.dur(a);
  };
  const reduced = () => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  };

  /* ================= En-tête : le sillage de toutes mes sorties ================= */
  // Polyline encodée (précision 1e-5) → [lat, lng, lat, lng, …]
  const decode = (str) => {
    const out = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let b;
      let shift = 0;
      let res = 0;
      do {
        b = str.charCodeAt(i++) - 63;
        res |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32 && i < str.length);
      return res & 1 ? ~(res >> 1) : res >> 1;
    };
    while (i < str.length) {
      lat += next();
      lng += next();
      out.push(lat / 1e5, lng / 1e5);
    }
    return out;
  };
  let art = null;
  let grown = false;
  // Les tracés autour du quartier où je cours le plus, et le cadre qui en contient l’essentiel.
  const prepare = (routes) => {
    const tracks = routes.map((r) => decode(r.p)).filter((p) => p.length >= 8);
    if (!tracks.length) return null;
    const centers = tracks.map((p) => {
      let a = 0;
      let b = 0;
      for (let k = 0; k < p.length; k += 2) {
        a += p[k];
        b += p[k + 1];
      }
      return [a / (p.length / 2), b / (p.length / 2)];
    });
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const lat0 = med(centers.map((c) => c[0]));
    const lng0 = med(centers.map((c) => c[1]));
    const near = tracks.filter((p, k) => Math.abs(centers[k][0] - lat0) < 0.15 && Math.abs(centers[k][1] - lng0) < 0.22);
    const lats = [];
    const lngs = [];
    near.forEach((p) => {
      for (let k = 0; k < p.length; k += 2) {
        lats.push(p[k]);
        lngs.push(p[k + 1]);
      }
    });
    lats.sort((a, b) => a - b);
    lngs.sort((a, b) => a - b);
    const q = (a, f) => a[Math.floor(f * (a.length - 1))];
    return {
      tracks: near, n: near.length, kx: Math.cos((lat0 * Math.PI) / 180),
      box: [q(lats, 0.03), q(lats, 0.97), q(lngs, 0.03), q(lngs, 0.97)],
    };
  };

  function drawCover() {
    const cv = $('#cover-art');
    if (!cv) return;
    const res = dash.data('routes');
    if (res.status !== 'ok' || !Array.isArray(res.data)) return;
    const host = cv.parentElement;
    const W = Math.round(host.clientWidth);
    const H = Math.round(host.clientHeight);
    if (!W || !H) return;
    const key = `${W}x${H}`;
    if (cv.dataset.key === key) return;
    if (!art) art = prepare(res.data);
    if (!art) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Sur grand écran, les tracés occupent la droite ; sur téléphone, le haut de l’en-tête.
    const wide = W >= 860;
    const area = wide ? { x: W * 0.44, y: H * 0.04, w: W * 0.54, h: H * 0.8 } : { x: 0, y: 4, w: W, h: Math.min(H * 0.36, W * 0.9) };
    const [la0, la1, ln0, ln1] = art.box;
    const bw = (ln1 - ln0) * art.kx;
    const bh = la1 - la0;
    const s = Math.min(area.w / bw, area.h / bh) * (wide ? 1.04 : 0.98);
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const mlat = (la0 + la1) / 2;
    const mlng = (ln0 + ln1) / 2;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Chaque passage ajoute de la lumière : un trait isolé reste bleu nuit, une rue courue cent fois devient blanche.
    const pass = (list, width, alpha) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = `rgba(70, 108, 255, ${alpha})`;
      list.forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(cx + (p[1] - mlng) * art.kx * s, cy - (p[0] - mlat) * s);
        for (let k = 2; k < p.length; k += 2) ctx.lineTo(cx + (p[k + 1] - mlng) * art.kx * s, cy - (p[k] - mlat) * s);
        ctx.stroke();
      });
    };
    const paint = (list) => {
      pass(list, wide ? 3.5 : 3, 0.016);
      pass(list, wide ? 1.05 : 0.85, 0.15);
    };
    cv.dataset.key = key;
    host.classList.add('is-drawn');
    // Au premier affichage, le sillage se dessine sortie après sortie, dans l’ordre où je les ai courues.
    if (!grown && !reduced()) {
      grown = true;
      const per = Math.max(3, Math.ceil(art.tracks.length / 100));
      let k = 0;
      const step = () => {
        if (cv.dataset.key !== key) return; // redessiné entre-temps (rotation)
        paint(art.tracks.slice(k, k + per));
        k += per;
        if (k < art.tracks.length) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      paint(art.tracks);
    }
    const credit = $('#cover-credit');
    if (credit) {
      credit.textContent = `${SR.n0(art.n)} sorties autour de Paris : plus le trait est clair, plus j’y suis passé`;
      credit.hidden = false;
    }
  }

  // Chiffres clés : un décompte rapide au premier affichage.
  let counted = false;
  function countUp() {
    if (counted || reduced()) return;
    const res = dash.data('totals');
    if (res.status !== 'ok') return;
    const els = [...root.querySelectorAll('.sr-cover .sr-kpi__value [data-fmt="n0"]')].filter((el) => el.dataset.filled);
    if (!els.length) return;
    counted = true;
    const items = els.map((el) => ({ el, end: Number(String(el.textContent).replace(/\D/g, '')) || 0 }));
    const t0 = performance.now();
    const dur = 900;
    items.forEach((it) => {
      it.el.dataset.counting = '1';
    });
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      items.forEach((it) => {
        it.el.textContent = SR.n0(Math.round(it.end * e));
      });
      if (k < 1) requestAnimationFrame(step);
      else items.forEach((it) => delete it.el.dataset.counting);
    };
    requestAnimationFrame(step);
  }

  /* ================= En ce moment ================= */
  // Petite courbe sans axe, pour donner la tendance d’un coup d’œil.
  const spark = (host, draw) => {
    const W = Math.max(120, Math.floor(host.clientWidth || 160));
    const H = 44;
    const svg = d3.select(host).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%').attr('height', H)
      .attr('preserveAspectRatio', 'none').attr('aria-hidden', 'true').style('display', 'block').style('overflow', 'visible');
    draw(svg, W, H);
  };
  const card = (page, label, value, unit, sub, chip, drawSpark, go) => {
    const a = SR.el('a', 'sr-nowcard');
    a.href = `#${page}`;
    a.dataset.goto = page;
    const head = SR.el('div', 'sr-nowcard__head');
    head.append(SR.el('span', 'sr-nowcard__label', label));
    if (chip) head.append(chip);
    const v = SR.el('p', 'sr-nowcard__value');
    v.append(value);
    if (unit) v.append(SR.el('span', 'sr-unit', unit));
    const s = SR.el('p', 'sr-nowcard__sub');
    s.append(...sub);
    const sp = SR.el('div', 'sr-nowcard__spark');
    a.append(head, v, s, sp, SR.el('span', 'sr-nowcard__go', go));
    a.sparkDraw = drawSpark;
    return a;
  };
  const chipEl = (text, kind) => SR.el('span', `sr-nowchip${kind ? ` sr-nowchip--${kind}` : ''}`, text);

  function drawNow() {
    const box = $('#now');
    if (!box) return;
    const d = SR.ready(box, ['load_now', 'load', 'vol_summary', 'by_week', 'race_last', 'race_level', 'goal_info', 'goal_predict', 'highlights']);
    if (!d) return;
    const [[l], load, [v], weeks, [r], [lvl], goal, pred, [h]] = d;
    const cards = [];
    const blue = 'var(--sr-brand)';

    // Forme
    if (l) {
      const state = l.form >= 5 ? 'frais' : l.form >= -10 ? 'équilibré' : l.form >= -30 ? 'en pleine charge' : 'surchargé';
      const delta = Math.round(l.fitness_delta);
      const series = load.slice(-120);
      cards.push(card('cardio', 'Forme', SR.n0(l.fitness), null,
        [txt(`fraîcheur ${SR.sn0(l.form)} · ${state}`)],
        chipEl(`${delta > 0 ? '↗' : delta < 0 ? '↘' : '→'} ${SR.sn0(delta)} en 4 sem.`, delta > 0 ? 'up' : ''),
        (svg, W, H) => {
          const x = d3.scaleLinear([0, series.length - 1], [2, W - 4]);
          const ext = d3.extent(series, (p) => p.fitness);
          const pad = Math.max(2, (ext[1] - ext[0]) * 0.15);
          const y = d3.scaleLinear([Math.max(0, ext[0] - pad), ext[1] + pad], [H - 2, 4]);
          svg.append('path').datum(series).attr('d', d3.area().x((p, i) => x(i)).y0(H).y1((p) => y(p.fitness)).curve(d3.curveMonotoneX))
            .style('fill', blue).attr('fill-opacity', 0.1);
          svg.append('path').datum(series).attr('d', d3.line().x((p, i) => x(i)).y((p) => y(p.fitness)).curve(d3.curveMonotoneX))
            .style('fill', 'none').style('stroke', blue).attr('stroke-width', 2).attr('vector-effect', 'non-scaling-stroke');
          svg.append('circle').attr('cx', x(series.length - 1)).attr('cy', y(series[series.length - 1].fitness)).attr('r', 3.5)
            .style('fill', blue).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
        }, 'Forme & cardio'));
    }

    // Volume
    if (v) {
      const ws = weeks.slice(-16);
      cards.push(card('entrainement', 'Volume', SR.n0(v.avg4), 'km/sem',
        [txt(`moyenne sur 4 semaines · ${SR.n0(v.avg13)} sur 3 mois`)],
        null,
        (svg, W, H) => {
          const x = d3.scaleBand(ws.map((w) => w.week), [0, W]).padding(0.28);
          const y = d3.scaleLinear([0, d3.max(ws, (w) => w.km) || 1], [H, 3]);
          svg.append('g').selectAll('path').data(ws).join('path')
            .attr('d', (w, i) => SR.barPath(x(w.week), y(w.km), x.bandwidth(), H - y(w.km), 2))
            .style('fill', blue).attr('fill-opacity', (w, i) => (i >= ws.length - 4 ? 1 : 0.32));
        }, 'Entraînement'));
    }

    // Dernière course
    if (r) {
      const races = lvl ? lvl.races : [];
      const chip = r.pr ? chipEl('record battu', 'up') : r.vdot != null ? chipEl(`VDOT ${SR.n1(r.vdot)}`) : null;
      const sub = [txt(`${r.event} · ${SR.dshort(r.date)}`)];
      cards.push(card('competitions', 'Dernière course', SR.dur(r.time_s), null, sub, chip,
        races.length > 1 ? (svg, W, H) => {
          const x = d3.scalePoint(races.map((p, i) => i), [5, W - 5]);
          const vals = races.map((p) => p.vdot);
          const y = d3.scaleLinear([d3.min(vals) - 0.4, d3.max(vals) + 0.4], [H - 5, 5]);
          svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', y(lvl.vdot_avg)).attr('y2', y(lvl.vdot_avg))
            .style('stroke', 'var(--color-fg-muted)').attr('stroke-dasharray', '3 3').attr('stroke-width', 1).attr('vector-effect', 'non-scaling-stroke');
          svg.append('g').selectAll('circle').data(races).join('circle')
            .attr('cx', (p, i) => x(i)).attr('cy', (p) => y(p.vdot)).attr('r', (p, i) => (p.id === r.id ? 4.5 : 3))
            .style('fill', (p) => (p.id === r.id ? blue : 'var(--cds-chart-muted)'))
            .style('stroke', 'var(--color-panel)').attr('stroke-width', 1.5);
        } : null, 'Compétitions'));
    }

    // Objectif (ou, à défaut, l’année en cours)
    const g = goal[0];
    if (g && !g.result_s) {
      const left = Math.max(0, Math.round(dayOf(g.date) - today()));
      const best = pred.find((p) => p.basis === 'best');
      const gap = best && g.target_s ? best.time_s - g.target_s : null;
      const chip = gap == null ? null : gap > 0 ? chipEl(`il me manque ${gapTxt(gap)}`, 'warn') : chipEl(`${gapTxt(gap)} d’avance`, 'up');
      const sub = [txt(g.event), ...(g.target_s ? [txt(` · visé en ${SR.dur(g.target_s)}`)] : [])];
      const span = 16 * 7;
      cards.push(card('objectif', 'Objectif', left > 0 ? `J-${left}` : 'Jour J', null, sub, chip, (svg, W, H) => {
        const k = Math.max(0, Math.min(1, 1 - left / span));
        const yb = H - 14;
        svg.append('rect').attr('x', 0).attr('y', yb - 4).attr('width', W).attr('height', 8).attr('rx', 4).style('fill', 'var(--sr-fill)');
        svg.append('rect').attr('x', 0).attr('y', yb - 4).attr('width', Math.max(8, W * k)).attr('height', 8).attr('rx', 4).style('fill', blue);
        SR.cap(svg.append('text').attr('x', 0).attr('y', H)).text('16 semaines de préparation');
      }, 'Objectif'));
    } else if (h) {
      cards.push(card('historique', `En ${h.ytd_year}`, SR.n0(h.ytd_km), 'km',
        [txt(`au ${SR.dshort(h.ytd_as_of)} · ${SR.spct(h.ytd_delta)} par rapport à ${h.ytd_prev_year}`)], null, null, 'Historique'));
    }

    box.replaceChildren(...cards);
    cards.forEach((c) => {
      if (c.sparkDraw) spark(c.querySelector('.sr-nowcard__spark'), c.sparkDraw);
      else c.querySelector('.sr-nowcard__spark').remove();
    });
    enter(box);
  }

  /* ================= Historique et Carte : le constat en tête d’onglet ================= */
  function drawHistLead() {
    const box = $('#hist-lead');
    if (!box) return;
    const d = SR.ready(box, ['totals', 'highlights']);
    if (!d || !d[0].length || !d[1].length) return;
    const [[t], [h]] = d;
    box.replaceChildren(
      txt(`Ma première sortie remonte au ${SR.dlong(t.first_date)}. Depuis : `), hl(`${SR.n0(t.km)} km`), txt(' en '),
      hl(`${SR.n0(t.runs)} sorties`), txt(`, soit ${SR.n0(t.hours)} heures de course. Ma meilleure année est `), hl(String(h.best_year)),
      txt(` avec ${SR.n0(h.best_year_km)} km, mon meilleur mois ${SR.dmonth(`${h.best_month}-01`).toLowerCase()} (${SR.n0(h.best_month_km)} km) et ma plus longue sortie fait `),
      hl(`${SR.n1(t.longest_km)} km`), txt('.'),
    );
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawMapLead() {
    const box = $('#map-lead');
    if (!box) return;
    const d = SR.ready(box, ['totals', 'cities', 'loops']);
    if (!d || !d[0].length) return;
    const [[t], cities, loops] = d;
    const parts = [txt('J’ai couru dans '), hl(`${SR.n0(t.cities)} villes`), txt(' et '), hl(`${SR.n0(t.countries)} pays`), txt('. ')];
    const top = cities.slice(0, 2);
    if (top.length) {
      parts.push(txt('Mon terrain de jeu : '), hl(top[0].city), txt(` (${SR.n0(top[0].runs)} sorties)`));
      if (top[1]) parts.push(txt(' et '), hl(top[1].city), txt(` (${SR.n0(top[1].runs)})`));
      parts.push(txt('. '));
    }
    const loop = loops && loops[0];
    if (loop) {
      parts.push(txt('Ma boucle la plus courue, '), hl(`« ${loop.name} »`), txt(`, fait ${SR.n1(loop.km)} km : je l’ai bouclée ${SR.n0(loop.n)} fois.`));
    }
    box.replaceChildren(...parts);
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  SR.pages = SR.pages || {};
  const add = (page, fns) => {
    SR.pages[page] = (SR.pages[page] || []).concat(fns);
  };
  add('apercu', [drawCover, countUp, drawNow]);
  add('historique', [drawHistLead]);
  add('carte', [drawMapLead]);

  // L’en-tête se redessine à la bonne taille si la fenêtre change (rotation du téléphone).
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(drawCover), 150);
  });
})();
