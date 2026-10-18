/* Onglets Cardio et Analyses croisées, section dénivelé et indice VDOT. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const DAY = 864e5;
  const ui = { loadRange: '365', zoneMonthsBy: 'hours', hlYear: null };
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
    const card = el && el.closest('.sr-card, .sr-tiles, .sr-lead, .sr-goal');
    if (!card || entered.has(card)) return;
    entered.add(card);
    card.style.animationDelay = `${(entered.size % 6) * 40}ms`;
    card.classList.add('sr-enter');
  };
  const txt = (s) => document.createTextNode(s);
  // Valeur marquée : la cellule exacte de la source qu’elle cite.
  const mk = (text, source, field, where, row) => {
    const s = SR.el('span', null, text);
    s.dataset.source = source;
    s.dataset.field = field;
    if (where != null) s.dataset.where = where;
    if (row != null) s.dataset.row = String(row);
    return s;
  };
  const hl = (node) => {
    node.classList.add('sr-hl');
    return node;
  };
  const legendItem = (color, label, kind = '') => {
    const item = SR.el('span', 'sr-legend__item');
    const sw = SR.el('i', `sr-sw${kind ? ` sr-sw--${kind}` : ''}`);
    if (kind !== 'ring') sw.style.background = color;
    item.append(sw, txt(label));
    return item;
  };
  const halo = (sel) => sel.attr('paint-order', 'stroke').style('stroke', 'var(--color-panel)').attr('stroke-width', 4).attr('stroke-linejoin', 'round');
  const yw = (y) => `year=${y}`;
  const measure = (svg, str, size = 'var(--cds-font-size-body)') => {
    const t = svg.append('text').style('font-size', size).text(str);
    const w = t.node().getComputedTextLength();
    t.remove();
    return w;
  };
  // Barre vers le bas (valeur négative), coins inférieurs arrondis.
  const downBar = (x, y, w, h, r = 3) => {
    if (h <= 0 || w <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w - rr}Q${x + w},${y + h} ${x + w},${y + h - rr}V${y}Z`;
  };
  // Axe du temps : mois (ou années) espacés selon la largeur disponible.
  const timeAxis = (svg, x, y0, minGap = 62) => {
    const [d0, d1] = x.domain();
    const [a, b] = x.range();
    const months = Math.max(1, (d1 - d0) / (30.44 * DAY));
    const per = (b - a) / months;
    const k = [1, 2, 3, 6, 12, 24].find((s) => per * s >= minGap) || 24;
    const ticks = k >= 12 ? x.ticks(d3.utcYear.every(k / 12)) : x.ticks(d3.utcMonth.every(k));
    ticks.forEach((t) => {
      const px = x(t);
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', y0).attr('y2', y0 + 4).style('stroke', SR.col.axis);
      SR.cap(svg.append('text').attr('x', px).attr('y', y0 + 17).attr('text-anchor', 'middle'))
        .text(t.getUTCMonth() === 0 ? String(t.getUTCFullYear()) : SR.mon(t));
    });
  };
  const tile = (label, value, unit, sub, cls) => {
    const t = SR.el('div', `sr-tile${cls ? ` ${cls}` : ''}`);
    const v = SR.el('p', 'sr-tile__value');
    v.append(value);
    if (unit) v.append(SR.el('span', 'sr-unit', unit));
    t.append(SR.el('p', 'sr-tile__label', label), v);
    if (sub && sub.length) {
      const s = SR.el('p', 'sr-tile__sub');
      s.append(...sub);
      t.append(s);
    }
    return t;
  };
  const tableState = (table, id) => {
    const res = dash.data(id);
    const tbody = table.tBodies[0];
    if (res.status === 'error') {
      const tr = document.createElement('tr');
      const td = SR.el('td');
      td.colSpan = table.tHead.rows[0].cells.length;
      td.append(SR.el('div', 'sr-failed', 'Failed to load'));
      tr.append(td);
      tbody.replaceChildren(tr);
      return null;
    }
    if (res.status !== 'ok' || !Array.isArray(res.data)) {
      if (!tbody.children.length) tbody.classList.add('dash-skeleton');
      return null;
    }
    tbody.classList.remove('dash-skeleton');
    return res.data;
  };
  const seg = (id, key, redraw) => {
    const group = $(`#${id}`);
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      ui[key] = b.dataset.v;
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      run(redraw);
    });
  };

  /* ---------- Zones cardio ---------- */
  const ZONE_NAMES = { 1: 'Endurance', 2: 'Modéré', 3: 'Tempo', 4: 'Seuil', 5: 'Anaérobie' };
  // Spectre d’effort : du plus facile (cyan) au plus dur (rouge), zones voisines distinctes même pour un daltonien.
  const zoneColor = (z) => `var(--sr-z${z})`;
  const zoneRange = (z) => (z.max_bpm == null ? `${z.min_bpm}+` : z.min_bpm <= 0 ? `<${z.max_bpm + 1}` : `${z.min_bpm}–${z.max_bpm}`);
  const zoneName = (k) => `Z${k} ${ZONE_NAMES[k]}`;

  // Barres empilées à 100 %, une ligne par élément (année, tranche…), segments par zone.
  function zoneStack(box, items, cfg) {
    if (!items.length) {
      box.replaceChildren();
      return;
    }
    const W = SR.width(box);
    const rowH = 26;
    const gapY = 14;
    const H = items.length * (rowH + gapY) - gapY + 4;
    box.style.setProperty('--h', `${H}px`);
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', cfg.aria);
    const tip = SR.tip(box);
    const lw = (d3.max(items, (it) => measure(svg, it.label)) || 0) + 12;
    const showRight = W >= 460;
    const rw = showRight ? (d3.max(items, (it) => measure(svg, it.right, 'var(--cds-font-size-caption)')) || 0) + 14 : 0;
    const x = d3.scaleLinear([0, 1], [lw, W - rw]);
    const segs = [];
    items.forEach((it, i) => {
      const y0 = 2 + i * (rowH + gapY);
      svg.append('text').attr('x', 0).attr('y', y0 + rowH / 2).attr('dy', '0.32em')
        .style('font-size', 'var(--cds-font-size-body)').style('fill', 'var(--color-fg)').text(it.label);
      let acc = 0;
      it.segs.forEach((s) => {
        segs.push({ ...s, x0: acc, x1: acc + s.share, y0, item: it });
        acc += s.share;
      });
      if (showRight) SR.cap(svg.append('text').attr('x', W).attr('y', y0 + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end')).text(it.right);
    });
    const shown = segs.filter((s) => s.x1 - s.x0 > 0.0005);
    const segW = (s) => Math.max(0, x(s.x1) - x(s.x0) - (s.x0 > 0.0005 ? 1 : 0) - (s.x1 < 0.9995 ? 1 : 0));
    const rects = svg.append('g').selectAll('rect').data(shown).join('rect')
      .attr('x', (s) => x(s.x0) + (s.x0 > 0.0005 ? 1 : 0)).attr('y', (s) => s.y0).attr('width', segW).attr('height', rowH)
      .attr('rx', 4).style('fill', (s) => zoneColor(s.zone));
    const inks = {};
    [1, 2, 3, 4, 5].forEach((k) => {
      inks[k] = SR.inkOn(SR.rgb(zoneColor(k)));
    });
    svg.append('g').selectAll('text').data(shown.filter((s) => segW(s) >= 34)).join('text')
      .attr('x', (s) => x(s.x0) + (x(s.x1) - x(s.x0)) / 2).attr('y', (s) => s.y0 + rowH / 2).attr('dy', '0.32em')
      .attr('text-anchor', 'middle').style('font-size', 'var(--cds-font-size-caption)').style('pointer-events', 'none')
      .style('fill', (s) => inks[s.zone]).text((s) => SR.pct(s.share));
    SR.hover(rects, box, tip, cfg.tip,
      (e, s) => rects.attr('opacity', (o) => (o.zone === s.zone ? 1 : 0.45)), () => rects.attr('opacity', 1));
  }

  /* ================= Cardio ================= */
  function drawCardioLead() {
    const box = $('#cardio-lead');
    const d = SR.ready(box, ['zones_by_year', 'load_now']);
    if (!d || !d[0].length || !d[1].length) return;
    const [zy, [l]] = d;
    const cur = d3.max(zy, (r) => r.year);
    const now = zy.find((r) => r.year === cur);
    const prev = zy.find((r) => r.year === cur - 1);
    const parts = [txt(`En ${cur}, `), hl(mk(SR.pct(now.easy_share), 'zones_by_year', 'easy_share', yw(cur))),
      txt(' de mon temps de course s’est passé dans les zones 1 et 2, les plus faciles')];
    if (prev) parts.push(txt(' (contre '), mk(SR.pct(prev.easy_share), 'zones_by_year', 'easy_share', yw(prev.year)), txt(` en ${prev.year})`));
    parts.push(
      txt('. Ma forme est à '), hl(mk(SR.n0(l.fitness), 'load_now', 'fitness', null, 0)),
      txt(' ('), mk(SR.sn0(l.fitness_delta), 'load_now', 'fitness_delta', null, 0), txt(' en 4 semaines), pour un pic à '),
      mk(SR.n0(l.peak_fitness), 'load_now', 'peak_fitness', null, 0), txt(' le '), mk(SR.dmed(l.peak_date), 'load_now', 'peak_date', null, 0), txt('.'),
    );
    box.replaceChildren(...parts);
    enter(box);
  }

  function drawCardioTiles() {
    const box = $('#cardio-tiles');
    const d = SR.ready(box, ['zones_by_year', 'load_now']);
    if (!d || !d[0].length || !d[1].length) return;
    const [zy, [l]] = d;
    const cur = d3.max(zy, (r) => r.year);
    const now = zy.find((r) => r.year === cur);
    const prev = zy.find((r) => r.year === cur - 1);
    const vs = (field, fmt, unit = '') => (prev ? [txt(`${prev.year} : `), mk(fmt(prev[field]), 'zones_by_year', field, yw(prev.year)), txt(unit)] : []);
    const state = l.form >= 5 ? 'frais' : l.form >= -10 ? 'équilibré' : l.form >= -30 ? 'en pleine charge' : 'surchargé';
    box.replaceChildren(
      tile(`Zones 1–2 en ${cur}`, mk(SR.pct(now.easy_share), 'zones_by_year', 'easy_share', yw(cur)), null, vs('easy_share', SR.pct)),
      tile(`Zones 4–5 en ${cur}`, mk(SR.pct(now.hard_share), 'zones_by_year', 'hard_share', yw(cur)), null, vs('hard_share', SR.pct)),
      tile(`FC moyenne en ${cur}`, mk(SR.n0(now.hr_avg), 'zones_by_year', 'hr_avg', yw(cur)), 'bpm', vs('hr_avg', SR.n0, ' bpm')),
      tile(`Heures avec cardio en ${cur}`, mk(SR.n0(now.hours), 'zones_by_year', 'hours', yw(cur)), 'h',
        [mk(SR.n0(now.runs), 'zones_by_year', 'runs', yw(cur)), txt(' sorties')]),
      tile('Forme', mk(SR.n0(l.fitness), 'load_now', 'fitness', null, 0), null,
        [mk(SR.sn0(l.fitness_delta), 'load_now', 'fitness_delta', null, 0), txt(' en 4 semaines')]),
      tile('Fraîcheur', mk(SR.sn0(l.form), 'load_now', 'form', null, 0), null,
        [txt(`${state} · fatigue `), mk(SR.n0(l.fatigue), 'load_now', 'fatigue', null, 0)]),
    );
    enter(box);
  }

  function drawZoneYears() {
    const box = $('#c-zoneyears');
    const d = SR.ready(box, ['zones_by_year', 'hr_zones']);
    if (!d || !d[0].length || !d[1].length) return;
    const [years, zones] = d;
    const zs = [...zones].sort((a, b) => a.zone - b.zone);
    $('#zone-legend').replaceChildren(...zs.map((z) => legendItem(zoneColor(z.zone), `${zoneName(z.zone)} · ${zoneRange(z)}`)));
    const shown = years.filter((r) => r.runs >= 20).sort((a, b) => b.year - a.year);
    zoneStack(box, shown.map((r) => ({
      label: String(r.year),
      right: `${SR.n0(r.hours)} h · ${SR.n0(r.hr_avg)} bpm`,
      segs: zs.map((z) => ({ zone: z.zone, z, share: r[`z${z.zone}_h`] / r.hours, hours: r[`z${z.zone}_h`], row: r })),
    })), {
      aria: 'Part du temps passé dans chaque zone cardio, par année',
      tip: (s) => ({
        head: `${s.row.year} · ${zoneName(s.zone)} (${zoneRange(s.z)} bpm)`,
        rows: [
          { color: zoneColor(s.zone), label: 'Part du temps', value: SR.pct(s.share) },
          { label: 'Temps dans la zone', value: SR.hm(s.hours * 3600) },
          { label: 'FC moyenne de l’année', value: `${SR.n0(s.row.hr_avg)} bpm` },
        ],
      }),
    });
    enter(box);
  }

  function drawLoad() {
    const box = $('#c-load');
    const d = SR.ready(box, ['load', 'race_results']);
    if (!d || !d[0].length) return;
    const [all, races] = d;
    const n = ui.loadRange === 'all' ? all.length : Math.min(all.length, Number(ui.loadRange));
    const days = all.slice(all.length - n).map((r) => ({ ...r, t: SR.utc(r.date) }));
    const W = SR.width(box);
    const H = 380;
    const m = { t: 24, r: 14, b: 28, l: 40 };
    const gap = 34;
    const h1 = Math.round((H - m.t - m.b - gap) * 0.64);
    const top2 = m.t + h1 + gap;
    const bot2 = H - m.b;
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Forme, fatigue et fraîcheur jour par jour');
    const tip = SR.tip(box);
    const x = d3.scaleUtc([days[0].t, days[days.length - 1].t], [m.l, W - m.r]);
    const y1 = d3.scaleLinear([0, (d3.max(days, (r) => Math.max(r.fitness, r.fatigue)) || 1) * 1.06], [m.t + h1, m.t]).nice();
    const fMax = Math.max(10, d3.max(days, (r) => Math.abs(r.form)) || 10);
    const y2 = d3.scaleLinear([-fMax, fMax], [bot2, top2]).nice();
    SR.gridY(svg, y1, m.l, W - m.r, y1.ticks(4), SR.n0);
    const [f0, f1] = y2.domain();
    SR.gridY(svg, y2, m.l, W - m.r, [f0, 0, f1], SR.sn0);
    SR.cap(svg.append('text').attr('x', m.l + 2).attr('y', top2 - 10)).text('Fraîcheur : au-dessus de zéro, plus frais que fatigué');
    timeAxis(svg, x, bot2);
    const X = (r) => x(r.t);
    const grad = svg.append('defs').append('linearGradient').attr('id', 'sr-grad-load')
      .attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    [[0, 0.26], [0.25, 0.16], [0.5, 0.08], [0.75, 0.03], [1, 0]].forEach(([o, a]) => {
      grad.append('stop').attr('offset', o).style('stop-color', SR.col.orange).style('stop-opacity', a);
    });
    svg.append('path').datum(days).style('fill', 'url(#sr-grad-load)').attr('d', d3.area().x(X).y0(y1(0)).y1((r) => y1(r.fitness)));
    svg.append('path').datum(days).style('fill', 'none').style('stroke', SR.col.blue).attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round').attr('d', d3.line().x(X).y((r) => y1(r.fatigue)));
    svg.append('path').datum(days).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('d', d3.line().x(X).y((r) => y1(r.fitness)));
    svg.append('path').datum(days).style('fill', SR.col.aqua).attr('fill-opacity', 0.3)
      .attr('d', d3.area().x(X).y0(y2(0)).y1((r) => y2(r.form)));
    svg.append('path').datum(days).style('fill', 'none').style('stroke', SR.col.aqua).attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round').attr('d', d3.line().x(X).y((r) => y2(r.form)));
    const shown = races.filter((r) => r.date >= days[0].date && r.date <= days[days.length - 1].date);
    svg.append('g').selectAll('path').data(shown).join('path')
      .attr('transform', (r) => `translate(${x(SR.utc(r.date))},${m.t - 13})`).attr('d', d3.symbol(d3.symbolDiamond, 42))
      .style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 1.5).style('pointer-events', 'none');
    const rule = svg.append('line').attr('y1', m.t - 4).attr('y2', bot2).style('stroke', SR.col.ref).attr('opacity', 0);
    const dots = svg.append('g');
    const byDate = d3.group(shown, (r) => r.date);
    const near = d3.bisector((r) => r.t).center;
    const hide = () => {
      rule.attr('opacity', 0);
      dots.selectAll('*').remove();
      tip.hide();
    };
    svg.append('rect').attr('x', m.l).attr('y', m.t - 22).attr('width', W - m.l - m.r).attr('height', bot2 - m.t + 22)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const r = days[Math.max(0, Math.min(days.length - 1, near(days, x.invert(mx))))];
        const px = X(r);
        rule.attr('x1', px).attr('x2', px).attr('opacity', 1);
        dots.selectAll('circle').data([[y1(r.fitness), SR.col.orange], [y1(r.fatigue), SR.col.blue], [y2(r.form), SR.col.aqua]])
          .join('circle').attr('cx', px).attr('cy', (p) => p[0]).attr('r', 4)
          .style('fill', (p) => p[1]).style('stroke', SR.col.panel).attr('stroke-width', 2);
        const race = byDate.get(r.date);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dday(r.date),
          title: race ? race.map((o) => `${o.event} · ${SR.dur(o.time_s)}`).join(' / ') : null,
          rows: [
            { color: SR.col.orange, line: true, label: 'Forme', value: SR.n0(r.fitness) },
            { color: SR.col.blue, line: true, label: 'Fatigue', value: SR.n0(r.fatigue) },
            { color: SR.col.aqua, label: 'Fraîcheur', value: SR.sn0(r.form) },
            { label: 'Effort relatif du jour', value: r.load > 0 ? SR.n0(r.load) : 'repos' },
          ],
        }));
      })
      .on('pointerleave', hide);
    enter(box);
  }

  function drawZoneMonths() {
    const box = $('#c-zonemonths');
    const d = SR.ready(box, ['zones_by_month']);
    if (!d || !d[0].length) return;
    const months = d[0];
    const share = ui.zoneMonthsBy === 'share';
    const W = SR.width(box);
    const H = 260;
    const m = { t: 14, r: 6, b: 30, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Temps de course par zone cardio, mois par mois');
    const tip = SR.tip(box);
    const step = (W - m.l - m.r) / months.length;
    const xL = (i) => m.l + i * step;
    const bw = Math.max(1, Math.min(26, step - (step >= 8 ? 3 : 1)));
    const val = (r, k) => (share ? (r.hours > 0 ? r[`z${k}_h`] / r.hours : 0) : r[`z${k}_h`]);
    const y = d3.scaleLinear([0, share ? 1 : (d3.max(months, (r) => r.hours) || 1) * 1.05], [H - m.b, m.t]);
    if (!share) y.nice();
    SR.gridY(svg, y, m.l, W - m.r, share ? [0, 0.25, 0.5, 0.75, 1] : y.ticks(4), share ? SR.pct : (t) => `${SR.n0(t)} h`);
    const segs = [];
    months.forEach((r, i) => {
      let acc = 0;
      const parts = [1, 2, 3, 4, 5].map((k) => ({ k, v: val(r, k) })).filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        segs.push({ i, k: p.k, y0: acc, y1: acc + p.v, top: j === parts.length - 1 });
        acc += p.v;
      });
    });
    const bars = svg.append('g').selectAll('path').data(segs).join('path')
      .attr('d', (s) => {
        const x0 = xL(s.i) + (step - bw) / 2;
        const yt = y(s.y1);
        const h = Math.max(0, y(s.y0) - y(s.y1) - (s.y0 > 0 && step >= 6 ? 1 : 0));
        return s.top ? SR.barPath(x0, yt, bw, h, Math.min(3, bw / 2)) : `M${x0},${yt}h${bw}v${h}h${-bw}Z`;
      })
      .style('fill', (s) => zoneColor(s.k));
    const every = step >= 30 ? 1 : step >= 15 ? 3 : step >= 8 ? 6 : 12;
    let last = -Infinity;
    months.forEach((r, i) => {
      const mo = Number(r.month.slice(5, 7));
      if (mo !== 1 && (mo - 1) % every !== 0) return;
      const px = xL(i) + step / 2;
      if (px - last < 36) return;
      last = px;
      SR.cap(svg.append('text').attr('x', px).attr('y', H - m.b + 17).attr('text-anchor', 'middle'))
        .text(mo === 1 ? r.month.slice(0, 4) : SR.mon(SR.utc(`${r.month}-01`)));
    });
    const band = svg.insert('rect', ':first-child').attr('y', m.t).attr('height', H - m.t - m.b)
      .style('fill', 'var(--color-fg)').attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const i = Math.max(0, Math.min(months.length - 1, Math.floor((mx - m.l) / step)));
        const r = months[i];
        band.attr('x', xL(i)).attr('width', step).attr('opacity', 0.05);
        bars.attr('opacity', (s) => (s.i === i ? 1 : 0.55));
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmonth(r.month),
          rows: r.hours > 0
            ? [5, 4, 3, 2, 1].filter((k) => r[`z${k}_h`] > 0).map((k) => ({
              color: zoneColor(k), label: zoneName(k), value: share ? SR.pct(r[`z${k}_h`] / r.hours) : SR.hm(r[`z${k}_h`] * 3600),
            })).concat([{ label: `${SR.n0(r.runs)} sortie${r.runs > 1 ? 's' : ''}`, value: SR.hm(r.hours * 3600) }])
            : [{ label: 'Aucune sortie avec cardio', value: '' }],
        }));
      })
      .on('pointerleave', () => {
        band.attr('opacity', 0);
        bars.attr('opacity', 1);
        tip.hide();
      });
    enter(box);
  }

  function drawZoneBands() {
    const box = $('#c-zonebands');
    const d = SR.ready(box, ['zones_by_band']);
    if (!d || !d[0].length) return;
    const bands = [...d[0]].sort((a, b) => a.band_i - b.band_i);
    zoneStack(box, bands.map((r) => ({
      label: r.band,
      right: `${SR.n0(r.hr_avg)} bpm`,
      segs: [1, 2, 3, 4, 5].map((k) => ({ zone: k, share: r[`z${k}`] || 0, row: r })),
    })), {
      aria: 'Part du temps dans chaque zone cardio selon la distance de la sortie',
      tip: (s) => ({
        head: `${s.row.band} · ${zoneName(s.zone)}`,
        rows: [
          { color: zoneColor(s.zone), label: 'Part du temps', value: SR.pct(s.share) },
          { label: 'FC moyenne', value: `${SR.n0(s.row.hr_avg)} bpm` },
          { label: 'Sorties avec cardio', value: SR.n0(s.row.runs) },
        ],
      }),
    });
    enter(box);
  }

  function drawLoadWeeks() {
    const box = $('#c-loadweeks');
    const d = SR.ready(box, ['load_weeks']);
    if (!d || !d[0].length) return;
    const weeks = d[0].slice(-26);
    const W = SR.width(box);
    const H = 250;
    const m = { t: 16, r: 6, b: 28, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Effort relatif par semaine');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.week), [m.l, W - m.r]).paddingInner(0.28).paddingOuter(0.1);
    const y = d3.scaleLinear([0, (d3.max(weeks, (w) => w.load) || 1) * 1.08], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    const bw = Math.min(26, x.bandwidth());
    const cx = (w) => x(w.week) + x.bandwidth() / 2;
    const runBars = svg.append('g').selectAll('path').data(weeks).join('path')
      .attr('d', (w) => {
        const h = y(0) - y(w.run_load);
        return w.other_load > 0 ? `M${cx(w) - bw / 2},${y(w.run_load)}h${bw}v${h}h${-bw}Z` : SR.barPath(cx(w) - bw / 2, y(w.run_load), bw, h, 4);
      })
      .style('fill', SR.col.blue);
    const otherBars = svg.append('g').selectAll('path').data(weeks.filter((w) => w.other_load > 0)).join('path')
      .attr('d', (w) => SR.barPath(cx(w) - bw / 2, y(w.load), bw, Math.max(0, y(w.run_load) - y(w.load) - 1), 4))
      .style('fill', SR.col.muted);
    let lastM = '';
    let lastX = -Infinity;
    weeks.forEach((w) => {
      const mo = w.week.slice(0, 7);
      if (mo === lastM) return;
      lastM = mo;
      const px = x(w.week);
      if (px - lastX < 40) return;
      lastX = px;
      const dt = SR.utc(w.week);
      SR.cap(svg.append('text').attr('x', px).attr('y', H - m.b + 17).attr('text-anchor', 'start'))
        .text(dt.getUTCMonth() === 0 ? String(dt.getUTCFullYear()) : SR.mon(dt));
    });
    const hits = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.week) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step())
      .attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hits, box, tip, (w) => ({
      head: `Semaine du ${SR.dmed(w.week)}`,
      rows: [
        { color: SR.col.blue, label: 'Course', value: SR.n0(w.run_load) },
        { color: SR.col.muted, label: 'Autres sports', value: SR.n0(w.other_load) },
        { label: 'Total', value: SR.n0(w.load) },
      ],
    }), (e, w) => {
      runBars.attr('opacity', (o) => (o === w ? 1 : 0.45));
      otherBars.attr('opacity', (o) => (o === w ? 1 : 0.45));
    }, () => {
      runBars.attr('opacity', 1);
      otherBars.attr('opacity', 1);
    });
    enter(box);
  }

  /* ================= Analyses croisées ================= */
  function drawCroiseLead() {
    const box = $('#croise-lead');
    const d = SR.ready(box, ['hr_pace_focus', 'efficiency_years']);
    if (!d) return;
    const [[f], ey] = d;
    const parts = [];
    if (f && f.from_year !== f.to_year) {
      parts.push(
        txt('À '), mk(SR.pace(f.pace_lo), 'hr_pace_focus', 'pace_lo', null, 0), txt('–'), mk(SR.pace(f.pace_hi), 'hr_pace_focus', 'pace_hi', null, 0),
        txt('/km sur le plat, mon cœur bat en moyenne à '), hl(mk(SR.n0(f.to_hr), 'hr_pace_focus', 'to_hr', null, 0)),
        txt(` bpm en ${f.to_year}, contre `), mk(SR.n0(f.from_hr), 'hr_pace_focus', 'from_hr', null, 0),
        txt(` en ${f.from_year} (`), hl(mk(SR.sn0(f.delta_bpm), 'hr_pace_focus', 'delta_bpm', null, 0)), txt(' bpm). '),
      );
    }
    if (ey.length > 1) {
      const last = ey[ey.length - 1];
      const first = ey[0];
      parts.push(
        txt('Sur mes sorties faciles, chaque battement me fait avancer de '), hl(mk(SR.n2(last.m_per_beat), 'efficiency_years', 'm_per_beat', yw(last.year))),
        txt(` m en ${last.year}, contre `), mk(SR.n2(first.m_per_beat), 'efficiency_years', 'm_per_beat', yw(first.year)),
        txt(` en ${first.year} (`), mk(SR.spct(last.vs_first), 'efficiency_years', 'vs_first', yw(last.year)), txt(').'),
      );
    }
    box.replaceChildren(...parts);
    enter(box);
  }

  function drawHrPace() {
    const box = $('#c-hrpace');
    const d = SR.ready(box, ['hr_pace', 'hr_zones']);
    if (!d || !d[0].length) return;
    const [cells, zones] = d;
    const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
    const cur = d3.max(years);
    const colorOf = (yr) => (SR.yearRank(yr, cur) ? SR.yearColor(yr, cur) : SR.col.muted);
    $('#hrpace-legend').replaceChildren(...[...years].reverse().map((yr) => legendItem(colorOf(yr), String(yr), 'line')));
    const W = SR.width(box);
    const H = 340;
    const m = { t: 14, r: 34, b: 36, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'FC moyenne selon l’allure, par année');
    const tip = SR.tip(box);
    const lo = d3.min(cells, (c) => c.pace_lo);
    const hi = d3.max(cells, (c) => c.pace_hi);
    const x = d3.scaleLinear([hi, lo], [m.l, W - m.r]);
    const ext = d3.extent(cells, (c) => c.hr);
    const y = d3.scaleLinear([Math.floor((ext[0] - 3) / 5) * 5, Math.ceil((ext[1] + 3) / 5) * 5], [H - m.b, m.t]);
    const [b0, b1] = y.domain();
    [...zones].sort((a, b) => a.zone - b.zone).forEach((z) => {
      const top = Math.min(b1, z.max_bpm == null ? b1 : z.max_bpm + 0.5);
      const bot = Math.max(b0, z.min_bpm - 0.5);
      if (top <= bot) return;
      if (z.zone % 2 === 1) {
        svg.append('rect').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', y(top)).attr('height', y(bot) - y(top))
          .style('fill', 'var(--color-fg)').attr('fill-opacity', 0.035);
      }
      if (y(bot) - y(top) >= 14) SR.cap(svg.append('text').attr('x', W - m.r + 6).attr('y', (y(top) + y(bot)) / 2).attr('dy', '0.32em')).text(`Z${z.zone}`);
    });
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.n0, { noBase: true });
    SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', m.t - 2).attr('text-anchor', 'end')).text('bpm');
    const tickStep = (hi - lo) / (W < 480 ? 4 : 8) > 30 ? 60 : 30;
    d3.range(Math.ceil(lo / tickStep) * tickStep, hi + 1, tickStep).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.grid).attr('shape-rendering', 'crispEdges');
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(SR.pace(t));
    });
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end')).text('allure (min/km), plus rapide →');
    const mid = (c) => (c.pace_lo + c.pace_hi) / 2;
    const byYear = d3.group(cells, (c) => c.year);
    const order = [...years].sort((a, b) => SR.yearRank(a, cur) - SR.yearRank(b, cur));
    order.forEach((yr) => {
      const pts = [...byYear.get(yr)].sort((a, b) => b.pace_lo - a.pace_lo);
      const rank = SR.yearRank(yr, cur);
      svg.append('path').datum(pts).style('fill', 'none').style('stroke', colorOf(yr))
        .attr('stroke-width', rank === 3 ? 2.5 : rank ? 2 : 1.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
        .attr('d', d3.line().x((c) => x(mid(c))).y((c) => y(c.hr)));
      svg.append('g').selectAll('circle').data(pts).join('circle')
        .attr('cx', (c) => x(mid(c))).attr('cy', (c) => y(c.hr)).attr('r', rank ? 3.5 : 2.5)
        .style('fill', colorOf(yr)).style('stroke', SR.col.panel).attr('stroke-width', 1.5);
    });
    const bins = [...new Set(cells.map((c) => c.pace_lo))].sort((a, b) => b - a);
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const p = x.invert(mx);
        const b = bins[d3.minIndex(bins, (v) => Math.abs(v + 7.5 - p))];
        rule.attr('x1', x(b + 7.5)).attr('x2', x(b + 7.5)).attr('opacity', 1);
        const rowsAt = [...years].reverse().map((yr) => cells.find((c) => c.year === yr && c.pace_lo === b)).filter(Boolean);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: `Allure ${SR.pace(b)} à ${SR.pace(b + 15)}/km, sur le plat`,
          rows: rowsAt.map((c) => ({ color: colorOf(c.year), line: true, label: `${c.year} (${SR.n0(c.points)} points)`, value: `${SR.n0(c.hr)} bpm` })),
        }));
      })
      .on('pointerleave', () => {
        rule.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawHrScatter() {
    const box = $('#c-hrscatter');
    const d = SR.ready(box, ['hr_runs', 'race_results', 'hr_pace_fit']);
    if (!d) return;
    const [hrRuns, races, fits] = d;
    const pts = hrRuns.filter((r) => r.km >= 3 && r.sport !== 'VirtualRun' && r.pace_s > 0);
    if (!pts.length) return;
    const years = [...new Set(pts.map((r) => r.year))].sort((a, b) => b - a);
    const cur = years[0];
    if (ui.hlYear == null || !years.includes(ui.hlYear)) ui.hlYear = cur;
    const hy0 = ui.hlYear;
    const hlColor = SR.yearRank(hy0, cur) ? SR.yearColor(hy0, cur) : 'var(--color-fg)';
    const chips = $('#hrscatter-years');
    chips.replaceChildren(...years.map((v) => {
      const b = SR.el('button', 'sr-chip', String(v));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === hy0));
      b.addEventListener('click', () => {
        ui.hlYear = v;
        run(drawHrScatter);
      });
      return b;
    }));
    const raceIds = new Set(races.map((r) => r.id));
    const paces = pts.map((r) => r.pace_s).sort(d3.ascending);
    const pLo = Math.floor((d3.quantileSorted(paces, 0.005) - 5) / 30) * 30;
    const pHi = Math.ceil((d3.quantileSorted(paces, 0.995) + 5) / 30) * 30;
    const hrs = pts.map((r) => r.hr_avg).sort(d3.ascending);
    const hLo = Math.floor((d3.quantileSorted(hrs, 0.005) - 2) / 5) * 5;
    const hHi = Math.ceil((hrs[hrs.length - 1] + 2) / 5) * 5;
    const W = SR.width(box);
    const H = 360;
    const m = { t: 12, r: 14, b: 36, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Allure moyenne et FC moyenne de chaque sortie');
    const tip = SR.tip(box);
    const x = d3.scaleLinear([pHi, pLo], [m.l, W - m.r]);
    const y = d3.scaleLinear([hLo, hHi], [H - m.b, m.t]);
    const cx = (r) => x(Math.max(pLo, Math.min(pHi, r.pace_s)));
    const cy = (r) => y(Math.max(hLo, Math.min(hHi, r.hr_avg)));
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.n0, { noBase: true });
    SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', m.t - 2).attr('text-anchor', 'end')).text('bpm');
    const tickStep = (pHi - pLo) / (W < 480 ? 4 : 7) > 30 ? 60 : 30;
    d3.range(Math.ceil(pLo / tickStep) * tickStep, pHi + 1, tickStep).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.grid).attr('shape-rendering', 'crispEdges');
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(SR.pace(t));
    });
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end')).text('allure moyenne, plus rapide →');
    const sorted = [...pts].sort((a, b) => Number(a.year === hy0) - Number(b.year === hy0));
    svg.append('g').selectAll('circle').data(sorted).join('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', (r) => (raceIds.has(r.id) ? 5 : r.year === hy0 ? 3.6 : 3))
      .style('fill', (r) => (r.year === hy0 ? hlColor : SR.col.muted))
      .attr('fill-opacity', (r) => (r.year === hy0 ? 0.85 : 0.35))
      .style('stroke', (r) => (raceIds.has(r.id) && r.year === hy0 ? 'var(--color-fg)' : 'none')).attr('stroke-width', 1.5);
    fits.forEach((f) => {
      const a = Math.max(pLo, f.pace_min);
      const b = Math.min(pHi, f.pace_max);
      if (b <= a) return;
      const on = f.year === hy0;
      svg.append('line').attr('x1', x(b)).attr('x2', x(a)).attr('y1', y(f.intercept + f.slope * b)).attr('y2', y(f.intercept + f.slope * a))
        .style('stroke', on ? hlColor : SR.col.muted).attr('stroke-width', on ? 2.5 : 1.5).attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', on ? null : '4 4').attr('opacity', on ? 1 : 0.8).style('pointer-events', 'none');
    });
    const fitHl = fits.find((f) => f.year === hy0);
    if (fitHl) {
      const xe = Math.max(pLo, fitHl.pace_min);
      const ly = y(fitHl.intercept + fitHl.slope * xe);
      halo(svg.append('text').attr('x', Math.min(W - m.r, x(xe))).attr('y', Math.max(m.t + 10, ly - 10)).attr('text-anchor', 'end')
        .style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)')
        .style('fill', 'var(--color-fg)').style('pointer-events', 'none')).text(`tendance ${hy0}`);
    }
    const delaunay = d3.Delaunay.from(sorted, cx, cy);
    const ring = svg.append('circle').attr('r', 8).style('fill', 'none').style('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const r = sorted[delaunay.find(mx, my)];
        if (!r || Math.hypot(cx(r) - mx, cy(r) - my) > 26) {
          ring.attr('opacity', 0);
          tip.hide();
          return;
        }
        ring.attr('cx', cx(r)).attr('cy', cy(r)).attr('opacity', 1);
        const race = races.find((o) => o.id === r.id);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: race ? `${race.event} · ${SR.dur(race.time_s)}` : r.name,
          rows: [
            { color: r.year === hy0 ? hlColor : SR.col.muted, label: 'FC moyenne', value: `${SR.n0(r.hr_avg)} bpm` },
            { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
            { label: 'Distance', value: `${SR.n1(r.km)} km` },
            { label: 'Dénivelé', value: `${SR.n0(r.elev_m)} m` },
          ],
        }));
      })
      .on('pointerleave', () => {
        ring.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawEff() {
    const box = $('#c-eff');
    const d = SR.ready(box, ['efficiency']);
    if (!d || !d[0].length) return;
    const months = d[0].map((r) => ({ ...r, t: new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)) - 1, 15)) }));
    const W = SR.width(box);
    const H = 250;
    const m = { t: 14, r: 12, b: 30, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Mètres parcourus par battement de cœur, mois par mois');
    const tip = SR.tip(box);
    const first = months[0].t;
    const lastT = months[months.length - 1].t;
    const x = d3.scaleUtc([new Date(first.getTime() - 20 * DAY), new Date(lastT.getTime() + 20 * DAY)], [m.l, W - m.r]);
    const ext = d3.extent(months, (r) => r.m_per_beat);
    const pad = Math.max(0.03, (ext[1] - ext[0]) * 0.15);
    const y = d3.scaleLinear([ext[0] - pad, ext[1] + pad], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n2, { noBase: true });
    SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', m.t - 2).attr('text-anchor', 'end')).text('m');
    timeAxis(svg, x, H - m.b);
    const runs = [];
    months.forEach((r, i) => {
      const prev = months[i - 1];
      const gap = prev ? (Number(r.month.slice(0, 4)) - Number(prev.month.slice(0, 4))) * 12 + Number(r.month.slice(5, 7)) - Number(prev.month.slice(5, 7)) : 1;
      if (!prev || gap > 1) runs.push([]);
      runs[runs.length - 1].push(r);
    });
    runs.forEach((seq) => {
      svg.append('path').datum(seq).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('d', d3.line().x((r) => x(r.t)).y((r) => y(r.m_per_beat)));
    });
    const dots = svg.append('g').selectAll('circle').data(months).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.m_per_beat)).attr('r', (r) => Math.min(6, 2.5 + Math.sqrt(r.runs) * 0.6))
      .style('fill', SR.col.orange).style('stroke', SR.col.panel).attr('stroke-width', 1.5);
    const xs = months.map((r) => x(r.t));
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const i = d3.minIndex(xs, (v) => Math.abs(v - mx));
        const r = months[i];
        rule.attr('x1', xs[i]).attr('x2', xs[i]).attr('opacity', 1);
        dots.attr('opacity', (o) => (o === r ? 1 : 0.5));
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmonth(r.month),
          rows: [
            { color: SR.col.orange, label: 'Mètres par battement', value: `${SR.n2(r.m_per_beat)} m` },
            { label: 'Allure médiane', value: `${SR.pace(r.pace_s)}/km` },
            { label: 'FC médiane', value: `${SR.n0(r.hr_avg)} bpm` },
            { label: 'Sorties faciles', value: SR.n0(r.runs) },
          ],
        }));
      })
      .on('pointerleave', () => {
        rule.attr('opacity', 0);
        dots.attr('opacity', 1);
        tip.hide();
      });
    enter(box);
  }

  function drawEffYears() {
    const box = $('#eff-years');
    const d = SR.ready(box, ['efficiency_years']);
    if (!d) return;
    box.replaceChildren(...d[0].map((r) => {
      const s = SR.el('span');
      const b = SR.el('b');
      b.append(mk(SR.n2(r.m_per_beat), 'efficiency_years', 'm_per_beat', yw(r.year)), txt(' m'));
      s.append(txt(`${r.year} : `), b);
      if (r.vs_prev != null) s.append(txt(' ('), mk(SR.spct(r.vs_prev), 'efficiency_years', 'vs_prev', yw(r.year)), txt(')'));
      return s;
    }));
  }

  function drawDrift() {
    const box = $('#c-drift');
    const d = SR.ready(box, ['drift_long']);
    if (!d || !d[0].length) return;
    const pts = d[0].map((r) => ({ ...r, t: SR.utc(r.date) }));
    const W = SR.width(box);
    const H = 250;
    const m = { t: 14, r: 14, b: 30, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Dérive cardiaque des sorties longues');
    const tip = SR.tip(box);
    const tExt = d3.extent(pts, (r) => r.t);
    const x = d3.scaleUtc([new Date(tExt[0].getTime() - 20 * DAY), new Date(tExt[1].getTime() + 20 * DAY)], [m.l, W - m.r]);
    const vals = pts.map((r) => r.drift).sort(d3.ascending);
    const lo = Math.min(-0.04, Math.floor(d3.quantileSorted(vals, 0.01) * 50) / 50);
    const hi = Math.max(0.1, Math.ceil(d3.quantileSorted(vals, 0.99) * 50) / 50);
    const y = d3.scaleLinear([lo, hi], [H - m.b, m.t]);
    const cy = (r) => y(Math.max(lo, Math.min(hi, r.drift)));
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.pct);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0.05)).attr('y2', y(0.05))
      .style('stroke', SR.col.ref).attr('stroke-width', 1.5).attr('stroke-dasharray', '5 4');
    halo(svg.append('text').attr('x', W - m.r).attr('y', y(0.05) - 6).attr('text-anchor', 'end')
      .style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg-muted)')).text('seuil de 5 %');
    timeAxis(svg, x, H - m.b);
    const color = (r) => (r.drift < 0.05 ? SR.col.blue : SR.col.orange);
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', cy).attr('r', (r) => Math.min(7, 3 + (r.moving_s / 3600 - 1) * 1.5))
      .style('fill', color).attr('fill-opacity', 0.8).style('stroke', SR.col.panel).attr('stroke-width', 1);
    const delaunay = d3.Delaunay.from(pts, (r) => x(r.t), cy);
    const ring = svg.append('circle').attr('r', 9).style('fill', 'none').style('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const r = pts[delaunay.find(mx, my)];
        if (!r || Math.hypot(x(r.t) - mx, cy(r) - my) > 26) {
          ring.attr('opacity', 0);
          tip.hide();
          return;
        }
        ring.attr('cx', x(r.t)).attr('cy', cy(r)).attr('opacity', 1);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: r.name,
          rows: [
            { color: color(r), label: 'Dérive cardiaque', value: SR.pct1(r.drift) },
            { label: 'Durée', value: SR.hm(r.moving_s) },
            { label: 'Distance', value: `${SR.n1(r.km)} km` },
            { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
            { label: 'FC moyenne', value: `${SR.n0(r.hr_avg)} bpm` },
          ],
        }));
      })
      .on('pointerleave', () => {
        ring.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawDriftYears() {
    const box = $('#drift-years');
    const d = SR.ready(box, ['drift_years']);
    if (!d) return;
    box.replaceChildren(...d[0].filter((r) => r.runs >= 3).map((r) => {
      const s = SR.el('span');
      const b = SR.el('b');
      b.append(mk(SR.pct(r.under5_share), 'drift_years', 'under5_share', yw(r.year)));
      s.append(txt(`${r.year} : `), b, txt(' sous 5 % (médiane '), mk(SR.pct1(r.drift_median), 'drift_years', 'drift_median', yw(r.year)),
        txt(', '), mk(SR.n0(r.runs), 'drift_years', 'runs', yw(r.year)), txt(' sorties)'));
      return s;
    }));
  }

  function drawGrade() {
    const box = $('#c-grade');
    const d = SR.ready(box, ['grade_effect']);
    if (!d || !d[0].length) return;
    const bins = d[0];
    const W = SR.width(box);
    const H = 290;
    const m = { t: 24, r: 8, b: 28, l: 48 };
    const gap = 40;
    const ph = (H - m.t - m.b - gap) / 2;
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Écart d’allure et de FC avec le plat selon la pente');
    const tip = SR.tip(box);
    const x = d3.scaleBand(bins.map((b) => b.grade_mid), [m.l, W - m.r]).paddingInner(0.3).paddingOuter(0.1);
    const bw = Math.min(32, x.bandwidth());
    const cx = (b) => x(b.grade_mid) + x.bandwidth() / 2;
    const all = [];
    const panel = (top, key, fmt, color, title) => {
      const lim = (d3.max(bins, (b) => Math.abs(b[key])) || 1) * 1.3;
      const y = d3.scaleLinear([-lim, lim], [top + ph, top]).nice();
      const [a, b] = y.domain();
      SR.gridY(svg, y, m.l, W - m.r, [a, 0, b], fmt);
      SR.cap(svg.append('text').attr('x', m.l).attr('y', top - 10)).text(title);
      const bars = svg.append('g').selectAll('path').data(bins).join('path')
        .attr('d', (bn) => {
          const v = bn[key];
          return v >= 0 ? SR.barPath(cx(bn) - bw / 2, y(v), bw, y(0) - y(v), 3) : downBar(cx(bn) - bw / 2, y(0), bw, y(v) - y(0), 3);
        })
        .style('fill', color);
      all.push(bars);
      if (x.bandwidth() >= 30) {
        svg.append('g').selectAll('text').data(bins).join('text')
          .attr('x', cx).attr('y', (bn) => (bn[key] >= 0 ? y(bn[key]) - 5 : y(bn[key]) + 13)).attr('text-anchor', 'middle')
          .style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg)').style('pointer-events', 'none')
          .text((bn) => fmt(bn[key]));
      }
    };
    panel(m.t, 'pace_change', SR.spct, SR.col.blue, 'Allure : + plus lent, − plus rapide qu’à plat');
    panel(m.t + ph + gap, 'hr_change', SR.sn0, SR.col.orange, 'FC : écart en bpm');
    SR.cap(svg.append('g').selectAll('text').data(bins).join('text')
      .attr('x', cx).attr('y', H - m.b + 18).attr('text-anchor', 'middle')).text((bn) => `${SR.sn0(bn.grade_mid)} %`);
    const hits = svg.append('g').selectAll('rect').data(bins).join('rect')
      .attr('x', (bn) => x(bn.grade_mid) - (x.step() - x.bandwidth()) / 2).attr('y', m.t - 4).attr('width', x.step())
      .attr('height', H - m.t - m.b + 4).style('fill', 'transparent');
    SR.hover(hits, box, tip, (bn) => ({
      head: `Pente de ${SR.sn0(bn.grade_lo)} à ${SR.sn0(bn.grade_hi)} %`,
      rows: [
        { color: SR.col.blue, label: 'Allure', value: `${SR.spct(bn.pace_change)} (≈ ${SR.pace(bn.pace_s)}/km)` },
        { color: SR.col.orange, label: 'FC', value: `${SR.sn0(bn.hr_change)} bpm (≈ ${SR.n0(bn.hr)})` },
        { label: 'Points mesurés', value: SR.n0(bn.points) },
      ],
    }), (e, bn) => all.forEach((bars) => bars.attr('opacity', (o) => (o === bn ? 1 : 0.45))),
    () => all.forEach((bars) => bars.attr('opacity', 1)));
    enter(box);
  }

  function drawCadPace() {
    const box = $('#c-cadpace');
    const d = SR.ready(box, ['runs', 'cadence_fit']);
    if (!d || !d[1].length) return;
    const [runs, [fit]] = d;
    const pts = runs.filter((r) => r.spm && r.km >= 3 && r.sport !== 'VirtualRun');
    if (!pts.length) return;
    const cur = d3.max(pts, (r) => r.year);
    const paces = pts.map((r) => r.pace_s).sort(d3.ascending);
    const pLo = Math.floor((d3.quantileSorted(paces, 0.005) - 5) / 30) * 30;
    const pHi = Math.ceil((d3.quantileSorted(paces, 0.995) + 5) / 30) * 30;
    const spms = pts.map((r) => r.spm).sort(d3.ascending);
    const sLo = Math.floor((d3.quantileSorted(spms, 0.005) - 2) / 5) * 5;
    const sHi = Math.ceil((spms[spms.length - 1] + 2) / 5) * 5;
    const W = SR.width(box);
    const H = 270;
    const m = { t: 12, r: 12, b: 36, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Cadence selon l’allure de chaque sortie');
    const tip = SR.tip(box);
    const x = d3.scaleLinear([pHi, pLo], [m.l, W - m.r]);
    const y = d3.scaleLinear([sLo, sHi], [H - m.b, m.t]);
    const cx = (r) => x(Math.max(pLo, Math.min(pHi, r.pace_s)));
    const cy = (r) => y(Math.max(sLo, Math.min(sHi, r.spm)));
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.n0, { noBase: true });
    SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', m.t - 2).attr('text-anchor', 'end')).text('pas/min');
    const tickStep = (pHi - pLo) / (W < 420 ? 3 : 6) > 30 ? 60 : 30;
    d3.range(Math.ceil(pLo / tickStep) * tickStep, pHi + 1, tickStep).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.grid).attr('shape-rendering', 'crispEdges');
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(SR.pace(t));
    });
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end')).text('plus rapide →');
    const colorOf = (r) => (SR.yearRank(r.year, cur) ? SR.yearColor(r.year, cur) : SR.col.muted);
    const sorted = [...pts].sort((a, b) => a.year - b.year);
    svg.append('g').selectAll('circle').data(sorted).join('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', 3.2).style('fill', colorOf).attr('fill-opacity', 0.55);
    const a = Math.max(pLo, fit.pace_min);
    const b = Math.min(pHi, fit.pace_max);
    svg.append('line').attr('x1', x(b)).attr('x2', x(a)).attr('y1', y(fit.intercept + fit.slope * b)).attr('y2', y(fit.intercept + fit.slope * a))
      .style('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('stroke-linecap', 'round').style('pointer-events', 'none');
    const delaunay = d3.Delaunay.from(sorted, cx, cy);
    const ring = svg.append('circle').attr('r', 7).style('fill', 'none').style('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const r = sorted[delaunay.find(mx, my)];
        if (!r || Math.hypot(cx(r) - mx, cy(r) - my) > 24) {
          ring.attr('opacity', 0);
          tip.hide();
          return;
        }
        ring.attr('cx', cx(r)).attr('cy', cy(r)).attr('opacity', 1);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: r.name,
          rows: [
            { color: colorOf(r), label: 'Cadence', value: `${SR.n0(r.spm)} pas/min` },
            { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
            { label: 'Distance', value: `${SR.n1(r.km)} km` },
          ],
        }));
      })
      .on('pointerleave', () => {
        ring.attr('opacity', 0);
        tip.hide();
      });
    const sum = $('#cadpace-sum');
    const g = SR.el('span');
    const bb = SR.el('b');
    bb.append(mk(SR.n1(fit.per_10s), 'cadence_fit', 'per_10s', null, 0), txt(' pas/min'));
    g.append(bb, txt(' de plus pour 10 s/km plus vite'));
    const r2 = SR.el('span');
    r2.append(txt('R² '), mk(SR.n2(fit.r2), 'cadence_fit', 'r2', null, 0), txt(' · '), mk(SR.n0(fit.runs), 'cadence_fit', 'runs', null, 0), txt(' sorties'));
    const leg = SR.el('span', 'sr-legend');
    [cur - 1, cur].filter((yr) => pts.some((r) => r.year === yr)).forEach((yr) => leg.append(legendItem(SR.yearColor(yr, cur), String(yr), 'dot')));
    leg.append(legendItem('var(--color-fg)', 'tendance', 'line'));
    sum.replaceChildren(g, r2, leg);
    enter(box);
  }

  /* ================= Dénivelé ================= */
  function drawElevTiles() {
    const box = $('#elev-tiles');
    const d = SR.ready(box, ['totals', 'elev_by_year', 'elev_top']);
    if (!d || !d[0].length || !d[1].length || !d[2].length) return;
    const [[tot], years, top] = d;
    const cur = d3.max(years, (r) => r.year);
    const now = years.find((r) => r.year === cur);
    const best = top[0];
    box.replaceChildren(
      tile('D+ cumulé', mk(SR.n0(tot.elev_m), 'totals', 'elev_m', null, 0), 'm',
        [mk(SR.n1(tot.everests), 'totals', 'everests', null, 0), txt(' fois l’Everest')]),
      tile(`D+ en ${cur}`, mk(SR.n0(now.elev_m), 'elev_by_year', 'elev_m', yw(cur)), 'm',
        [mk(SR.n1(now.m_per_km), 'elev_by_year', 'm_per_km', yw(cur)), txt(' m par km · '), mk(SR.n0(now.m_per_run), 'elev_by_year', 'm_per_run', yw(cur)), txt(' m par sortie')]),
      tile(`Sorties vallonnées en ${cur}`, mk(SR.n0(now.hilly_runs), 'elev_by_year', 'hilly_runs', yw(cur)), null,
        [txt('au moins 10 m de D+ par km')]),
      tile('Plus gros D+ en une sortie', mk(SR.n0(best.elev_m), 'elev_top', 'elev_m', `id=${best.id}`), 'm',
        [txt(`${best.name} · ${SR.dmed(best.date)}`)]),
    );
    enter(box);
  }

  function drawElevYears() {
    const box = $('#c-elevyears');
    const d = SR.ready(box, ['elev_by_year']);
    if (!d || !d[0].length) return;
    const rows = d[0].filter((r) => r.elev_m > 0);
    if (!rows.length) return;
    const cur = d3.max(d[0], (r) => r.year);
    const W = SR.width(box);
    const H = 250;
    const m = { t: 26, r: 4, b: 44, l: 4 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Dénivelé positif par année');
    const tip = SR.tip(box);
    const x = d3.scaleBand(rows.map((r) => r.year), [m.l, W - m.r]).paddingInner(0.3).paddingOuter(0.12);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.elev_m) * 1.04], [H - m.b, m.t]);
    const bw = Math.min(40, x.bandwidth());
    const cx = (r) => x(r.year) + x.bandwidth() / 2;
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', SR.col.axis).attr('shape-rendering', 'crispEdges');
    const bars = svg.append('g').selectAll('path').data(rows).join('path')
      .attr('d', (r) => SR.barPath(cx(r) - bw / 2, y(r.elev_m), bw, y(0) - y(r.elev_m), 4))
      .style('fill', (r) => (r.year === cur ? SR.col.orange : SR.col.blue));
    svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cx).attr('y', (r) => y(r.elev_m) - 8).attr('text-anchor', 'middle')
      .style('font-size', x.step() >= 60 ? 'var(--cds-font-size-body)' : 'var(--cds-font-size-caption)').style('font-variant-numeric', 'tabular-nums')
      .style('fill', 'var(--color-fg)').text((r) => SR.n0(r.elev_m));
    svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cx).attr('y', H - m.b + 19).attr('text-anchor', 'middle').style('font-size', 'var(--cds-font-size-body)')
      .style('font-weight', (r) => (r.year === cur ? 'var(--cds-font-weight-medium)' : null)).style('fill', 'var(--color-fg)').text((r) => String(r.year));
    if (x.step() >= 54) {
      SR.cap(svg.append('g').selectAll('text').data(rows).join('text')
        .attr('x', cx).attr('y', H - m.b + 36).attr('text-anchor', 'middle')).text((r) => `${SR.n1(r.m_per_km)} m/km`);
    }
    const hits = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.year)).attr('y', m.t - 20).attr('width', x.bandwidth()).attr('height', H - m.t + 16).style('fill', 'transparent');
    SR.hover(hits, box, tip, (r) => ({
      head: r.year === cur ? `${r.year} · en cours` : String(r.year),
      rows: [
        { label: 'D+ cumulé', value: `${SR.n0(r.elev_m)} m` },
        { label: 'D+ par km', value: `${SR.n1(r.m_per_km)} m` },
        { label: 'D+ par sortie', value: `${SR.n0(r.m_per_run)} m` },
        { label: 'Sorties vallonnées', value: SR.n0(r.hilly_runs) },
        { label: 'Plus gros D+', value: `${SR.n0(r.top_elev_m)} m` },
      ],
    }), (e, r) => bars.attr('opacity', (b) => (b.year === r.year ? 1 : 0.4)), () => bars.attr('opacity', 1));
    enter(box);
  }

  function drawTerrain() {
    const table = $('#t-terrain');
    const data = tableState(table, 'terrain');
    if (!data) return;
    const rows = [...data].sort((a, b) => a.profile_i - b.profile_i);
    const ramp = SR.ramp(rows.length);
    const maxKm = d3.max(rows, (r) => r.km) || 1;
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.profile;
      const key = SR.el('td', 'sr-l sr-key');
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = ramp[r.profile_i];
      sw.style.marginRight = '8px';
      key.append(sw, txt(r.profile));
      const km = SR.el('td');
      const bar = SR.el('span', 'sr-cellbar');
      const fill = document.createElement('i');
      fill.style.width = `${(r.km / maxKm) * 100}%`;
      fill.style.background = ramp[r.profile_i];
      bar.append(fill);
      km.append(bar, txt(SR.n0(r.km)));
      tr.append(key, SR.el('td', null, SR.n0(r.runs)), km, SR.el('td', 'sr-hide-sm', SR.n0(r.elev_m)),
        SR.el('td', null, SR.pace(r.pace_s)), SR.el('td', null, r.hr_avg == null ? '—' : SR.n0(r.hr_avg)));
      return tr;
    }));
    enter(table);
  }

  function drawElevTop() {
    const table = $('#t-elevtop');
    const rows = tableState(table, 'elev_top');
    if (!rows) return;
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.id;
      tr.append(SR.el('td', 'sr-l', SR.dmed(r.date)), SR.el('td', 'sr-l', r.name), SR.el('td', null, SR.n0(r.elev_m)),
        SR.el('td', null, SR.n1(r.km)), SR.el('td', 'sr-hide-sm', SR.n1(r.m_per_km)), SR.el('td', 'sr-hide-sm', SR.pace(r.pace_s)));
      return tr;
    }));
    enter(table);
  }

  /* ================= VDOT ================= */
  // Une couleur par distance, la même dans tout l’onglet.
  const CAT_COLORS = () => ({
    '10 km': SR.col.blue, Semi: SR.col.aqua, '20 km': dash.colors[3], Marathon: dash.colors[4],
    'Paris-Versailles': dash.colors[6], Trail: dash.colors[5], 'Relais et autres': SR.col.muted,
  });
  const catColor = (colors, c) => colors[c] || SR.col.muted;

  function drawVdot() {
    const box = $('#c-vdot');
    const d = SR.ready(box, ['race_plus']);
    if (!d || !d[0].length) return;
    const pts = d[0].filter((r) => r.vdot != null).map((r) => ({ ...r, t: SR.utc(r.date) }));
    if (!pts.length) return;
    const colors = CAT_COLORS();
    const cats = ['10 km', 'Semi', '20 km', 'Marathon'].filter((c) => pts.some((r) => r.category === c));
    $('#vdot-legend').replaceChildren(...cats.map((c) => legendItem(colors[c], c, 'dot')), legendItem(SR.col.muted, 'meilleur VDOT', 'line'));
    const W = SR.width(box);
    const H = 300;
    const m = { t: 22, r: 16, b: 30, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Indice VDOT de chaque course sur route');
    const tip = SR.tip(box);
    const tExt = d3.extent(pts, (r) => r.t);
    const x = d3.scaleUtc([new Date(tExt[0].getTime() - 30 * DAY), new Date(tExt[1].getTime() + 30 * DAY)], [m.l, W - m.r]);
    const vExt = d3.extent(pts, (r) => r.vdot);
    const y = d3.scaleLinear([Math.floor(vExt[0] - 1.5), Math.ceil(vExt[1] + 1.5)], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.n0, { noBase: true });
    timeAxis(svg, x, H - m.b);
    const end = { ...pts[pts.length - 1], t: x.invert(W - m.r) };
    svg.append('path').datum([...pts, end]).style('fill', 'none').style('stroke', SR.col.muted).attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 3').attr('d', d3.line().curve(d3.curveStepAfter).x((r) => x(r.t)).y((r) => y(r.vdot_best)));
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.vdot)).attr('r', (r) => (r.category === 'Marathon' ? 6.5 : 5))
      .style('fill', (r) => colors[r.category]).style('stroke', SR.col.panel).attr('stroke-width', 2);
    const top = pts.reduce((a, r) => (r.vdot > a.vdot ? r : a));
    const tx = x(top.t);
    halo(svg.append('text').attr('x', Math.max(m.l, Math.min(W - m.r, tx))).attr('y', y(top.vdot) - 11)
      .attr('text-anchor', tx > W - 80 ? 'end' : tx < m.l + 60 ? 'start' : 'middle')
      .style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)')
      .style('fill', 'var(--color-fg)')).text(`${SR.n1(top.vdot)} · ${top.event}`);
    const delaunay = d3.Delaunay.from(pts, (r) => x(r.t), (r) => y(r.vdot));
    const ring = svg.append('circle').attr('r', 9).style('fill', 'none').style('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const r = pts[delaunay.find(mx, my)];
        if (!r || Math.hypot(x(r.t) - mx, y(r.vdot) - my) > 30) {
          ring.attr('opacity', 0);
          tip.hide();
          return;
        }
        ring.attr('cx', x(r.t)).attr('cy', y(r.vdot)).attr('opacity', 1);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: r.event,
          rows: [
            { color: colors[r.category], label: 'VDOT', value: SR.n1(r.vdot) },
            { label: 'Chrono', value: SR.dur(r.time_s) },
            { label: 'Distance', value: `${SR.n1(r.km)} km` },
            ...(r.hr_avg != null ? [{ label: 'FC moyenne', value: `${SR.n0(r.hr_avg)} bpm` }] : []),
            ...(r.pr ? [{ label: 'Record personnel', value: 'oui' }] : []),
          ],
        }));
      })
      .on('pointerleave', () => {
        ring.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawPredict() {
    const table = $('#t-predict');
    const rows = tableState(table, 'race_predict');
    if (!rows) return;
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.distance;
      tr.append(SR.el('td', 'sr-l sr-key', r.distance), SR.el('td', null, SR.dur(r.time_s)), SR.el('td', 'sr-hide-sm', `${SR.pace(r.pace_s)}/km`),
        SR.el('td', null, r.best_s == null ? '—' : SR.dur(r.best_s)));
      return tr;
    }));
    const r0 = rows[0];
    if (r0) {
      $('#predict-note').replaceChildren(
        txt('Chronos équivalents au VDOT '), mk(SR.n1(r0.vdot), 'race_predict', 'vdot', null, 0), txt(' du '),
        mk(r0.from_event, 'race_predict', 'from_event', null, 0), txt(' ('), mk(SR.dmed(r0.from_date), 'race_predict', 'from_date', null, 0),
        txt('), mon meilleur des 12 derniers mois, comparés à mes records en compétition'),
      );
    }
    enter(table);
  }

  /* ================= Mon niveau actuel : dernière course et moyenne des 10 dernières ================= */
  const CAT_WORD = { '10 km': '10 km', Semi: 'semi', '20 km': '20 km', Marathon: 'marathon', 'Paris-Versailles': 'Paris-Versailles', Trail: 'trail' };
  const onCat = (c) => (c === 'Trail' ? 'en trail' : `sur ${CAT_WORD[c] || c}`);
  const FIRST = {
    '10 km': 'Mon premier 10 km', Semi: 'Mon premier semi', '20 km': 'Mon premier 20 km', Marathon: 'Mon premier marathon',
    'Paris-Versailles': 'Mon premier Paris-Versailles', Trail: 'Mon premier trail',
  };
  // Nom d’épreuve dans une phrase : « le 20 km de Paris », « les Championnats… », « l’Ekiden… », « Paris-Versailles ».
  const theEvent = (ev) => {
    if (/^(Championnats|Foulées)\b/.test(ev)) return `les ${ev}`;
    if (/^[A-ZÀ-Ý][a-zà-ÿ]+-[A-ZÀ-Ý]/.test(ev)) return ev;
    if (/^[aeiouyàâéèêëîïôûAEIOUYÀÂÉÈÊËÎÏÔÛ]/.test(ev)) return `l’${ev}`;
    return `le ${ev}`;
  };
  const after = (days) => ({ 1: 'un jour après', 7: 'une semaine après', 14: 'deux semaines après', 21: 'trois semaines après' }[days]
    || `${days} jours après`);
  const gapTime = (s) => {
    const a = Math.abs(Math.round(s));
    return a < 60 ? `${a}\u00a0s` : SR.dur(a);
  };
  const sgn1 = (v) => `${v >= 0 ? '+' : '−'}${SR.n1(Math.abs(v))}`;
  const sgnPct = (v) => `${v >= 0 ? '+' : '−'}${SR.n1(Math.abs(v) * 100)}\u00a0%`;
  const yearOf = (iso) => String(iso).slice(0, 4);
  const cap1 = (str) => str.charAt(0).toUpperCase() + str.slice(1);
  const catLine = (r) => (r.category === 'Semi' ? `Semi-marathon · ${SR.n1(r.km)} km`
    : ['10 km', '20 km'].includes(r.category) ? r.category : `${r.category} · ${SR.n1(r.km)} km`);

  function drawLastRace() {
    const box = $('#last-race');
    const tilesBox = $('#last-tiles');
    const d = SR.ready(box, ['race_last', 'race_best']);
    if (!d) return;
    SR.ready(tilesBox, ['race_last']);
    const [rows, best] = d;
    if (!rows.length) {
      box.hidden = true;
      tilesBox.hidden = true;
      return;
    }
    const [r] = rows;
    const S = 'race_last';
    const m = (text, field) => mk(text, S, field, null, 0);
    box.replaceChildren();

    // En-tête : l’épreuve à gauche, le chrono à droite.
    const head = SR.el('div', 'sr-goal__head');
    const title = SR.el('div', 'sr-goal__title');
    const h = SR.el('h3', 'sr-goal__event');
    h.append(m(r.event, 'event'));
    const line = SR.el('p', 'sr-last__line');
    line.append(SR.el('b', null, catLine(r)));
    if (r.place) line.append(txt(' · '), SR.el('b', null, r.place));
    if (r.hr_avg != null) line.append(txt(' · FC moyenne '), SR.el('b', null, `${SR.n0(r.hr_avg)}\u00a0bpm`));
    title.append(SR.el('p', 'sr-eyebrow', `Dernière course · ${SR.dmed(r.date)}`), h, line);
    const count = SR.el('div', 'sr-goal__count');
    const big = SR.el('span', 'sr-goal__j sr-last__time');
    big.append(m(SR.dur(r.time_s), 'time_s'));
    count.append(big, SR.el('span', 'sr-goal__date', `${SR.pace(r.pace_s)}/km · ${r.official ? 'chrono officiel' : 'temps écoulé'}`));
    head.append(title, count);
    box.append(head);

    // Ce que dit la course : niveau, record, gestion.
    const v = [];
    if (r.vdot != null) {
      v.push(txt('Avec un VDOT de '), hl(m(SR.n1(r.vdot), 'vdot')), txt(', '));
      if (r.vdot_n === 1) {
        v.push(txt('c’est ma première course sur route'));
      } else if (r.vdot_rank === 1) {
        v.push(txt('c’est '), hl(m('ma meilleure course sur route', 'vdot_rank')));
        v.push(txt(`, ${SR.n1(r.vdot - r.best_other_vdot)} au-dessus de mon ancien meilleur niveau (`), m(SR.n1(r.best_other_vdot), 'best_other_vdot'),
          txt(`, ${r.best_other_event} ${yearOf(r.best_other_date)})`));
      } else {
        v.push(txt('c’est ma '), hl(m(`${r.vdot_rank}e meilleure course`, 'vdot_rank')), txt(` sur route (sur ${SR.n0(r.vdot_n)}) : à `),
          m(SR.n1(r.best_other_vdot - r.vdot), 'best_other_vdot'), txt(` de mon meilleur niveau (${SR.n1(r.best_other_vdot)})`));
      }
      if (r.level_diff != null && r.level_n >= 5) {
        const avg = ` ma moyenne des ${SR.n0(r.level_n)} dernières courses (${SR.n1(r.level_avg)})`;
        if (Math.abs(r.level_diff) < 0.25) v.push(txt(` et dans${avg}`));
        else v.push(txt(' et '), hl(m(SR.n1(Math.abs(r.level_diff)), 'level_diff')), txt(` ${r.level_diff > 0 ? 'au-dessus de' : 'en dessous de'}${avg}`));
      }
      // Sur marathon, l’indice sort presque toujours plus bas que sur 10 km ou semi : la fatigue de fin de course n’est pas dans la formule.
      v.push(txt('. '));
      if (r.category === 'Marathon' && r.vdot_rank > 1) v.push(txt('Comme souvent, le marathon donne un indice plus bas que mes courses plus courtes. '));
    } else {
      v.push(txt({
        'Paris-Versailles': 'Paris-Versailles est trop vallonné pour l’indice VDOT : il ne compte pas dans mon niveau sur route. ',
        Trail: 'Pas d’indice VDOT en trail : avec le dénivelé, les chronos ne se comparent pas à la route. ',
        Relais: 'Pas d’indice VDOT pour un relais : il ne compte pas dans mon niveau sur route. ',
      }[r.category] || 'Pas d’indice VDOT sur ce parcours atypique : il ne compte pas dans mon niveau sur route. '));
    }
    const rec = [];
    if (r.rec_time_s != null) {
      const ref = `${SR.dur(r.rec_time_s)}, ${r.rec_event} ${yearOf(r.rec_date)}`;
      if (r.pr) rec.push(hl(m(`Record personnel ${onCat(r.category)}`, 'pr')), txt(` : ${gapTime(r.rec_gap_s)} de mieux que l’ancien (${ref})`));
      else rec.push(txt('À '), hl(m(gapTime(r.rec_gap_s), 'rec_gap_s')), txt(` de mon record ${onCat(r.category)} (${ref})`));
    } else if (FIRST[r.category]) {
      rec.push(txt(FIRST[r.category]));
    }
    if (r.ed_time_s != null && r.ed_date !== r.rec_date) {
      const e = `${gapTime(r.ed_gap_s)} ${r.ed_gap_s <= 0 ? 'plus vite' : 'plus lent'} qu’en ${yearOf(r.ed_date)} (${SR.dur(r.ed_time_s)})`;
      rec.push(txt(rec.length ? `, ${e}` : cap1(e)));
    }
    if (r.prev_days != null && r.prev_days >= 1 && r.prev_days <= 21) {
      const prev = r.prev_pr && CAT_WORD[r.prev_category] ? `mon record ${onCat(r.prev_category)}` : theEvent(r.prev_event);
      rec.push(txt(rec.length ? `, ${after(r.prev_days)} ${prev}` : cap1(`${after(r.prev_days)} ${prev}`)));
    }
    if (rec.length) v.push(...rec, txt('. '));
    if (r.split_pct != null) {
      const sp = r.split_pct;
      const usual = r.split_median != null ? `d’habitude ${sgnPct(r.split_median)}` : '';
      const heart = r.hr1 && r.hr2 && r.hr2 - r.hr1 >= 4 ? `, le cœur passant de ${SR.n0(r.hr1)} à ${SR.n0(r.hr2)}\u00a0bpm` : '';
      if (sp <= -0.005) v.push(txt('Négative split : 2e moitié '), hl(m(`${SR.n1(-sp * 100)}\u00a0%`, 'split_pct')), txt(' plus rapide que la 1re.'));
      else if (sp < 0.015) v.push(txt('Allure régulière : 2e moitié à '), m(sgnPct(sp), 'split_pct'), txt(` de la 1re${usual ? ` (${usual})` : ''}.`));
      else {
        v.push(txt(`J’ai ${sp >= 0.035 ? 'nettement' : 'un peu'} ralenti en 2e moitié (`), hl(m(sgnPct(sp), 'split_pct')),
          txt(`${usual ? `, ${usual}` : ''})${heart}.`));
      }
    }
    const verdict = SR.el('p', 'sr-last__verdict');
    verdict.append(...v);
    box.append(verdict);

    // Prochain objectif du calendrier, s’il vient après cette course.
    if (r.goal_event) {
      const g = SR.el('p', 'sr-last__goal');
      g.append(txt('Prochain objectif : '), SR.el('b', null, r.goal_event), txt(` le ${SR.dshort(r.goal_date)}`));
      if (r.goal_target_s) {
        g.append(txt(' en '), SR.el('b', null, SR.dur(r.goal_target_s)));
        const eq = { '10 km': r.eq_10k_s, Semi: r.eq_semi_s, Marathon: r.eq_marathon_s }[r.goal_category];
        if (r.goal_category === r.category && r.goal_target_pace_s) {
          const dp = Math.round(r.pace_s - r.goal_target_pace_s);
          g.append(txt(dp > 0 ? `, soit ${dp}\u00a0s/km plus vite que cette course` : dp < 0 ? `, soit ${-dp}\u00a0s/km de marge sur cette course` : ', à l’allure de cette course'));
        } else if (eq) {
          g.append(txt(` ; cette course vaut ${SR.dur(eq)} ${onCat(r.goal_category)}`));
        }
      }
      g.append(txt('.'));
      box.append(g);
    }

    // Équivalences de cette course et lien vers le détail km par km.
    const foot = SR.el('div', 'sr-last__foot');
    if (r.vdot != null) {
      const wrap = SR.el('div', 'sr-last__eqwrap');
      const dl = SR.el('dl', 'sr-last__eq');
      [['5 km', 'eq_5k_s', null], ['10 km', 'eq_10k_s', '10 km'], ['Semi', 'eq_semi_s', 'Semi'], ['Marathon', 'eq_marathon_s', 'Marathon']]
        .filter(([, , c]) => c !== r.category)
        .forEach(([label, field, c]) => {
          const item = SR.el('div');
          const rb = c ? best.find((x) => x.category === c) : null;
          const dd = SR.el('dd');
          dd.append(m(SR.dur(r[field]), field));
          item.append(SR.el('dt', null, label), dd);
          if (rb) item.append(SR.el('dd', null, `record ${SR.dur(rb.time_s)}`));
          dl.append(item);
        });
      dl.dataset.n = String(dl.children.length);
      wrap.append(SR.el('p', 'sr-last__eqtitle', 'Ce que vaut cette course sur d’autres distances'), dl);
      foot.append(wrap);
    }
    if (r.split_pct != null) {
      const btn = SR.el('button', 'sr-last__more', 'Détail km par km ↓');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const pick = $('#racekm-pick');
        if (pick && [...pick.options].some((o) => o.value === r.id) && pick.value !== r.id) {
          pick.value = r.id;
          pick.dispatchEvent(new Event('change'));
        }
        const card = $('#card-racekm');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      foot.append(btn);
    }
    if (foot.children.length) box.append(foot);
    enter(box);

    // Tuiles : niveau, record, gestion de course, préparation.
    const T = [];
    if (r.vdot != null) {
      T.push(tile('Indice VDOT', m(SR.n1(r.vdot), 'vdot'), null,
        [txt(r.vdot_rank === 1 ? 'mon meilleur' : `${r.vdot_rank}e sur ${SR.n0(r.vdot_n)}`),
          txt(`\u00a0· ${r.vdot_year_rank === 1 ? `meilleur de ${r.year}` : `${r.vdot_year_rank}e en ${r.year}`}`)],
        r.vdot_rank === 1 ? 'sr-tile--good' : ''));
    }
    if (r.rec_time_s != null) {
      T.push(r.pr
        ? tile('Record battu', m(`−${gapTime(r.rec_gap_s)}`, 'rec_gap_s'), null, [txt(`ancien : ${SR.dur(r.rec_time_s)}\u00a0· ${r.rec_event} ${yearOf(r.rec_date)}`)], 'sr-tile--good')
        : tile('Écart au record', m(`+${gapTime(r.rec_gap_s)}`, 'rec_gap_s'), null, [txt(`${SR.dur(r.rec_time_s)}\u00a0· ${r.rec_event} ${yearOf(r.rec_date)}`)]));
    } else if (r.ed_time_s != null) {
      T.push(tile('Édition précédente', m(`${r.ed_gap_s <= 0 ? '−' : '+'}${gapTime(r.ed_gap_s)}`, 'ed_gap_s'), null,
        [txt(`${SR.dur(r.ed_time_s)} en ${yearOf(r.ed_date)}`)], r.ed_gap_s < 0 ? 'sr-tile--good' : ''));
    }
    if (r.split_pct != null) {
      T.push(tile('2e moitié', m(sgnPct(r.split_pct), 'split_pct'), null,
        [txt(`${SR.pace(r.half1_pace)} → ${SR.pace(r.half2_pace)}/km`), ...(r.split_median != null ? [txt(`\u00a0· d’habitude ${sgnPct(r.split_median)}`)] : [])],
        r.split_pct <= -0.005 ? 'sr-tile--good' : r.split_pct >= 0.035 ? 'sr-tile--warn' : ''));
    }
    // Hors route plate (Paris-Versailles, trail, parcours atypique), le dénivelé explique une bonne part du chrono.
    if (!['10 km', '20 km', 'Semi', 'Marathon'].includes(r.category) && r.elev_m > 0) {
      T.push(tile('Dénivelé', m(SR.n0(r.elev_m), 'elev_m'), 'm D+', [txt(`${SR.n1(r.elev_m / r.km)} m par km`)]));
    }
    T.push(tile('Préparation', m(SR.n0(r.vol_km_week), 'vol_km_week'), 'km/sem',
      [txt('6 semaines avant'), ...(r.ref_vol_km_week != null
        ? [txt(`\u00a0· ${SR.n0(r.ref_vol_km_week)} avant ${r.pr ? 'l’ancien record' : 'mon record'}`)] : [])]));
    tilesBox.replaceChildren(...T);
    enter(tilesBox);
  }

  function drawLevel() {
    const box = $('#c-level');
    const top = $('#level-head');
    const sum = $('#level-sum');
    const d = SR.ready(box, ['race_level', 'race_best']);
    if (!d) return;
    SR.ready(top, ['race_level']);
    SR.ready(sum, ['race_level']);
    if (!d[0].length) {
      $('#card-level').hidden = true;
      return;
    }
    const [[L], best] = d;
    const S = 'race_level';
    const m = (text, field) => mk(text, S, field, null, 0);
    const sameYear = yearOf(L.from_date) === yearOf(L.to_date);
    $('#level-note').textContent = `Indice VDOT de mes ${L.n} dernières courses sur route (10 km, 20 km, semi, marathon), `
      + `du ${sameYear ? SR.dshort(L.from_date) : SR.dmed(L.from_date)} au ${SR.dmed(L.to_date)}`;

    // Résumé : moyenne, progression, équivalences, meilleure et moins bonne.
    const big = SR.el('div', 'sr-level__big');
    const val = SR.el('span', 'sr-level__value');
    val.append(m(SR.n1(L.vdot_avg), 'vdot_avg'));
    big.append(val);
    if (L.delta != null) {
      const badge = SR.el('span', 'sr-badge');
      badge.append(m(sgn1(L.delta), 'delta'), txt(` par rapport aux ${SR.n0(L.prev_n)} d’avant`));
      big.append(badge);
    }
    top.replaceChildren(SR.el('p', 'sr-level__label', 'VDOT moyen'), big);
    const table = SR.el('table', 'sr-table sr-table--tight');
    const thead = SR.el('thead');
    const hr = SR.el('tr');
    hr.append(SR.el('th', 'sr-l', 'À ce niveau'), SR.el('th', null, 'Équivalent'), SR.el('th', null, 'Record'));
    thead.append(hr);
    const tbody = SR.el('tbody');
    [['10 km', 'eq_10k_s', '10 km'], ['Semi', 'eq_semi_s', 'Semi'], ['Marathon', 'eq_marathon_s', 'Marathon']].forEach(([label, field, c]) => {
      const rb = best.find((x) => x.category === c);
      const tr = SR.el('tr');
      const td = SR.el('td');
      td.append(m(SR.dur(L[field]), field));
      tr.append(SR.el('td', 'sr-l sr-key', label), td, SR.el('td', 'sr-muted', rb ? SR.dur(rb.time_s) : '—'));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    const tw = SR.el('div', 'sr-tablewrap');
    tw.append(table);
    const stats = SR.el('p', 'sr-stats');
    const seg = (label, value, rest) => {
      const s = SR.el('span');
      s.append(txt(`${label} `), value, txt(rest ? ` ${rest}` : ''));
      return s;
    };
    stats.append(
      seg('Meilleure', SR.el('b', null, SR.n1(L.top_vdot)), `· ${L.top_event}`),
      seg('Moins bonne', SR.el('b', null, SR.n1(L.low_vdot)), `· ${L.low_event}`),
      seg('Écart-type', SR.el('b', null, `±${SR.n1(L.vdot_sd)}`)),
    );
    sum.replaceChildren(tw, stats);

    // Graphique : une pastille par course, la moyenne et celle des courses d’avant.
    const rows = L.races.map((r, i) => ({ ...r, i }));
    const colors = CAT_COLORS();
    const cats = ['10 km', 'Semi', '20 km', 'Marathon'].filter((c) => rows.some((r) => r.category === c));
    $('#level-legend').replaceChildren(...cats.map((c) => legendItem(colors[c], c, 'dot')), legendItem('var(--color-fg)', 'moyenne', 'line'),
      ...(L.prev_avg != null ? [legendItem(SR.col.ref, `les ${SR.n0(L.prev_n)} d’avant`, 'dash')] : []));
    const W = SR.width(box);
    const H = W >= 560 ? 300 : 220;
    box.style.setProperty('--h', `${H}px`);
    const mg = { t: 26, r: 78, b: 30, l: 34 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', `Indice VDOT de mes ${L.n} dernières courses sur route et leur moyenne`);
    const tip = SR.tip(box);
    const x = d3.scalePoint(rows.map((r) => r.i), [mg.l, W - mg.r]).padding(0.5);
    const vals = [...rows.map((r) => r.vdot), L.vdot_avg, ...(L.prev_avg != null ? [L.prev_avg] : [])];
    const y = d3.scaleLinear([Math.floor(d3.min(vals) - 0.3), Math.ceil(d3.max(vals) + 0.3)], [H - mg.b, mg.t]).nice();
    const ticks = y.ticks(4).filter((t) => Number.isInteger(t));
    SR.gridY(svg, y, mg.l, W - mg.r, ticks, SR.n0, { noBase: true });
    const lines = [{ v: L.vdot_avg, label: 'moyenne', color: 'var(--color-fg)', dash: null, w: 2 }];
    if (L.prev_avg != null) lines.push({ v: L.prev_avg, label: `les ${SR.n0(L.prev_n)} d’avant`, color: SR.col.ref, dash: '5 4', w: 1.5 });
    lines.forEach((l) => {
      svg.append('line').attr('x1', mg.l).attr('x2', W - mg.r + 6).attr('y1', y(l.v)).attr('y2', y(l.v))
        .style('stroke', l.color).attr('stroke-width', l.w).attr('stroke-dasharray', l.dash);
    });
    // Libellés à droite, écartés s’ils se touchent.
    const labs = SR.spread(lines.map((l) => ({ ...l, py: y(l.v) })), 'py', 30, mg.t, H - mg.b);
    labs.forEach((l) => {
      const g = svg.append('g').attr('transform', `translate(${W - mg.r + 12},${l.py})`);
      g.append('text').attr('y', -2).style('font-size', 'var(--cds-font-size-body)').style('font-weight', 800)
        .style('fill', 'var(--color-fg)').style('font-variant-numeric', 'tabular-nums').text(SR.n1(l.v));
      SR.cap(g.append('text').attr('y', 12)).text(l.label);
    });
    const lastI = rows.length - 1;
    svg.append('circle').attr('cx', x(lastI)).attr('cy', y(rows[lastI].vdot)).attr('r', 10.5)
      .style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 1.5);
    halo(svg.append('text').attr('x', x(lastI)).attr('y', y(rows[lastI].vdot) - 16).attr('text-anchor', 'middle')
      .style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)')
      .style('fill', 'var(--color-fg)')).text('dernière');
    svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (r) => x(r.i)).attr('cy', (r) => y(r.vdot)).attr('r', 6)
      .style('fill', (r) => colors[r.category] || SR.col.muted).style('stroke', SR.col.panel).attr('stroke-width', 2);
    const fmtD = (iso) => (sameYear ? SR.dshort(iso) : SR.dmed(iso));
    SR.cap(svg.append('text').attr('x', x(0)).attr('y', H - mg.b + 18).attr('text-anchor', 'middle')).text(fmtD(rows[0].date));
    SR.cap(svg.append('text').attr('x', x(lastI)).attr('y', H - mg.b + 18).attr('text-anchor', 'middle')).text(SR.dshort(rows[lastI].date));
    const hits = svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (r) => x(r.i)).attr('cy', (r) => y(r.vdot)).attr('r', 15)
      .style('fill', 'transparent').style('cursor', 'pointer');
    SR.hover(hits, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.event,
      rows: [
        { color: colors[r.category] || SR.col.muted, label: 'VDOT', value: SR.n1(r.vdot) },
        { label: 'Chrono', value: SR.dur(r.time_s) },
        { label: 'Écart à la moyenne', value: sgn1(r.vdot - L.vdot_avg) },
        ...(r.pr ? [{ label: 'Record personnel', value: 'oui' }] : []),
      ],
    }));
    enter(box);
  }

  /* ================= Courses par an et par distance ================= */
  const plural = (n, one, many) => (n > 1 ? many : one);

  function drawRaceTiles() {
    const box = $('#race-tiles');
    const d = SR.ready(box, ['race_summary']);
    if (!d || !d[0].length) return;
    const [s] = d[0];
    const S = 'race_summary';
    const now = [txt('au '), mk(SR.dshort(s.as_of), S, 'as_of', null, 0)];
    if (s.prev_year != null) {
      now.push(txt(' · '), mk(SR.n0(s.prev_ytd_races), S, 'prev_ytd_races', null, 0), txt(' à la même date en '),
        mk(String(s.prev_year), S, 'prev_year', null, 0));
    }
    box.replaceChildren(
      tile('Compétitions', mk(SR.n0(s.races), S, 'races', null, 0), null,
        [txt('depuis '), mk(String(s.first_year), S, 'first_year', null, 0), txt(' · '), mk(SR.n0(s.prs), S, 'prs', null, 0),
          txt(` ${plural(s.prs, 'record personnel', 'records personnels')}`)]),
      tile('Année la plus chargée', mk(SR.n0(s.busiest_races), S, 'busiest_races', null, 0), plural(s.busiest_races, 'course', 'courses'),
        [txt('en '), mk(String(s.busiest_year), S, 'busiest_year', null, 0)]),
      tile(`En ${s.cur_year}`, mk(SR.n0(s.cur_races), S, 'cur_races', null, 0), plural(s.cur_races, 'course', 'courses'), now),
      tile('Distance la plus courue', mk(s.top_category, S, 'top_category', null, 0), null,
        [mk(SR.n0(s.top_races), S, 'top_races', null, 0), txt(` ${plural(s.top_races, 'course', 'courses')} · `),
          mk(SR.pct(s.top_share), S, 'top_share', null, 0), txt(' du total')]),
    );
    enter(box);
  }

  // Une barre par année, segmentée par distance, de longueur proportionnelle au nombre de courses.
  function drawRaceYears() {
    const box = $('#c-raceyears');
    const d = SR.ready(box, ['race_mix', 'race_years']);
    if (!d || !d[1].length) return;
    const [mix, years] = d;
    const colors = CAT_COLORS();
    const cats = [...new Map(mix.map((r) => [r.cat_i, r.category])).entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    $('#raceyears-legend').replaceChildren(...cats.map((c) => legendItem(catColor(colors, c), c)));
    const rows = [...years].sort((a, b) => b.year - a.year);
    const W = SR.width(box);
    const rowH = 26;
    const gapY = 14;
    const H = rows.length * (rowH + gapY) - gapY + 4;
    box.style.setProperty('--h', `${H}px`);
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Nombre de compétitions par année, réparties par distance');
    const tip = SR.tip(box);
    const lw = (d3.max(rows, (r) => measure(svg, String(r.year))) || 0) + 12;
    const rw = (d3.max(rows, (r) => measure(svg, SR.n0(r.races))) || 0) + 14;
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.races) || 1], [lw, W - rw]);
    const segs = [];
    rows.forEach((yr, i) => {
      const y0 = 2 + i * (rowH + gapY);
      svg.append('text').attr('x', 0).attr('y', y0 + rowH / 2).attr('dy', '0.32em')
        .style('font-size', 'var(--cds-font-size-body)').style('fill', 'var(--color-fg)').text(String(yr.year));
      svg.append('text').attr('x', W).attr('y', y0 + rowH / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
        .style('font-size', 'var(--cds-font-size-body)').style('font-weight', 'var(--cds-font-weight-medium)')
        .style('fill', 'var(--color-fg)').text(SR.n0(yr.races));
      const parts = mix.filter((r) => r.year === yr.year).sort((a, b) => a.cat_i - b.cat_i);
      let acc = 0;
      parts.forEach((p, j) => {
        segs.push({ ...p, a: acc, b: acc + p.races, y0, first: j === 0, last: j === parts.length - 1 });
        acc += p.races;
      });
    });
    // Un trait de 2 px de fond sépare deux segments voisins.
    const sx = (s) => x(s.a) + (s.first ? 0 : 1);
    const sw = (s) => Math.max(0, x(s.b) - x(s.a) - (s.first ? 0 : 1) - (s.last ? 0 : 1));
    const rects = svg.append('g').selectAll('rect').data(segs).join('rect')
      .attr('x', sx).attr('y', (s) => s.y0).attr('width', sw).attr('height', rowH)
      .attr('rx', 4).style('fill', (s) => catColor(colors, s.category));
    const inks = {};
    cats.forEach((c) => {
      inks[c] = SR.inkOn(SR.rgb(catColor(colors, c)));
    });
    const labels = svg.append('g').selectAll('text').data(segs.filter((s) => sw(s) >= 18)).join('text')
      .attr('x', (s) => sx(s) + sw(s) / 2).attr('y', (s) => s.y0 + rowH / 2).attr('dy', '0.32em')
      .attr('text-anchor', 'middle').style('font-size', 'var(--cds-font-size-caption)')
      .style('font-weight', 'var(--cds-font-weight-medium)').style('pointer-events', 'none')
      .style('fill', (s) => inks[s.category]).text((s) => SR.n0(s.races));
    SR.hover(rects, box, tip, (s) => ({
      head: `${s.year} · ${s.category}`,
      rows: [
        { color: catColor(colors, s.category), label: plural(s.races, 'Course', 'Courses'), value: SR.n0(s.races) },
        { label: 'Part de l’année', value: SR.pct(s.share) },
        { label: 'Km en compétition', value: `${SR.n0(s.km)} km` },
        ...(s.prs ? [{ label: plural(s.prs, 'Record personnel', 'Records personnels'), value: SR.n0(s.prs) }] : []),
      ],
    }), (e, s) => {
      rects.attr('opacity', (o) => (o.category === s.category ? 1 : 0.35));
      labels.attr('opacity', (o) => (o.category === s.category ? 1 : 0.35));
    }, () => {
      rects.attr('opacity', 1);
      labels.attr('opacity', 1);
    });
    enter(box);
  }

  // Tableau croisé : une ligne par distance, une colonne par année.
  function drawRaceCats() {
    const table = $('#t-racecats');
    const rows = tableState(table, 'race_cats');
    if (!rows || !rows.length) return;
    const colors = CAT_COLORS();
    const yearKeys = Object.keys(rows[0]).filter((k) => /^y\d{4}$/.test(k)).sort();
    const th = (field, text, cls) => {
      const c = SR.el('th', cls || null, text);
      c.dataset.field = field;
      return c;
    };
    table.tHead.rows[0].replaceChildren(
      th('category', 'Distance', 'sr-l'),
      ...yearKeys.map((k) => th(k, k.slice(1))),
      th('races', 'Total'),
      th('share', 'Part', 'sr-hide-sm'),
    );
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.category;
      const name = SR.el('td', 'sr-l sr-key');
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = catColor(colors, r.category);
      name.append(sw, txt(r.category));
      tr.append(name, ...yearKeys.map((k) => SR.el('td', r[k] ? null : 'sr-muted', SR.n0(r[k]))),
        SR.el('td', 'sr-key', SR.n0(r.races)), SR.el('td', 'sr-hide-sm', SR.pct(r.share)));
      return tr;
    }));
    enter(table);
  }

  SR.pages = {
    distances: [drawElevTiles, drawElevYears, drawTerrain, drawElevTop],
    cardio: [drawCardioLead, drawCardioTiles, drawZoneYears, drawLoad, drawZoneMonths, drawZoneBands, drawLoadWeeks],
    croise: [drawCroiseLead, drawHrPace, drawHrScatter, drawEff, drawEffYears, drawDrift, drawDriftYears, drawGrade, drawCadPace],
    competitions: [drawLastRace, drawLevel, drawRaceTiles, drawRaceYears, drawRaceCats, drawVdot, drawPredict],
  };
  seg('load-range', 'loadRange', drawLoad);
  seg('zonemonths-by', 'zoneMonthsBy', drawZoneMonths);
})();
