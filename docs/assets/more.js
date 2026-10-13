/* Gestion de course, plan d’allure, charge et reprise, boucles et segments, récap partageable. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const DAY = 864e5;
  const ui = { race: null, loop: null, seg: null, period: null };
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
    const card = el && el.closest('.sr-card, .sr-tiles, .sr-loops, .sr-recap');
    if (!card || entered.has(card)) return;
    entered.add(card);
    card.style.animationDelay = `${(entered.size % 6) * 40}ms`;
    card.classList.add('sr-enter');
  };
  const txt = (s) => document.createTextNode(s);
  const b = (s) => SR.el('b', null, s);
  const legendItem = (color, label, kind = '') => {
    const item = SR.el('span', 'sr-legend__item');
    const sw = SR.el('i', `sr-sw${kind ? ` sr-sw--${kind}` : ''}`);
    if (kind !== 'ring') sw.style.background = color;
    item.append(sw, txt(label));
    return item;
  };
  const halo = (sel) => sel.attr('paint-order', 'stroke').style('stroke', 'var(--color-panel)').attr('stroke-width', 4).attr('stroke-linejoin', 'round');
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
  const diamond = (x, y, r = 5) => `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`;
  const empty = (box, msg) => {
    box.classList.remove('dash-skeleton');
    box.replaceChildren(SR.el('p', 'sr-empty', msg));
  };
  const ready = (box, ids) => SR.ready(box, ids);
  const sgn = (v, f = SR.n0) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));
  const secs = (v) => {
    const a = Math.abs(Math.round(v));
    const s = a < 60 ? `${a} s` : SR.dur(a);
    return v > 0.5 ? `+${s}` : v < -0.5 ? `−${s}` : '0 s';
  };
  const ord = (k) => (k === 1 ? '1er' : `${k}e`);
  const timeAxis = (svg, x, y0, minGap = 62) => {
    const [d0, d1] = x.domain();
    const [a, bb] = x.range();
    const months = Math.max(1, (d1 - d0) / (30.44 * DAY));
    const per = (bb - a) / months;
    const k = [1, 2, 3, 6, 12, 24].find((s) => per * s >= minGap) || 24;
    const ticks = k >= 12 ? x.ticks(d3.utcYear.every(k / 12)) : x.ticks(d3.utcMonth.every(k));
    ticks.forEach((t) => {
      const px = x(t);
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', y0).attr('y2', y0 + 4).style('stroke', SR.col.axis);
      SR.cap(svg.append('text').attr('x', px).attr('y', y0 + 17).attr('text-anchor', 'middle'))
        .text(t.getUTCMonth() === 0 ? String(t.getUTCFullYear()) : SR.mon(t));
    });
  };
  const unit = (svg, x, label, anchor = 'end') => SR.cap(svg.append('text').attr('x', x).attr('y', 11).attr('text-anchor', anchor)).text(label);
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ================= Gestion de course (Compétitions) ================= */
  const GROUPS = [
    ['10 km', (c) => c === '10 km', () => SR.col.blue],
    ['Semi et 20 km', (c) => c === 'Semi' || c === '20 km', () => SR.col.orange],
    ['Marathon', (c) => c === 'Marathon', () => SR.col.aqua],
    ['Autres', () => true, () => SR.col.muted],
  ];
  const groupOf = (cat) => GROUPS.find(([, f]) => f(cat));

  function drawPaceCoverage() {
    const res = dash.data('race_pacing');
    const el = $('#pacing-cov');
    if (!el || res.status !== 'ok') return;
    const all = res.data;
    const n = all.filter((r) => r.splits).length;
    const pending = all.filter((r) => !r.laps_known).length;
    el.textContent = `Tours au km connus pour ${SR.n0(n)} courses sur ${SR.n0(all.length)}`
      + (pending ? ` · les ${SR.n0(pending)} autres arrivent avec les prochaines synchros` : '')
      + (all.length - n - pending > 0 ? ` · ${SR.n0(all.length - n - pending)} sans tours au km` : '');
  }

  function drawPaceSplit() {
    const box = $('#c-pacesplit');
    const d = ready(box, ['race_pacing']);
    if (!d) return;
    const rows = d[0].filter((r) => r.splits && r.split_pct != null).map((r) => ({ ...r, t: SR.utc(r.date) }));
    if (!rows.length) {
      empty(box, 'Les tours au km des compétitions arrivent avec les prochaines synchros.');
      return;
    }
    const used = GROUPS.filter(([, f]) => rows.some((r) => f(r.category)));
    $('#pacesplit-legend').replaceChildren(...used.map(([l, , c]) => legendItem(c(), l, 'dot')));
    const W = SR.width(box);
    const H = 260;
    const m = { t: 26, r: 14, b: 30, l: 46 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Écart d’allure entre la deuxième et la première moitié de chaque course');
    const tip = SR.tip(box);
    const t0 = d3.min(rows, (r) => r.t);
    const t1 = d3.max(rows, (r) => r.t);
    const pad = Math.max(20 * DAY, (t1 - t0) * 0.04);
    const x = d3.scaleUtc([new Date(t0.getTime() - pad), new Date(t1.getTime() + pad)], [m.l, W - m.r]);
    const lo = Math.min(-0.04, d3.min(rows, (r) => r.split_pct) - 0.01);
    const hi = Math.max(0.06, d3.max(rows, (r) => r.split_pct) + 0.01);
    const y = d3.scaleLinear([lo, hi], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${SR.n0(Math.abs(v) * 100)} %`), { noBase: true });
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', SR.col.ref).attr('stroke-width', 1.2);
    SR.cap(svg.append('text').attr('x', m.l + 4).attr('y', m.t - 12)).text('↑ 2e moitié plus lente');
    SR.cap(svg.append('text').attr('x', m.l + 4).attr('y', H - m.b - 6)).text('↓ 2e moitié plus rapide');
    timeAxis(svg, x, H - m.b);
    const dots = svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.split_pct)).attr('r', 6)
      .style('fill', (r) => groupOf(r.category)[2]()).style('stroke', SR.col.panel).attr('stroke-width', 2).style('cursor', 'pointer');
    SR.hover(dots, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.event,
      rows: [
        { color: groupOf(r.category)[2](), label: 'Chrono', value: SR.dur(r.time_s) },
        { label: '1re moitié', value: `${SR.pace(r.half1_pace)}/km` },
        { label: '2e moitié', value: `${SR.pace(r.half2_pace)}/km` },
        { label: 'Écart', value: `${r.split_pct >= 0 ? '+' : '−'}${SR.n1(Math.abs(r.split_pct) * 100)} %` },
      ],
    }));
    dots.on('click', (event, r) => {
      ui.race = r.id;
      run(drawRaceKm);
      const card = $('#card-racekm');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    enter(box);
  }

  function drawRaceKm() {
    const box = $('#c-racekm');
    const hrBox = $('#c-racekm-hr');
    const d = ready(box, ['race_pacing']);
    if (!d) return;
    const all = d[0];
    const rows = all.filter((r) => r.splits).sort((a, c) => c.day - a.day);
    const pick = $('#racekm-pick');
    if (!rows.length) {
      empty(box, 'Les tours au km des compétitions arrivent avec les prochaines synchros.');
      hrBox.replaceChildren();
      pick.closest('.sr-selectwrap').hidden = true;
      return;
    }
    pick.closest('.sr-selectwrap').hidden = false;
    if (!ui.race || !rows.some((r) => r.id === ui.race)) ui.race = rows[0].id;
    if (pick.dataset.n !== String(rows.length)) {
      pick.replaceChildren(...rows.map((r) => {
        const o = SR.el('option', null, `${r.event} · ${SR.dmed(r.date)}`);
        o.value = r.id;
        return o;
      }));
      pick.dataset.n = String(rows.length);
    }
    pick.value = ui.race;
    const r = rows.find((x) => x.id === ui.race);
    $('#racekm-title').textContent = `${r.event} ${r.year}`;
    $('#racekm-note').textContent = `${SR.dur(r.time_s)} · ${SR.pace(r.pace_s)}/km · écart de chaque km (tour GPS de la montre) à mon allure moyenne sur la course`;
    const st = $('#racekm-stats');
    const seg = (label, value) => {
      const s = SR.el('span');
      s.append(txt(`${label} `), b(value));
      return s;
    };
    st.replaceChildren(
      seg('1re moitié', `${SR.pace(r.half1_pace)}/km`),
      seg('2e moitié', `${SR.pace(r.half2_pace)}/km (${r.split_pct >= 0 ? '+' : '−'}${SR.n1(Math.abs(r.split_pct) * 100)} %)`),
      seg('km le plus rapide :', `${ord(r.fast_k)} en ${SR.pace(r.fast_pace)}`),
      seg('le plus lent :', `${ord(r.slow_k)} en ${SR.pace(r.slow_pace)}`),
      seg('régularité', `±${SR.n0(r.sd)} s/km`),
    );
    const cFast = SR.col.blue;
    const cSlow = SR.col.orange;
    // Le dernier bout de quelques dizaines de mètres (sprint final) ne dit rien de la gestion de course.
    const sp = r.splits.filter((s) => !s.part || s.d >= 400).map((s) => ({ ...s, dev: r.mean_lap_pace - s.pace }));
    $('#racekm-legend').replaceChildren(legendItem(cFast, 'plus vite que ma moyenne'), legendItem(cSlow, 'plus lent'),
      ...(sp.some((s) => s.part) ? [legendItem(SR.col.muted, 'dernier bout')] : []));
    const W = SR.width(box);
    const H = 250;
    const m = { t: 26, r: 8, b: 26, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', `Écart de chaque km à l’allure moyenne, ${r.event} ${r.year}`);
    const tip = SR.tip(box);
    const x = d3.scaleBand(sp.map((s) => s.k), [m.l, W - m.r]).paddingInner(0.22).paddingOuter(0.05);
    const ext = Math.max(8, d3.max(sp.filter((s) => !s.part), (s) => Math.abs(s.dev)) || 8);
    const lim = Math.min(60, ext * 1.15);
    const y = d3.scaleLinear([-lim, lim], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${SR.n0(Math.abs(v))} s`), { noBase: true });
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', SR.col.axis);
    unit(svg, m.l - 8, 's/km');
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', 11).attr('text-anchor', 'end')).text('↑ plus vite · ↓ plus lent');
    const bw = x.bandwidth();
    sp.forEach((s) => {
      const v = Math.max(-lim, Math.min(lim, s.dev));
      const x0 = x(s.k);
      const top = v >= 0 ? y(v) : y(0);
      const h = Math.abs(y(v) - y(0));
      const path = v >= 0 ? SR.barPath(x0, top, bw, h, Math.min(3, bw / 2))
        : `M${x0},${top}H${x0 + bw}V${top + h - Math.min(3, bw / 2, h)}Q${x0 + bw},${top + h} ${x0 + bw - Math.min(3, bw / 2, h)},${top + h}H${x0 + Math.min(3, bw / 2, h)}Q${x0},${top + h} ${x0},${top + h - Math.min(3, bw / 2, h)}Z`;
      svg.append('path').attr('d', h > 0.5 ? path : `M${x0},${y(0) - 0.75}h${bw}v1.5h${-bw}Z`)
        .style('fill', s.part ? SR.col.muted : s.dev >= 0 ? cFast : cSlow);
    });
    const every = x.step() >= 22 ? 1 : x.step() >= 11 ? 2 : 5;
    sp.forEach((s) => {
      if (s.part ? false : (s.k === 1 || s.k % every === 0)) SR.cap(svg.append('text').attr('x', x(s.k) + bw / 2).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(String(s.k));
    });
    SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', H - m.b + 16).attr('text-anchor', 'end')).text('km');
    const hit = svg.append('g').selectAll('rect').data(sp).join('rect')
      .attr('x', (s) => x(s.k) - (x.step() - bw) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (s) => ({
      head: s.part ? `Dernier bout · ${SR.n0(s.d)} m` : `${ord(s.k)} km`,
      title: `${SR.pace(s.pace)}/km · ${SR.dur(s.cum)} au passage`,
      rows: [
        { color: s.part ? SR.col.muted : s.dev >= 0 ? cFast : cSlow, label: s.dev >= 0 ? 'Plus vite que ma moyenne' : 'Plus lent que ma moyenne', value: `${SR.n0(Math.abs(s.dev))} s/km` },
        ...(s.hr ? [{ label: 'FC moyenne', value: `${SR.n0(s.hr)} bpm` }] : []),
        ...(s.el != null ? [{ label: 'D+', value: `${SR.n0(s.el)} m` }] : []),
      ],
    }));
    // FC de chaque km, sur la même échelle horizontale.
    const hrs = sp.filter((s) => s.hr);
    if (hrs.length >= 3) {
      hrBox.hidden = false;
      const H2 = 110;
      const m2 = { t: 22, r: 8, b: 8, l: 44 };
      hrBox.replaceChildren();
      const svg2 = SR.svg(hrBox, W, H2).attr('aria-label', 'FC moyenne de chaque km');
      const tip2 = SR.tip(hrBox);
      const ye = d3.extent(hrs, (s) => s.hr);
      const y2 = d3.scaleLinear([ye[0] - 3, ye[1] + 3], [H2 - m2.b, m2.t]).nice(3);
      SR.gridY(svg2, y2, m2.l, W - m2.r, y2.ticks(3), SR.n0, { noBase: true });
      unit(svg2, m2.l - 8, 'bpm');
      SR.cap(svg2.append('text').attr('x', W - m2.r).attr('y', 11).attr('text-anchor', 'end')).text('FC moyenne de chaque km');
      const cx = (s) => x(s.k) + bw / 2;
      svg2.append('path').datum(hrs).style('fill', 'none').style('stroke', SR.col.aqua).attr('stroke-width', 2).attr('stroke-linejoin', 'round')
        .attr('d', d3.line().x(cx).y((s) => y2(s.hr)));
      const dots = svg2.append('g').selectAll('circle').data(hrs).join('circle').attr('cx', cx).attr('cy', (s) => y2(s.hr)).attr('r', 3.5)
        .style('fill', SR.col.aqua).style('stroke', SR.col.panel).attr('stroke-width', 1.5);
      SR.hover(dots, hrBox, tip2, (s) => ({ head: s.part ? 'Dernier bout' : `${ord(s.k)} km`, rows: [{ color: SR.col.aqua, label: 'FC moyenne', value: `${SR.n0(s.hr)} bpm` }] }));
    } else {
      hrBox.replaceChildren();
      hrBox.hidden = true;
    }
    // Éditions de la même épreuve.
    const eds = all.filter((x2) => x2.event === r.event).sort((a, c) => c.day - a.day);
    const wrap = $('#racekm-eds-wrap');
    wrap.hidden = eds.length < 2;
    if (eds.length >= 2) {
      $('#t-racekm-eds').tBodies[0].replaceChildren(...eds.map((e) => {
        const tr = document.createElement('tr');
        if (e.id === r.id) tr.className = 'is-current';
        tr.append(
          SR.el('td', 'sr-l sr-key', String(e.year)),
          SR.el('td', null, SR.dur(e.time_s)),
          SR.el('td', 'sr-hide-sm', e.splits ? `${SR.pace(e.half1_pace)}/km` : '—'),
          SR.el('td', 'sr-hide-sm', e.splits ? `${SR.pace(e.half2_pace)}/km` : '—'),
          SR.el('td', null, e.splits ? `${e.split_pct >= 0 ? '+' : '−'}${SR.n1(Math.abs(e.split_pct) * 100)} %` : e.laps_known ? 'pas de tours au km' : 'à venir'),
        );
        return tr;
      }));
    }
    enter(box);
  }
  $('#racekm-pick').addEventListener('change', (e) => {
    ui.race = e.target.value;
    run(drawRaceKm);
  });

  /* ================= Plan d’allure (Objectif) ================= */
  function drawGoalPlan() {
    const box = $('#c-goalplan');
    const card = $('#card-goalplan');
    const d = ready(box, ['goal_plan', 'goal_info']);
    if (!d) return;
    const [rows, info] = d;
    if (!rows.length || !info.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const g = info[0];
    const p = rows[0];
    const prev = p.prev_year;
    const curYear = SR.utc(g.date).getUTCFullYear();
    const cPrev = prev ? SR.yearColor(prev, curYear) : SR.col.blue;
    $('#goalplan-title').textContent = `Plan d’allure pour ${SR.dur(g.target_s)}`;
    $('#goalplan-note').textContent = prev
      ? `Mon objectif réparti sur chaque km de mon tracé ${prev} selon sa pente (+3 % de temps par % de montée, −1,8 % par % de descente) · km = tours automatiques de la montre`
      : 'Mon objectif à allure régulière, km par km';
    const st = $('#goalplan-stats');
    const parts = [];
    const s1 = SR.el('span');
    s1.append(txt('À la montre : '), b(`${SR.pace(p.watch_pace)}/km`), txt(' en moyenne'));
    if (prev) s1.append(txt(` (elle a mesuré ${SR.n2(p.gps_km)} km en ${prev})`));
    parts.push(s1);
    if (prev) {
      const last = rows[rows.length - 1];
      const s2 = SR.el('span');
      s2.append(txt(`En ${prev} : `), b(SR.dur(p.prev_time_s)), txt(`, ${secs(last.gap)} sur l’objectif à l’arrivée`));
      parts.push(s2);
    }
    st.replaceChildren(...parts);
    $('#goalplan-prevh').textContent = prev ? `Passage ${prev}` : '—';
    $('#goalplan-legend').replaceChildren(...(prev ? [legendItem(cPrev, `écart cumulé en ${prev}`, 'line'), legendItem('var(--color-fg)', `objectif ${SR.dur(g.target_s)}`, 'line')] : []));
    // Graphique : écart cumulé de la dernière édition par rapport au plan.
    if (prev) {
      const W = SR.width(box);
      const H = 240;
      const m = { t: 26, r: 56, b: 28, l: 46 };
      box.replaceChildren();
      const svg = SR.svg(box, W, H).attr('aria-label', `Écart cumulé de l’édition ${prev} par rapport au plan, km par km`);
      const tip = SR.tip(box);
      const pts = [{ k: 0, gap: 0, cum: 0, plan: 0 }, ...rows.map((r, i) => ({ ...r, kx: i + 1 }))];
      const x = d3.scaleLinear([0, rows.length], [m.l, W - m.r]);
      const ext = Math.max(15, d3.max(rows, (r) => Math.abs(r.gap)));
      const y = d3.scaleLinear([-ext * 1.15, ext * 1.15], [H - m.b, m.t]).nice();
      SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${SR.n0(Math.abs(v))} s`), { noBase: true });
      svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', 'var(--color-fg)').attr('stroke-width', 1.2).attr('stroke-dasharray', '5 4');
      SR.cap(svg.append('text').attr('x', m.l + 4).attr('y', m.t - 12)).text('↑ en retard sur l’objectif');
      SR.cap(svg.append('text').attr('x', m.l + 4).attr('y', H - m.b - 6)).text('↓ en avance');
      const every = (W - m.l - m.r) / rows.length >= 26 ? 1 : (W - m.l - m.r) / rows.length >= 13 ? 2 : 5;
      rows.forEach((r, i) => {
        if (!r.part && ((i + 1) % every === 0 || i === 0)) SR.cap(svg.append('text').attr('x', x(i + 1)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(String(r.k));
      });
      SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', H - m.b + 16).attr('text-anchor', 'end')).text('km');
      const line = d3.line().x((q, i) => x(i)).y((q) => y(q.gap));
      svg.append('path').datum(pts).style('fill', cPrev).attr('fill-opacity', 0.1)
        .attr('d', d3.area().x((q, i) => x(i)).y0(y(0)).y1((q) => y(q.gap)));
      svg.append('path').datum(pts).style('fill', 'none').style('stroke', cPrev).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('d', line);
      const end = pts[pts.length - 1];
      svg.append('circle').attr('cx', x(pts.length - 1)).attr('cy', y(end.gap)).attr('r', 4.5).style('fill', cPrev).style('stroke', SR.col.panel).attr('stroke-width', 2);
      halo(svg.append('text').attr('x', x(pts.length - 1) + 8).attr('y', y(end.gap)).attr('dy', '0.32em').style('font-size', 'var(--cds-font-size-caption)')
        .style('font-weight', 'var(--cds-font-weight-medium)').style('fill', 'var(--color-fg)')).text(secs(end.gap));
      const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
      const dot = svg.append('circle').attr('r', 4).style('fill', cPrev).style('stroke', SR.col.panel).attr('stroke-width', 2).attr('opacity', 0);
      svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).style('fill', 'transparent').style('touch-action', 'pan-y')
        .on('pointermove', (event) => {
          const [mx] = d3.pointer(event, svg.node());
          const i = Math.max(1, Math.min(rows.length, Math.round(x.invert(mx))));
          const r = rows[i - 1];
          rule.attr('x1', x(i)).attr('x2', x(i)).attr('opacity', 1);
          dot.attr('cx', x(i)).attr('cy', y(r.gap)).attr('opacity', 1);
          const [hx, hy] = d3.pointer(event, box);
          tip.show(hx, hy, (el) => SR.tipBody(el, {
            head: r.part ? 'Arrivée' : `${ord(r.k)} km (montre)`,
            title: `Objectif : ${SR.dur(r.plan_cum)} au passage`,
            rows: [
              { color: cPrev, line: true, label: `En ${prev}`, value: SR.dur(r.prev_cum) },
              { label: 'Écart cumulé', value: secs(r.gap) },
              { label: 'Allure prévue sur ce km', value: `${SR.pace(r.plan_pace)}/km` },
            ],
          }));
        })
        .on('pointerleave', () => {
          rule.attr('opacity', 0);
          dot.attr('opacity', 0);
          tip.hide();
        });
    } else {
      box.replaceChildren();
      box.hidden = true;
    }
    // Tableau km par km.
    const tbody = $('#t-goalplan').tBodies[0];
    tbody.classList.remove('dash-skeleton');
    tbody.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.append(
        SR.el('td', 'sr-l sr-key', r.part ? 'Arrivée' : String(r.k)),
        SR.el('td', null, `${SR.pace(r.plan_pace)}`),
        SR.el('td', null, SR.dur(r.plan_cum)),
        SR.el('td', null, r.prev_cum != null ? SR.dur(r.prev_cum) : '—'),
        SR.el('td', null, r.gap != null ? secs(r.gap) : '—'),
      );
      return tr;
    }));
    enter(box);
  }

  /* ================= Charge et reprise (Entraînement) ================= */
  function drawChargeTiles() {
    const box = $('#charge-tiles');
    const d = ready(box, ['charge_summary']);
    if (!d || !d[0].length) return;
    const s = d[0][0];
    const tiles = [];
    if (s.ramp != null) {
      tiles.push(tile(`Semaine du ${SR.dshort(s.week)}`, `${s.ramp >= 0 ? '+' : '−'}${SR.n0(Math.abs(s.ramp) * 100)} %`, null,
        [b(`${SR.n0(s.km)} km`), txt(` contre ${SR.n0(s.prev4)} km/sem sur les 4 d’avant`)], s.ramp >= 0.3 ? 'sr-tile--warn' : null));
    }
    if (s.ratio != null) {
      tiles.push(tile('Charge aiguë / chronique', SR.n2(s.ratio), null,
        s.peak_ratio != null ? [txt('pic à '), b(SR.n2(s.peak_ratio)), txt(` le ${SR.dshort(s.peak_date)}`)] : [],
        s.ratio >= 1.5 || (s.peak_ratio != null && s.peak_ratio >= 1.5) ? 'sr-tile--warn' : s.ratio >= 0.8 && s.ratio <= 1.3 ? 'sr-tile--good' : null));
    }
    if (s.rep_start) {
      tiles.push(tile('Dernière reprise', s.rep_ongoing ? 'en cours' : `${SR.n0(s.rep_back_weeks)}`, s.rep_ongoing ? null : `semaine${s.rep_back_weeks > 1 ? 's' : ''}`,
        [txt(`pour retrouver ${SR.n0(s.rep_base)} km/sem après ${SR.n0(s.rep_low_weeks)} semaines à ${SR.n0(s.rep_low)} km`)]));
      if (s.rep_max_ramp != null) {
        tiles.push(tile('Plus forte hausse en reprise', `+${SR.n0(s.rep_max_ramp * 100)} %`, null, [txt('par rapport aux 4 semaines d’avant')], s.rep_max_ramp >= 0.3 ? 'sr-tile--warn' : null));
      }
    }
    box.replaceChildren(...tiles);
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawRamp() {
    const box = $('#c-ramp');
    const d = ready(box, ['ramp_weeks']);
    if (!d || !d[0].length) return;
    const weeks = d[0].slice(-26).map((w) => ({ ...w, t: SR.utc(w.week) }));
    const cls = (w) => (w.ramp == null ? 'none' : w.ramp >= 0.3 ? 'hot' : w.ramp > 0 ? 'up' : 'down');
    const col = { hot: SR.col.orange, up: SR.col.blue, down: SR.col.muted, none: SR.col.muted };
    $('#ramp-legend').replaceChildren(legendItem(col.down, 'baisse'), legendItem(col.up, 'hausse jusqu’à +30 %'), legendItem(col.hot, 'au-delà de +30 %'));
    const W = SR.width(box);
    const H = 240;
    const m = { t: 24, r: 34, b: 28, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Hausse du volume de chaque semaine par rapport aux 4 précédentes');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.week), [m.l, W - m.r]).paddingInner(0.24);
    const vals = weeks.map((w) => w.ramp).filter((v) => v != null);
    const top = Math.min(2, Math.max(0.6, (d3.max(vals) || 0) * 1.1));
    const bot = Math.max(-1, Math.min(-0.4, (d3.min(vals) || 0) * 1.1));
    const y = d3.scaleLinear([bot, top], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), (v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${SR.n0(Math.abs(v) * 100)} %`), { noBase: true });
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', SR.col.axis);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0.3)).attr('y2', y(0.3)).style('stroke', SR.col.ref).attr('stroke-dasharray', '4 3');
    SR.cap(svg.append('text').attr('x', W - m.r + 4).attr('y', y(0.3)).attr('dy', '0.32em')).text('+30 %');
    const bw = x.bandwidth();
    const [y0, y1] = y.domain();
    weeks.forEach((w) => {
      if (w.ramp == null) return;
      const v = Math.max(y0, Math.min(y1, w.ramp));
      const x0 = x(w.week);
      const r = Math.min(3, bw / 2);
      if (v >= 0) svg.append('path').attr('d', SR.barPath(x0, y(v), bw, y(0) - y(v), r)).style('fill', col[cls(w)]);
      else {
        const h = y(v) - y(0);
        svg.append('path').attr('d', `M${x0},${y(0)}H${x0 + bw}V${y(0) + h - Math.min(r, h)}Q${x0 + bw},${y(0) + h} ${x0 + bw - Math.min(r, h)},${y(0) + h}H${x0 + Math.min(r, h)}Q${x0},${y(0) + h} ${x0},${y(0) + h - Math.min(r, h)}Z`).style('fill', col[cls(w)]);
      }
      if (w.ramp > y1) svg.append('path').attr('d', `M${x0 + bw / 2 - 4},${m.t + 2}L${x0 + bw / 2},${m.t - 4}L${x0 + bw / 2 + 4},${m.t + 2}Z`).style('fill', col.hot);
    });
    let lastM = -1;
    weeks.forEach((w) => {
      if (w.t.getUTCMonth() !== lastM && w.t.getUTCDate() <= 7) {
        lastM = w.t.getUTCMonth();
        SR.cap(svg.append('text').attr('x', x(w.week)).attr('y', H - m.b + 17)).text(SR.mon(w.t));
      }
    });
    const hit = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.week) - (x.step() - bw) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (w) => ({
      head: `Semaine du ${SR.dshort(w.week)} ${w.t.getUTCFullYear()}`,
      title: `${SR.n1(w.km)} km en ${SR.n0(w.runs)} sortie${w.runs > 1 ? 's' : ''}`,
      rows: [
        { color: col[cls(w)], label: 'Par rapport aux 4 semaines d’avant', value: w.ramp == null ? '—' : `${w.ramp >= 0 ? '+' : '−'}${SR.n0(Math.abs(w.ramp) * 100)} %` },
        { label: 'Moyenne des 4 semaines d’avant', value: w.prev4 == null ? '—' : `${SR.n1(w.prev4)} km` },
      ],
    }));
    enter(box);
  }

  function drawAcwr() {
    const box = $('#c-acwr');
    const d = ready(box, ['acwr']);
    if (!d || !d[0].length) return;
    const rows = d[0].filter((r) => r.ratio != null).map((r) => ({ ...r, t: SR.utc(r.date) }));
    if (!rows.length) return;
    $('#acwr-legend').replaceChildren(legendItem('var(--color-fg)', 'rapport aigu / chronique', 'line'), legendItem('var(--color-fg)', 'compétition', 'diamond'));
    const W = SR.width(box);
    const H = 240;
    const m = { t: 24, r: 40, b: 28, l: 34 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Rapport entre la charge des 7 derniers jours et celle des 28 derniers');
    const tip = SR.tip(box);
    const x = d3.scaleUtc([rows[0].t, rows[rows.length - 1].t], [m.l, W - m.r]);
    const y = d3.scaleLinear([0, Math.max(2, d3.max(rows, (r) => r.ratio) + 0.15)], [H - m.b, m.t]);
    // Zones : progression maîtrisée (0,8 → 1,3) et hausse brutale (au-delà de 1,5).
    svg.append('rect').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', y(1.3)).attr('height', y(0.8) - y(1.3)).style('fill', SR.col.blue).attr('fill-opacity', 0.09);
    svg.append('rect').attr('x', m.l).attr('width', W - m.l - m.r).attr('y', m.t).attr('height', Math.max(0, y(1.5) - m.t)).style('fill', SR.col.orange).attr('fill-opacity', 0.09);
    SR.gridY(svg, y, m.l, W - m.r, [0, 0.5, 1, 1.5, 2].filter((v) => v <= y.domain()[1]), (v) => SR.n1(v), { noBase: false });
    SR.cap(svg.append('text').attr('x', W - m.r + 4).attr('y', y(1.05)).attr('dy', '0.32em')).text('cible');
    SR.cap(svg.append('text').attr('x', W - m.r + 4).attr('y', y(1.5) - 8).attr('dy', '0.32em')).text('risque');
    timeAxis(svg, x, H - m.b);
    svg.append('path').datum(rows).style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 1.8).attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x((r) => x(r.t)).y((r) => y(r.ratio)));
    rows.filter((r) => r.race).forEach((r) => {
      svg.append('path').attr('d', diamond(x(r.t), y(r.ratio) - 9, 4.5)).style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 1.5);
    });
    const last = rows[rows.length - 1];
    svg.append('circle').attr('cx', x(last.t)).attr('cy', y(last.ratio)).attr('r', 4).style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 2);
    const near = d3.bisector((r) => r.t).center;
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    const dot = svg.append('circle').attr('r', 4).style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 2).attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const r = rows[Math.max(0, Math.min(rows.length - 1, near(rows, x.invert(mx))))];
        rule.attr('x1', x(r.t)).attr('x2', x(r.t)).attr('opacity', 1);
        dot.attr('cx', x(r.t)).attr('cy', y(r.ratio)).attr('opacity', 1);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: r.race || null,
          rows: [
            { color: 'var(--color-fg)', line: true, label: 'Rapport aigu / chronique', value: SR.n2(r.ratio) },
            { label: 'Charge des 7 derniers jours', value: SR.n0(r.acute) },
            { label: 'Moyenne hebdo sur 28 jours', value: SR.n0(r.chronic) },
          ],
        }));
      })
      .on('pointerleave', () => {
        rule.attr('opacity', 0);
        dot.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawReprises() {
    const box = $('#c-reprises');
    const d = ready(box, ['reprises']);
    if (!d) return;
    const rows = d[0].slice(0, 6);
    if (!rows.length) {
      empty(box, 'Aucune vraie coupure depuis 2023.');
      return;
    }
    box.replaceChildren(...rows.map((r) => {
      const li = SR.el('li');
      const what = SR.el('div', 'sr-reps__what');
      const m0 = SR.dmonth(r.start).toLowerCase();
      const m1 = r.rec_start ? SR.dmonth(r.rec_start).toLowerCase() : null;
      const same = m1 && m0.slice(-4) === m1.slice(-4);
      const title = m1 && m1 !== m0 ? `${cap1(same ? m0.slice(0, -5) : m0)} → ${m1}` : cap1(m0);
      what.append(SR.el('span', 'sr-reps__title', title));
      const sub = SR.el('span', 'sr-reps__sub');
      sub.append(b(`${SR.n0(r.low_weeks)} semaines`), txt(` à ${SR.n0(r.low_avg)} km (contre ${SR.n0(r.base)} avant)`));
      if (r.back_weeks != null) sub.append(txt(' · retour au volume en '), b(`${SR.n0(r.back_weeks)} semaine${r.back_weeks > 1 ? 's' : ''}`));
      else sub.append(txt(' · reprise en cours'));
      if (r.max_ramp != null) sub.append(txt(' · plus forte hausse '), b(`+${SR.n0(r.max_ramp * 100)} %`));
      what.append(sub);
      // Mini graphique : km de chaque semaine de reprise, repère à 85 % du volume d’avant.
      const ws = r.weeks;
      const w = Math.max(80, ws.length * 16 + 8);
      const h = 44;
      const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h).attr('role', 'img')
        .attr('aria-label', `Km des ${ws.length} semaines de reprise`);
      const ymax = Math.max(r.base, d3.max(ws, (q) => q.km) || 1);
      const yy = d3.scaleLinear([0, ymax], [h - 2, 4]);
      ws.forEach((q, i) => {
        const x0 = 4 + i * 16;
        const hh = yy(0) - yy(q.km);
        if (hh > 0) svg.append('path').attr('d', SR.barPath(x0, yy(q.km), 11, hh, 2)).style('fill', q.ramp != null && q.ramp >= 0.3 ? SR.col.orange : SR.col.blue);
      });
      svg.append('line').attr('x1', 0).attr('x2', w).attr('y1', yy(0.85 * r.base)).attr('y2', yy(0.85 * r.base)).style('stroke', SR.col.ref).attr('stroke-dasharray', '3 2');
      li.append(what, svg.node());
      return li;
    }));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  /* ================= Boucles et segments (Carte) ================= */
  const sketch = (shape, w = 160, h = 104, pad = 10) => {
    const lat0 = d3.mean(shape, (p) => p[0]) * (Math.PI / 180);
    const xs = shape.map((p) => p[1] * Math.cos(lat0));
    const ys = shape.map((p) => p[0]);
    const [x0, x1] = d3.extent(xs);
    const [y0, y1] = d3.extent(ys);
    const k = Math.min((w - 2 * pad) / (x1 - x0 || 1e-6), (h - 2 * pad) / (y1 - y0 || 1e-6));
    const ox = (w - (x1 - x0) * k) / 2;
    const oy = (h - (y1 - y0) * k) / 2;
    const pts = shape.map((p, i) => [ox + (xs[i] - x0) * k, h - (oy + (ys[i] - y0) * k)]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('aria-hidden', 'true');
    svg.append('path').attr('d', d3.line().curve(d3.curveCatmullRom.alpha(0.5))(pts)).style('fill', 'none').style('stroke', SR.col.orange)
      .attr('stroke-width', 2.2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    svg.append('circle').attr('cx', pts[0][0]).attr('cy', pts[0][1]).attr('r', 3.2).style('fill', 'var(--color-panel)').style('stroke', SR.col.orange).attr('stroke-width', 1.8);
    return svg.node();
  };
  const loopName = (l) => l.name || `${l.kind} de ${SR.n1(l.km)} km`;

  function drawLoops() {
    const box = $('#c-loops');
    const d = ready(box, ['loops']);
    if (!d) return;
    const loops = d[0];
    if (!loops.length) {
      empty(box, 'Pas encore de boucle refaite au moins 4 fois.');
      return;
    }
    if (!ui.loop || !loops.some((l) => l.key === ui.loop)) ui.loop = loops[0].key;
    if (box.dataset.n !== String(loops.length) || !box.querySelector('.sr-loop')) {
      box.replaceChildren(...loops.map((l) => {
        const btn = SR.el('button', 'sr-loop');
        btn.type = 'button';
        btn.dataset.key = l.key;
        const sub = SR.el('span', 'sr-loop__sub');
        sub.append(b(`${SR.n0(l.n)} passages`), txt(l.name ? ` · ${SR.n1(l.km)} km` : l.city ? ` · ${l.city}` : ''));
        btn.append(sketch(l.shape), SR.el('span', 'sr-loop__name', loopName(l)), sub);
        btn.addEventListener('click', () => {
          ui.loop = l.key;
          box.querySelectorAll('.sr-loop').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.key === l.key)));
          run(drawLoopDetail);
        });
        return btn;
      }));
      box.dataset.n = String(loops.length);
    }
    box.querySelectorAll('.sr-loop').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.key === ui.loop)));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  // Passages successifs sur un même parcours : allure (plus rapide en haut), couleur selon la FC, tendance en orange.
  const passChart = (box, passes, { valueOf, label, aria, fmt }) => {
    const rows = passes.filter((p) => valueOf(p) != null).map((p) => ({ ...p, t: SR.utc(p.date), v: valueOf(p) }));
    const W = SR.width(box);
    const H = Number(getComputedStyle(box).getPropertyValue('--h').replace('px', '')) || 250;
    const m = { t: 26, r: 14, b: 28, l: 46 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', aria);
    const tip = SR.tip(box);
    const t0 = d3.min(rows, (r) => r.t);
    const t1 = d3.max(rows, (r) => r.t);
    const pad = Math.max(10 * DAY, (t1 - t0) * 0.04);
    const x = d3.scaleUtc([new Date(t0.getTime() - pad), new Date(t1.getTime() + pad)], [m.l, W - m.r]);
    const [v0, v1] = d3.extent(rows, (r) => r.v);
    const span = Math.max(v1 - v0, v1 * 0.04);
    const y = d3.scaleLinear([v1 + span * 0.12, v0 - span * 0.12], [H - m.b, m.t]).nice(4);
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), fmt, { noBase: true });
    unit(svg, m.l - 8, label);
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', 11).attr('text-anchor', 'end')).text('↑ plus rapide');
    timeAxis(svg, x, H - m.b);
    const hrs = rows.map((r) => r.hr).filter(Boolean);
    const ramp = SR.ramp(5);
    const color = hrs.length >= 3 ? d3.scaleQuantize(d3.extent(hrs), ramp) : null;
    // Tendance : médiane glissante sur 7 passages, lissée.
    if (rows.length >= 6) {
      const trend = rows.map((r, i) => {
        const win = rows.slice(Math.max(0, i - 3), Math.min(rows.length, i + 4)).map((q) => q.v).sort((a, c) => a - c);
        return { t: r.t, v: win[Math.floor(win.length / 2)] };
      });
      svg.append('path').datum(trend).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2).attr('stroke-opacity', 0.9)
        .attr('stroke-linejoin', 'round').attr('d', d3.line().curve(d3.curveBasis).x((q) => x(q.t)).y((q) => y(q.v)));
    }
    const best = rows.reduce((a, r) => (!a || r.v < a.v ? r : a), null);
    const dots = svg.append('g').selectAll('circle').data(rows).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.v)).attr('r', (r) => (r === best ? 6.5 : 5))
      .style('fill', (r) => (color && r.hr ? color(r.hr) : SR.col.muted))
      .style('stroke', (r) => (r === best ? 'var(--color-fg)' : SR.col.panel)).attr('stroke-width', (r) => (r === best ? 2 : 1.5));
    rows.filter((r) => r.race).forEach((r) => {
      svg.append('path').attr('d', diamond(x(r.t), y(r.v) - 12, 4)).style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 1.2);
    });
    halo(SR.cap(svg.append('text').attr('x', x(best.t)).attr('y', y(best.v) - 12).attr('text-anchor', x(best.t) > W - 80 ? 'end' : x(best.t) < m.l + 60 ? 'start' : 'middle')))
      .style('fill', 'var(--color-fg)').text(`meilleur : ${fmt(best.v)}`);
    SR.hover(dots, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.race || (r.name && !/^((morning|afternoon|evening|lunch|night) run|course à pied.*)$/i.test(r.name) ? r.name : null),
      rows: [
        { color: color && r.hr ? color(r.hr) : SR.col.muted, label: label === 'allure' ? 'Allure' : 'Temps', value: label === 'allure' ? `${SR.pace(r.v)}/km` : SR.dur(r.v) },
        ...(label !== 'allure' && r.pace_s ? [{ label: 'Allure', value: `${SR.pace(r.pace_s)}/km` }] : []),
        ...(r.hr ? [{ label: 'FC moyenne', value: `${SR.n0(r.hr)} bpm` }] : []),
        ...(r.mpb ? [{ label: 'Mètres par battement', value: SR.n2(r.mpb) }] : []),
      ],
    }));
    return { color, hrs };
  };
  const hrLegend = (el, hrs) => {
    if (hrs.length < 3) {
      el.replaceChildren(legendItem(SR.col.orange, 'tendance', 'line'));
      return;
    }
    const [h0, h1] = d3.extent(hrs);
    const scale = SR.el('span', 'sr-scale');
    SR.ramp(5).forEach((c) => {
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = c;
      scale.append(sw);
    });
    const item = SR.el('span', 'sr-legend__item');
    item.append(txt(`FC ${SR.n0(h0)}`), scale, txt(`${SR.n0(h1)} bpm`));
    el.replaceChildren(item, legendItem(SR.col.orange, 'tendance', 'line'), legendItem('var(--color-fg)', 'meilleur passage', 'ring'));
  };

  function drawLoopDetail() {
    const box = $('#c-loop');
    const d = ready(box, ['loops']);
    if (!d) return;
    const loops = d[0];
    const card = $('#card-loop');
    if (!loops.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const l = loops.find((x) => x.key === ui.loop) || loops[0];
    $('#loop-title').textContent = l.name ? `${l.name} · ${SR.n1(l.km)} km` : `${loopName(l)}${l.city ? ` · ${l.city}` : ''}`;
    $('#loop-note').textContent = `${SR.n0(l.n)} passages depuis ${SR.dmonth(l.first).toLowerCase()} · allure de chaque passage, couleur selon la FC moyenne`;
    const ps = l.passes;
    const withMpb = ps.filter((p) => p.mpb);
    const st = $('#loop-stats');
    const parts = [];
    const s1 = SR.el('span');
    s1.append(txt('Meilleure allure '), b(`${SR.pace(l.best_pace)}/km`), txt(` le ${SR.dmed(l.best_date)}`));
    parts.push(s1);
    if (withMpb.length >= 6) {
      const k = Math.min(5, Math.floor(withMpb.length / 2));
      const a = d3.median(withMpb.slice(0, k), (p) => p.mpb);
      const z = d3.median(withMpb.slice(-k), (p) => p.mpb);
      const s2 = SR.el('span');
      s2.append(txt('Mètres par battement : '), b(SR.n2(a)), txt(' sur les premiers passages, '), b(SR.n2(z)), txt(` sur les derniers (${z >= a ? '+' : '−'}${SR.n0(Math.abs(z / a - 1) * 100)} %)`));
      parts.push(s2);
    }
    st.replaceChildren(...parts);
    const { hrs } = passChart(box, ps, { valueOf: (p) => p.pace_s, label: 'allure', aria: `Allure de chaque passage sur la boucle ${loopName(l)}`, fmt: SR.pace });
    hrLegend($('#loop-legend'), hrs);
    const btn = $('#loop-map');
    btn.onclick = () => SR.mapFocus && SR.mapFocus(l.ids, l.name ? `${l.name} · ${SR.n1(l.km)} km` : loopName(l));
    enter(box);
  }

  function drawSegCoverage() {
    const el = $('#seg-cov');
    const res = dash.data('meta');
    if (!el || res.status !== 'ok' || !res.data[0]) return;
    const mt = res.data[0];
    if (mt.seg_runs == null) return;
    el.textContent = mt.seg_runs >= mt.runs
      ? `Les portions où je passe le plus souvent, d’après les ${SR.n0(mt.runs)} sorties`
      : `Segments connus pour ${SR.n0(mt.seg_runs)} sorties sur ${SR.n0(mt.runs)} (les compétitions d’abord) : l’historique se complète chaque nuit`;
  }

  function drawSegList() {
    const box = $('#c-seglist');
    const d = ready(box, ['seg_top']);
    if (!d) return;
    const segs = d[0];
    if (!segs.length) {
      empty(box, 'Pas encore de segment couru 3 fois : l’historique arrive au fil des nuits.');
      return;
    }
    if (!ui.seg || !segs.some((s) => s.s === ui.seg)) ui.seg = segs[0].s;
    box.replaceChildren(...segs.map((s) => {
      const li = SR.el('li');
      const btn = SR.el('button', 'sr-qbtn');
      btn.type = 'button';
      btn.dataset.id = s.s;
      btn.setAttribute('aria-pressed', String(s.s === ui.seg));
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = SR.col.blue;
      const main = SR.el('span', 'sr-qbtn__main');
      main.append(SR.el('span', 'sr-list__name', s.name), SR.el('span', 'sr-list__sub', `${SR.n0(s.d)} m${s.e >= 5 ? ` · D+ ${SR.n0(s.e)} m` : ''} · ${SR.n0(s.n)} passages`));
      const val = SR.el('span', 'sr-list__value', SR.dur(s.best_t));
      val.append(SR.el('small', null, `${SR.pace(s.best_pace)}/km`));
      btn.append(sw, main, val);
      btn.addEventListener('click', () => {
        ui.seg = s.s;
        box.querySelectorAll('.sr-qbtn').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.id === s.s)));
        run(drawSegDetail);
      });
      li.append(btn);
      return li;
    }));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawSegDetail() {
    const box = $('#c-seg');
    const d = ready(box, ['seg_top']);
    if (!d) return;
    const segs = d[0];
    const card = $('#card-seg');
    if (!segs.length) {
      empty(box, 'Les segments arrivent avec l’historique, au fil des nuits.');
      $('#seg-stats').replaceChildren();
      $('#seg-legend').replaceChildren();
      return;
    }
    card.hidden = false;
    const s = segs.find((x) => x.s === ui.seg) || segs[0];
    $('#seg-title').textContent = s.name;
    $('#seg-note').textContent = `${SR.n0(s.d)} m${s.e >= 5 ? `, D+ ${SR.n0(s.e)} m` : ''} · temps de chaque passage, couleur selon la FC moyenne · losange : en compétition`;
    const st = $('#seg-stats');
    const s1 = SR.el('span');
    s1.append(txt('Meilleur '), b(SR.dur(s.best_t)), txt(` (${SR.pace(s.best_pace)}/km) le ${SR.dmed(s.best_date)}`));
    const s2 = SR.el('span');
    s2.append(txt('Dernier '), b(SR.dur(s.last_t)), txt(` le ${SR.dmed(s.last_date)}`));
    st.replaceChildren(s1, s2);
    const { hrs } = passChart(box, s.passes, { valueOf: (p) => p.t, label: 'temps', aria: `Temps de chaque passage sur le segment ${s.name}`, fmt: SR.dur });
    hrLegend($('#seg-legend'), hrs);
    enter(box);
  }

  /* ================= Récap partageable ================= */
  const SANS = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const SERIF = '"Newsreader", ui-serif, Georgia, "Times New Roman", serif';
  let fontsOk = false;
  const loadFonts = () => {
    if (fontsOk || !document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([document.fonts.load(`400 120px ${SERIF}`), document.fonts.load(`500 120px ${SERIF}`)])
      .then(() => {
        fontsOk = true;
      })
      .catch(() => {
        fontsOk = true;
      });
  };
  let recapToken = 0;
  let recapRow = null;

  function drawRecapControls(rows) {
    const group = $('#recap-period');
    if (group.dataset.keys === rows.map((r) => r.key + r.label).join()) return;
    const short = (r) => (r.kind === 'month' ? cap1(SR.monyear(new Date(Date.UTC(r.year, r.month - 1, 1)))) : String(r.year));
    group.replaceChildren(...rows.map((r) => {
      const btn = SR.el('button', null, short(r));
      btn.type = 'button';
      btn.dataset.v = r.key;
      btn.setAttribute('aria-pressed', String(r.key === ui.period));
      return btn;
    }));
    group.dataset.keys = rows.map((r) => r.key + r.label).join();
  }
  $('#recap-period').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]');
    if (!btn) return;
    ui.period = btn.dataset.v;
    $('#recap-period').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
    run(drawRecap);
  });

  function drawRecap() {
    const canvas = $('#c-recap');
    const res = dash.data('recap');
    const mr = dash.data('map_runs');
    if (res.status === 'error') {
      canvas.classList.remove('dash-skeleton');
      return;
    }
    if (res.status !== 'ok' || !res.data.length) return;
    const rows = res.data;
    if (!ui.period) {
      const m0 = rows.find((r) => r.key === 'month');
      ui.period = m0 && m0.runs >= 3 ? 'month' : 'prevmonth';
    }
    drawRecapControls(rows);
    const row = rows.find((r) => r.key === ui.period) || rows[0];
    recapRow = row;
    const routes = mr.status === 'ok' ? mr.data : null;
    const token = ++recapToken;
    loadFonts().then(() => {
      if (token !== recapToken) return;
      paintRecap(canvas, row, routes);
      canvas.classList.remove('dash-skeleton');
      canvas.setAttribute('aria-label', `Récap ${row.label} : ${SR.n0(row.km)} km en ${SR.n0(row.runs)} sorties`);
      enter(canvas);
    });
  }

  const decode = (str) => {
    const pts = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    const next = () => {
      let bb;
      let shift = 0;
      let res = 0;
      do {
        bb = str.charCodeAt(i++) - 63;
        res |= (bb & 0x1f) << shift;
        shift += 5;
      } while (bb >= 0x20 && i < str.length);
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
  const decoded = new Map();

  function paintRecap(canvas, row, routes) {
    const ctx = canvas.getContext('2d');
    const W = 1080;
    const H = 1920;
    const P = 84;
    const ORANGE = '#f0743c';
    const ORANGE_SOFT = 'rgba(240, 116, 60, .22)';
    const INK = '#f4f2ee';
    const MUTED = 'rgba(244, 242, 238, .58)';
    const FAINT = 'rgba(244, 242, 238, .12)';
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    // Fond : nuit profonde, halo orange en haut à droite, bleu en bas à gauche.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#141412');
    bg.addColorStop(1, '#0a0a09');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, c) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W * 0.95, 120, 820, 'rgba(240, 116, 60, .26)');
    glow(0, H * 0.92, 760, 'rgba(57, 135, 229, .14)');
    const font = (w, s, fam) => `${w} ${s}px ${fam}`;
    const textW = (s) => ctx.measureText(s).width;
    const fit = (s, max) => {
      if (textW(s) <= max) return s;
      let t = s;
      while (t.length > 1 && textW(`${t}…`) > max) t = t.slice(0, -1);
      return `${t.trimEnd()}…`;
    };
    ctx.textBaseline = 'alphabetic';
    // En-tête.
    ctx.fillStyle = ORANGE;
    ctx.font = font(600, 28, SANS);
    const eyebrow = row.kind === 'month' ? 'MON MOIS DE COURSE' : 'MON ANNÉE DE COURSE';
    ctx.letterSpacing = '6px';
    ctx.fillText(eyebrow, P, 170);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = INK;
    ctx.font = font(400, 118, SERIF);
    ctx.fillText(cap1(row.label), P - 4, 300);
    // Chiffre clé.
    ctx.font = font(400, 300, SERIF);
    const kmTxt = SR.n0(row.km);
    ctx.fillText(kmTxt, P - 10, 590);
    const kw = textW(kmTxt);
    ctx.font = font(500, 64, SANS);
    ctx.fillStyle = MUTED;
    ctx.fillText('km', P + kw + 6, 590);
    // Comparaison avec un an plus tôt.
    if (row.cmp_km > 0) {
      const delta = row.km / row.cmp_km - 1;
      ctx.font = font(500, 32, SANS);
      const lead = `${delta >= 0 ? '+' : '−'}${SR.n0(Math.abs(delta) * 100)} %`;
      ctx.fillStyle = delta >= 0 ? ORANGE : INK;
      ctx.fillText(lead, P, 660);
      ctx.fillStyle = MUTED;
      ctx.fillText(` par rapport à ${row.cmp_label}${row.partial ? ' à la même date' : ''}`, P + textW(lead), 660);
    }
    // Quatre chiffres.
    const stats = [
      [SR.n0(row.runs), row.runs > 1 ? 'sorties' : 'sortie'],
      [row.hours >= 100 ? `${SR.n0(row.hours)} h` : SR.hm(row.hours * 3600), 'de course'],
      [row.elev >= 10000 ? `${SR.n1(row.elev / 1000)} km` : `${SR.n0(row.elev)} m`, 'de D+'],
      [row.pace_s ? `${SR.pace(row.pace_s)}` : '—', 'allure moyenne'],
    ];
    const colW = (W - 2 * P) / 4;
    stats.forEach(([v, l], i) => {
      const x = P + i * colW;
      ctx.fillStyle = INK;
      let fs = 60;
      ctx.font = font(400, fs, SERIF);
      while (fs > 40 && textW(v) > colW - 18) {
        fs -= 2;
        ctx.font = font(400, fs, SERIF);
      }
      ctx.fillText(fit(v, colW - 16), x, 790);
      ctx.fillStyle = MUTED;
      ctx.font = font(500, 26, SANS);
      ctx.fillText(fit(l, colW - 16), x, 832);
    });
    // Carte de chaleur des parcours de la période.
    const mapY = 880;
    const mapH = 480;
    const rr = 28;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(P, mapY, W - 2 * P, mapH, rr);
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    const ids = new Set(row.ids);
    const list = routes ? routes.filter((r) => ids.has(r.id)) : [];
    if (list.length) {
      const tracks = list.map((r) => {
        if (!decoded.has(r.id)) decoded.set(r.id, decode(r.p));
        return decoded.get(r.id);
      }).filter((p) => p.length > 1);
      // Cadre : la zone où partent le plus de sorties (case de 0,1°), pour qu’un voyage n’écrase pas la carte.
      const key = (p) => `${Math.round(p[0] * 10)}|${Math.round(p[1] * 10)}`;
      const count = new Map();
      tracks.forEach((p) => count.set(key(p[0]), (count.get(key(p[0])) || 0) + 1));
      const top = [...count.entries()].sort((a, c) => c[1] - a[1])[0][0].split('|').map((v) => Number(v) / 10);
      const near = tracks.filter((p) => Math.abs(p[0][0] - top[0]) < 0.3 && Math.abs(p[0][1] - top[1]) < 0.45);
      const lats = [];
      const lngs = [];
      near.forEach((p) => p.forEach((q, i) => {
        if (i % 2 === 0) {
          lats.push(q[0]);
          lngs.push(q[1]);
        }
      }));
      lats.sort((a, c) => a - c);
      lngs.sort((a, c) => a - c);
      const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
      const cut = near.length > 40 ? 0.03 : 0.005;
      const s = q(lats, cut);
      const n = q(lats, 1 - cut);
      const w = q(lngs, cut);
      const e = q(lngs, 1 - cut);
      const cos = Math.cos(((s + n) / 2) * (Math.PI / 180));
      const bw = W - 2 * P - 80;
      const bh = mapH - 80;
      const k = Math.min(bw / ((e - w) * cos || 1e-6), bh / ((n - s) || 1e-6));
      const cx = P + (W - 2 * P) / 2;
      const cy = mapY + mapH / 2;
      const mx = (w + e) / 2;
      const my = (s + n) / 2;
      const X = (lng) => cx + (lng - mx) * cos * k;
      const Y = (lat) => cy - (lat - my) * k;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = row.kind === 'year' ? 'rgba(240, 116, 60, .30)' : 'rgba(240, 116, 60, .55)';
      ctx.lineWidth = row.kind === 'year' ? 3 : 4;
      tracks.forEach((p) => {
        ctx.beginPath();
        p.forEach((pt, i) => (i ? ctx.lineTo(X(pt[1]), Y(pt[0])) : ctx.moveTo(X(pt[1]), Y(pt[0]))));
        ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.fillStyle = MUTED;
    ctx.font = font(500, 24, SANS);
    const placeTxt = list.length ? `${SR.n0(list.length)} parcours · ${SR.n0(row.days)} jours de course` : routes ? `${SR.n0(row.days)} jours de course` : 'Parcours en cours de chargement';
    ctx.fillText(placeTxt, P, mapY + mapH + 44);
    // Barres : km par jour (mois) ou par mois (année).
    const barsY = 1468;
    const barsH = 132;
    const ser = row.series;
    const maxKm = Math.max(1, ...ser.map((x) => x.km));
    const gap = row.kind === 'month' ? 6 : 14;
    const bwid = (W - 2 * P - gap * (ser.length - 1)) / ser.length;
    ser.forEach((x, i) => {
      const bx = P + i * (bwid + gap);
      const h = (x.km / maxKm) * barsH;
      ctx.fillStyle = x.future ? FAINT : x.km > 0 ? ORANGE : 'rgba(244,242,238,.10)';
      const hh = x.km > 0 ? Math.max(6, h) : 4;
      ctx.beginPath();
      ctx.roundRect(bx, barsY + barsH - hh, bwid, hh, Math.min(6, bwid / 2));
      ctx.fill();
    });
    ctx.fillStyle = MUTED;
    ctx.font = font(500, 22, SANS);
    ser.forEach((x, i) => {
      const show = row.kind === 'year' || i === 0 || (i + 1) % 5 === 0;
      if (!show) return;
      const bx = P + i * (bwid + gap) + bwid / 2;
      const lbl = x.label;
      ctx.fillText(lbl, bx - textW(lbl) / 2, barsY + barsH + 32);
    });
    // Temps forts.
    const lines = [];
    row.races.slice().sort((a, c) => Number(c.pr) - Number(a.pr) || c.date.localeCompare(a.date)).slice(0, 2).forEach((r) => {
      lines.push([r.event, `${SR.dur(r.time_s)}${r.pr ? ' · record' : ''}${r.place ? ` · ${r.place}` : ''}`, r.pr]);
    });
    if (row.long_km && lines.length < 3) lines.push(['Plus longue sortie', `${SR.n1(row.long_km)} km`, false]);
    if (row.fast_pace && lines.length < 3) lines.push(['Sortie la plus rapide', `${SR.pace(row.fast_pace)}/km sur ${SR.n1(row.fast_km)} km`, false]);
    let ly = 1706;
    lines.slice(0, 3).forEach(([l, v, hot]) => {
      ctx.fillStyle = hot ? ORANGE : 'rgba(244,242,238,.35)';
      ctx.beginPath();
      ctx.arc(P + 8, ly - 10, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(500, 32, SANS);
      ctx.fillStyle = INK;
      const vw = (ctx.font = font(500, 32, SANS), textW(v));
      ctx.fillText(fit(l, W - 2 * P - vw - 70), P + 32, ly);
      ctx.fillText(v, W - P - vw, ly);
      ly += 52;
    });
    // Pied.
    ctx.fillStyle = MUTED;
    ctx.font = font(500, 24, SANS);
    ctx.fillText('sillage.alexandrebarreau.fr', P, H - 48);
    const asof = row.partial ? `au ${SR.dshort(row.end)}` : 'Données Strava';
    ctx.fillText(asof, W - P - textW(asof), H - 48);
    ctx.restore();
  }

  const recapFile = () => new Promise((resolve) => {
    const canvas = $('#c-recap');
    canvas.toBlob((blob) => {
      const name = `sillage-${(recapRow ? recapRow.label : 'recap').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').toLowerCase()}.png`;
      resolve(blob ? new File([blob], name, { type: 'image/png' }) : null);
    }, 'image/png');
  });
  const download = (file) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  $('#recap-share').addEventListener('click', async () => {
    const file = await recapFile();
    if (!file) return;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mon récap Sillage' });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    download(file);
  });
  $('#recap-dl').addEventListener('click', async () => {
    const file = await recapFile();
    if (file) download(file);
  });
  if (!(navigator.canShare && navigator.share)) {
    $('#recap-share').textContent = 'Télécharger l’image';
    $('#recap-dl').hidden = true;
  }

  /* ================= Branchement ================= */
  SR.pages = SR.pages || {};
  const add = (page, fns) => {
    SR.pages[page] = (SR.pages[page] || []).concat(fns);
  };
  add('objectif', [drawGoalPlan]);
  add('entrainement', [drawChargeTiles, drawRamp, drawAcwr, drawReprises]);
  add('competitions', [drawPaceCoverage, drawPaceSplit, drawRaceKm]);
  add('carte', [drawLoops, drawLoopDetail, drawSegCoverage, drawSegList, drawSegDetail]);
  add('recap', [drawRecap]);
})();
