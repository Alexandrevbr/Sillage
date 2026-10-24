/* Tableau de bord : navigation, graphiques et tableaux. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const ui = {
    page: 'apercu',
    weekMetric: 'km',
    weekRange: 'all',
    calYear: null,
    mixBy: 'km',
    sortYears: { k: 'year', dir: -1 },
    sortRaces: { k: 'date', dir: -1 },
    raceQuery: '',
  };
  const DAY = 864e5;
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
    const card = el && el.closest('.sr-card, .sr-record, .sr-records-grid');
    if (!card || entered.has(card)) return;
    entered.add(card);
    card.style.animationDelay = `${(entered.size % 6) * 40}ms`;
    card.classList.add('sr-enter');
  };
  const cmp = (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
    return typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b), 'fr') : a - b;
  };
  const legendItem = (color, label, kind = '') => {
    const item = SR.el('span', 'sr-legend__item');
    const sw = SR.el('i', `sr-sw${kind ? ` sr-sw--${kind}` : ''}`);
    if (kind !== 'ring') sw.style.background = color;
    item.append(sw, document.createTextNode(label));
    return item;
  };
  const halo = (sel) => sel.attr('paint-order', 'stroke').style('stroke', 'var(--color-panel)').attr('stroke-width', 4).attr('stroke-linejoin', 'round');
  const mondayOf = (day) => day - ((new Date(day * DAY).getUTCDay() + 6) % 7);
  const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const failRow = (tbody, cols) => {
    const tr = document.createElement('tr');
    const td = SR.el('td');
    td.colSpan = cols;
    td.append(SR.el('div', 'sr-failed', 'Failed to load'));
    tr.append(td);
    tbody.replaceChildren(tr);
  };
  const tableState = (table, id) => {
    const res = dash.data(id);
    const tbody = table.tBodies[0];
    if (res.status === 'error') {
      failRow(tbody, table.tHead.rows[0].cells.length);
      return null;
    }
    if (res.status !== 'ok' || !Array.isArray(res.data)) {
      if (!tbody.children.length) tbody.classList.add('dash-skeleton');
      return null;
    }
    tbody.classList.remove('dash-skeleton');
    return res.data;
  };
  const sortHeaders = (table, sort) => {
    table.querySelectorAll('th').forEach((th) => {
      const b = th.querySelector('.sr-th-btn');
      if (!b) return;
      th.setAttribute('aria-sort', b.dataset.k === sort.k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
  };
  const nextSort = (sort, k, ascFirst) => (sort.k === k ? { k, dir: -sort.dir } : { k, dir: ascFirst.includes(k) ? 1 : -1 });

  /* ================= Navigation ================= */
  const tabs = [...root.querySelectorAll('.sr-tab')];
  const pages = tabs.map((t) => t.dataset.page);
  const applyPage = (page) => {
    ui.page = page;
    tabs.forEach((t) => {
      const on = t.dataset.page === page;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    pages.forEach((p) => {
      const el = document.getElementById(p);
      const was = el.hidden;
      el.hidden = p !== page;
      // Fondu léger à chaque changement d’onglet.
      if (p === page && was) {
        el.classList.remove('is-in');
        void el.offsetWidth;
        el.classList.add('is-in');
      }
    });
    // L’onglet actif reste visible dans la barre (elle défile à l’horizontale sur téléphone).
    const bar = tabs[0] && tabs[0].parentElement;
    const on = tabs[pages.indexOf(page)];
    if (bar && on && bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: Math.max(0, on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2), behavior: 'smooth' });
    }
  };
  const select = (page, focus) => {
    if (!pages.includes(page)) return;
    applyPage(page);
    if (focus) tabs[pages.indexOf(page)].focus();
    dash.setLink(page);
    draw();
  };
  // Après un changement d’onglet, la page commence en haut (sous la barre d’onglets) plutôt qu’au milieu.
  const toTop = (smooth) => {
    // La barre d’onglets colle en haut : on vise le bas de l’en-tête, juste au-dessus d’elle.
    const head = $('.sr-top');
    const y = head ? head.getBoundingClientRect().bottom + window.scrollY : 0;
    if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  };
  // Liens internes vers un onglet (cartes « En ce moment » de l’accueil).
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a || !pages.includes(a.dataset.goto)) return;
    e.preventDefault();
    select(a.dataset.goto, false);
    toTop(true);
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => {
      select(t.dataset.page, false);
      toTop(false);
    });
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      select(pages[(i + step + pages.length) % pages.length], true);
    });
  });
  let pendingScroll = null;
  const named = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  const namedPage = named && named.closest('.sr-page');
  if (namedPage && root.contains(namedPage)) {
    applyPage(namedPage.id);
    if (named !== namedPage) pendingScroll = named;
  }

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

  /* ================= Vue d’ensemble ================= */
  function drawYears() {
    const box = $('#c-years');
    const d = SR.ready(box, ['by_year']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const cur = d3.max(rows, (r) => r.year);
    const W = SR.width(box);
    const H = 270;
    const m = { t: 28, r: 4, b: 46, l: 4 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Kilomètres par année');
    const tip = SR.tip(box);
    const x = d3.scaleBand(rows.map((r) => r.year), [m.l, W - m.r]).paddingInner(0.3).paddingOuter(0.12);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.km) * 1.04], [H - m.b, m.t]);
    const bw = Math.min(40, x.bandwidth());
    const cxOf = (r) => x(r.year) + x.bandwidth() / 2;
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0))
      .style('stroke', SR.col.axis).attr('shape-rendering', 'crispEdges');
    const bars = svg.append('g').selectAll('path').data(rows).join('path')
      .attr('d', (r) => SR.barPath(cxOf(r) - bw / 2, y(r.km), bw, y(0) - y(r.km), 4))
      .style('fill', (r) => (r.year === cur ? SR.col.orange : SR.col.blue));
    svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cxOf).attr('y', (r) => y(r.km) - 8).attr('text-anchor', 'middle')
      .style('font-size', 'var(--cds-font-size-body)').style('font-variant-numeric', 'tabular-nums')
      .style('fill', 'var(--color-fg)').text((r) => SR.n0(r.km));
    svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cxOf).attr('y', H - m.b + 19).attr('text-anchor', 'middle')
      .style('font-size', 'var(--cds-font-size-body)')
      .style('font-weight', (r) => (r.year === cur ? 'var(--cds-font-weight-medium)' : null))
      .style('fill', 'var(--color-fg)').text((r) => String(r.year));
    if (x.step() >= 62) {
      SR.cap(svg.append('g').selectAll('text').data(rows).join('text')
        .attr('x', cxOf).attr('y', H - m.b + 36).attr('text-anchor', 'middle'))
        .text((r) => `${SR.n0(r.runs)} sortie${r.runs > 1 ? 's' : ''}`);
    }
    const hits = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.year)).attr('y', m.t - 20).attr('width', x.bandwidth())
      .attr('height', H - m.t + 20 - 4).style('fill', 'transparent')
      .attr('aria-label', (r) => `${r.year} : ${SR.n0(r.km)} km`);
    SR.hover(hits, box, tip, (r) => ({
      head: r.year === cur ? `${r.year} · en cours` : String(r.year),
      rows: [
        { label: 'Distance', value: `${SR.n0(r.km)} km` },
        { label: 'Sorties', value: SR.n0(r.runs) },
        { label: 'Temps', value: `${SR.n0(r.hours)} h` },
        { label: 'Dénivelé', value: `${SR.n0(r.elev_m)} m` },
        { label: 'Allure moyenne', value: `${SR.pace(r.pace_s)}/km` },
        { label: 'Plus longue', value: `${SR.n1(r.longest_km)} km` },
      ],
    }), (e, r) => bars.attr('opacity', (b) => (b.year === r.year ? 1 : 0.4)), () => bars.attr('opacity', 1));
    enter(box);
  }

  function drawYtd() {
    const box = $('#c-ytd');
    const d = SR.ready(box, ['ytd']);
    if (!d || !d[0].length) return;
    const all = d[0];
    const cur = d3.max(all, (r) => r.year);
    const rows = all.filter((r) => r.km > 0 && r.year >= cur - 3).sort((a, b) => b.year - a.year);
    const max = d3.max(rows, (r) => r.km) || 1;
    const wrap = SR.el('div', 'sr-bars');
    rows.forEach((r) => {
      const row = SR.el('div', 'sr-barrow');
      const track = SR.el('div', 'sr-barrow__track');
      const fill = SR.el('div', 'sr-barrow__fill');
      fill.style.width = `${(r.km / max) * 100}%`;
      fill.style.background = SR.yearColor(r.year, cur);
      track.append(fill);
      const val = SR.el('span', 'sr-barrow__value');
      val.append(SR.mark(SR.el('span', null, SR.n0(r.km)), 'ytd', 'km', `year=${r.year}`), SR.el('small', null, 'km'));
      row.append(SR.el('span', 'sr-barrow__label', String(r.year)), track, val);
      d3.select(row).datum(r);
      wrap.append(row);
    });
    box.replaceChildren(wrap);
    const now = rows.find((r) => r.year === cur);
    if (now && now.vs_prev != null) {
      const p = SR.el('p', 'sr-calsum');
      p.style.marginTop = '16px';
      p.append(
        document.createTextNode(`${cur} : `),
        SR.mark(SR.el('b', null, SR.spct(now.vs_prev)), 'ytd', 'vs_prev', `year=${cur}`),
        document.createTextNode(` par rapport à ${cur - 1} à la même date`),
      );
      box.append(p);
    }
    const tip = SR.tip(box);
    SR.hover(d3.select(wrap).selectAll('.sr-barrow'), box, tip, (r) => ({
      head: `${r.year}, du 1er janvier au ${SR.dshort(r.as_of)}`,
      rows: [
        { label: 'Distance', value: `${SR.n0(r.km)} km` },
        { label: 'Sorties', value: SR.n0(r.runs) },
      ],
    }));
    enter(box);
  }

  function drawCumul() {
    const box = $('#c-cumul');
    const d = SR.ready(box, ['cumul']);
    if (!d || !d[0].length) return;
    const pts = d[0];
    const byYear = d3.group(pts, (p) => p.year);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const cur = d3.max(years);
    const maxKm = d3.max(pts, (p) => p.km) || 1;
    const ends = years.map((yr) => {
      const a = byYear.get(yr);
      return { year: yr, doy: a[a.length - 1].doy, km: a[a.length - 1].km };
    });
    const shown = ends.filter((e) => e.km >= maxKm * 0.04);
    const shownYears = new Set(shown.map((e) => e.year));
    $('#cumul-legend').replaceChildren(...[...shown].sort((a, b) => b.year - a.year)
      .map((e) => legendItem(SR.yearColor(e.year, cur), String(e.year), 'line')));
    const W = SR.width(box);
    const H = 320;
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Kilomètres cumulés par année');
    const tip = SR.tip(box);
    const narrow = W < 560;
    const label = (e) => `${e.year} · ${SR.n0(e.km)} km`;
    const done = shown.filter((e) => e.year !== cur);
    const lw = narrow ? 0 : d3.max(done, (e) => SR.textWidth(svg, label(e))) || 0;
    const m = { t: 14, r: narrow ? 10 : lw + 18, b: 28, l: 50 };
    const x = d3.scaleLinear([0, 366], [m.l, W - m.r]);
    const y = d3.scaleLinear([0, maxKm * 1.04], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    const starts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const every = W < 430 ? 3 : W < 700 ? 2 : 1;
    starts.forEach((doy, i) => {
      if (i % every) return;
      SR.cap(svg.append('text').attr('x', x(doy) + 2).attr('y', H - m.b + 18).attr('text-anchor', 'start'))
        .text(SR.mon(new Date(Date.UTC(2001, i, 1))));
    });
    const line = d3.line().x((p) => x(p.doy)).y((p) => y(p.km));
    [...years].sort((a, b) => SR.yearRank(a, cur) - SR.yearRank(b, cur)).forEach((yr) => {
      const rank = SR.yearRank(yr, cur);
      svg.append('path').datum(byYear.get(yr)).style('fill', 'none')
        .style('stroke', SR.yearColor(yr, cur)).attr('stroke-width', rank === 3 ? 2.5 : rank > 0 ? 2 : 1.5)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line);
    });
    shown.forEach((e) => {
      svg.append('circle').attr('cx', x(e.doy)).attr('cy', y(e.km)).attr('r', 3.5)
        .style('fill', SR.yearColor(e.year, cur)).style('stroke', SR.col.panel).attr('stroke-width', 2);
    });
    const nowEnd = shown.find((e) => e.year === cur);
    if (nowEnd) {
      halo(svg.append('text').attr('x', x(nowEnd.doy) + 9).attr('y', y(nowEnd.km)).attr('dy', '0.32em')
        .style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)')
        .style('fill', 'var(--color-fg)')).text(narrow ? SR.n0(nowEnd.km) : label(nowEnd));
    }
    if (!narrow) {
      SR.spread(done.map((e) => ({ ...e, ly: y(e.km) })), 'ly', 15, m.t + 4, H - m.b - 4).forEach((e) => {
        SR.cap(svg.append('text').attr('x', W - m.r + 9).attr('y', e.ly).attr('dy', '0.32em')).text(label(e));
      });
    }
    // Survol : règle verticale et valeur de chaque année à la même date.
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    const dots = svg.append('g');
    const valueAt = (yr, doy) => {
      const a = byYear.get(yr);
      if (doy > a[a.length - 1].doy) return null;
      const i = d3.bisector((p) => p.doy).right(a, doy) - 1;
      return i >= 0 ? a[i].km : 0;
    };
    const hide = () => {
      rule.attr('opacity', 0);
      dots.selectAll('*').remove();
      tip.hide();
    };
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const doy = Math.max(1, Math.min(366, Math.round(x.invert(mx))));
        const vals = years.filter((yr) => shownYears.has(yr))
          .map((yr) => ({ yr, v: valueAt(yr, doy) })).filter((o) => o.v != null)
          .sort((a, b) => b.yr - a.yr);
        rule.attr('x1', x(doy)).attr('x2', x(doy)).attr('opacity', 1);
        dots.selectAll('circle').data(vals).join('circle').attr('cx', x(doy)).attr('cy', (o) => y(o.v)).attr('r', 4)
          .style('fill', (o) => SR.yearColor(o.yr, cur)).style('stroke', SR.col.panel).attr('stroke-width', 2);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: `Au ${SR.dshort(isoOf(Date.UTC(cur, 0, 1) / DAY + doy - 1))}`,
          rows: vals.map((o) => ({ color: SR.yearColor(o.yr, cur), line: true, label: String(o.yr), value: `${SR.n0(o.v)} km` })),
        }));
      })
      .on('pointerleave', hide);
    enter(box);
  }

  function drawWeeks() {
    const box = $('#c-weeks');
    const d = SR.ready(box, ['by_week', 'race_results']);
    if (!d || !d[0].length) return;
    const [all, races] = d;
    const n = ui.weekRange === 'all' ? all.length : Math.min(all.length, Number(ui.weekRange));
    const weeks = all.slice(all.length - n);
    const key = ui.weekMetric;
    const avgKey = `${key}_avg4`;
    const fmt = {
      km: (v) => `${SR.n1(v)} km`,
      hours: (v) => SR.hm(v * 3600),
      runs: (v) => SR.n1(v),
    }[key];
    const W = SR.width(box);
    const H = 300;
    const m = { t: 24, r: 8, b: 28, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Volume par semaine');
    const tip = SR.tip(box);
    const step = (W - m.l - m.r) / weeks.length;
    const xL = (i) => m.l + i * step;
    const vmax = d3.max(weeks, (w) => Math.max(w[key], w[avgKey])) || 1;
    const y = d3.scaleLinear([0, vmax * 1.06], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), key === 'hours' ? (t) => `${SR.n0(t)} h` : SR.n0);
    const gap = step >= 7 ? 2 : step >= 4 ? 1 : 0;
    const bw = Math.min(32, step - gap);
    if (step >= 3) {
      svg.append('g').selectAll('path').data(weeks).join('path')
        .attr('d', (w, i) => SR.barPath(xL(i) + (step - bw) / 2, y(w[key]), bw, y(0) - y(w[key]), Math.min(4, bw / 2)))
        .style('fill', SR.col.blue);
    } else {
      const area = d3.area().curve(d3.curveStepAfter).x((p) => p.x).y0(y(0)).y1((p) => y(p.v));
      const stepPts = weeks.map((w, i) => ({ x: xL(i), v: w[key] }));
      stepPts.push({ x: xL(weeks.length), v: weeks[weeks.length - 1][key] });
      svg.append('path').datum(stepPts).style('fill', SR.col.blue).attr('fill-opacity', 0.85).attr('d', area);
    }
    svg.append('path').datum(weeks).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x((w, i) => xL(i) + step / 2).y((w) => y(w[avgKey])));
    // Graduations : années (ou mois sur 12 mois).
    const byMonth = n <= 60;
    let last = -Infinity;
    weeks.forEach((w, i) => {
      const prev = weeks[i - 1];
      const keyNow = byMonth ? w.week.slice(0, 7) : w.week.slice(0, 4);
      if (prev && keyNow === (byMonth ? prev.week.slice(0, 7) : prev.week.slice(0, 4))) return;
      if (xL(i) - last < (byMonth ? 54 : 46)) return;
      last = xL(i);
      const date = SR.utc(w.week);
      svg.append('line').attr('x1', xL(i)).attr('x2', xL(i)).attr('y1', y(0)).attr('y2', y(0) + 5).style('stroke', SR.col.axis);
      SR.cap(svg.append('text').attr('x', xL(i) + 3).attr('y', H - m.b + 18).attr('text-anchor', 'start'))
        .text(byMonth ? (date.getUTCMonth() === 0 ? String(date.getUTCFullYear()) : SR.mon(date)) : String(date.getUTCFullYear()));
    });
    // Compétitions.
    const index = new Map(weeks.map((w, i) => [w.week, i]));
    const marks = races.map((r) => ({ ...r, i: index.get(isoOf(mondayOf(r.day))) })).filter((r) => r.i != null);
    const diamond = d3.symbol(d3.symbolDiamond, 42);
    const marker = svg.append('g').selectAll('path').data(marks).join('path')
      .attr('transform', (r) => `translate(${xL(r.i) + step / 2},${m.t - 13})`).attr('d', diamond)
      .style('fill', 'var(--color-fg)').style('stroke', SR.col.panel).attr('stroke-width', 1.5)
      .style('pointer-events', 'none');
    // Survol.
    const band = svg.insert('rect', ':first-child').attr('y', m.t).attr('height', H - m.t - m.b)
      .style('fill', 'var(--color-fg)').attr('opacity', 0);
    svg.append('rect').attr('x', m.l).attr('y', m.t - 22).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b + 22)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const i = Math.max(0, Math.min(weeks.length - 1, Math.floor((mx - m.l) / step)));
        const w = weeks[i];
        band.attr('x', xL(i)).attr('width', Math.max(step, 2)).attr('opacity', 0.06);
        const rs = marks.filter((r) => r.i === i);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: `Semaine du ${SR.dmed(w.week)}`,
          title: rs.map((r) => `${r.event} · ${SR.dur(r.time_s)}`).join(' / ') || null,
          rows: [
            { color: SR.col.blue, label: 'Distance', value: `${SR.n1(w.km)} km` },
            { label: 'Temps', value: SR.hm(w.hours * 3600) },
            { label: 'Sorties', value: SR.n0(w.runs) },
            { color: SR.col.orange, line: true, label: 'Moyenne 4 sem.', value: fmt(w[avgKey]) },
          ],
        }));
      })
      .on('pointerleave', () => {
        band.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function drawCalendar() {
    const box = $('#c-calendar');
    const d = SR.ready(box, ['by_day', 'by_year']);
    if (!d || !d[1].length) return;
    const [days, years] = d;
    const ys = years.map((r) => r.year).sort((a, b) => b - a);
    if (ui.calYear == null || !ys.includes(ui.calYear)) ui.calYear = ys[0];
    const yr = ui.calYear;
    const chips = $('#cal-years');
    chips.replaceChildren(...ys.map((v) => {
      const b = SR.el('button', 'sr-chip', String(v));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === yr));
      b.addEventListener('click', () => {
        ui.calYear = v;
        run(drawCalendar);
      });
      return b;
    }));
    const map = new Map(days.filter((x) => x.year === yr).map((x) => [x.date, x]));
    const jan1 = Date.UTC(yr, 0, 1) / DAY;
    const ndays = (Date.UTC(yr + 1, 0, 1) - Date.UTC(yr, 0, 1)) / DAY;
    const off = (new Date(jan1 * DAY).getUTCDay() + 6) % 7;
    const ncol = Math.ceil((ndays + off) / 7);
    const lastDay = d3.max(days, (x) => x.day);
    const W = SR.width(box);
    const left = W < 480 ? 2 : 30;
    const top = 18;
    const cs = Math.max(5, Math.min(17, Math.floor((W - left - 2) / ncol)));
    const gap = cs >= 12 ? 3 : cs >= 8 ? 2 : 1;
    const H = top + 7 * cs + 2;
    box.style.setProperty('--h', `${H}px`);
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', `Calendrier ${yr}`);
    const tip = SR.tip(box);
    const ramp = SR.ramp(5);
    const lims = [5, 10, 15, 21];
    const color = (km) => ramp[d3.bisectRight(lims, km)];
    const cells = d3.range(ndays).map((i) => {
      const day = jan1 + i;
      const pos = i + off;
      return { day, iso: isoOf(day), col: Math.floor(pos / 7), row: pos % 7, v: map.get(isoOf(day)), future: day > lastDay };
    });
    const size = cs - gap;
    svg.append('g').selectAll('rect').data(cells).join('rect')
      .attr('x', (c) => left + c.col * cs).attr('y', (c) => top + c.row * cs)
      .attr('width', size).attr('height', size).attr('rx', Math.min(3, size / 3))
      .style('fill', (c) => (c.future ? 'transparent' : c.v ? color(c.v.km) : SR.col.grid))
      .style('stroke', (c) => (c.future ? SR.col.grid : null));
    // Mois en clair si un mois fait au moins ~36 px de large, sinon leur initiale.
    const fullMonths = cs >= 9;
    let prevCol = -9;
    for (let mo = 0; mo < 12; mo++) {
      const col = Math.floor((Date.UTC(yr, mo, 1) / DAY - jan1 + off) / 7);
      if (col - prevCol < 3) continue;
      prevCol = col;
      const name = SR.mon(new Date(Date.UTC(yr, mo, 1)));
      SR.cap(svg.append('text').attr('x', left + col * cs).attr('y', top - 6)).text(fullMonths ? name : name.charAt(0).toUpperCase());
    }
    if (left >= 24 && cs >= 9) {
      [['lun.', 0], ['mer.', 2], ['ven.', 4]].forEach(([t, r]) => {
        SR.cap(svg.append('text').attr('x', left - 6).attr('y', top + r * cs + size / 2).attr('dy', '0.32em').attr('text-anchor', 'end')).text(t);
      });
    }
    const focus = svg.append('rect').attr('width', size + 2).attr('height', size + 2).attr('rx', Math.min(4, size / 2))
      .style('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 1.5).attr('opacity', 0);
    svg.on('pointermove', (event) => {
      const [mx, my] = d3.pointer(event, svg.node());
      const col = Math.floor((mx - left) / cs);
      const row = Math.floor((my - top) / cs);
      const c = cells[col * 7 + row - off];
      if (row < 0 || row > 6 || !c || c.col !== col) {
        focus.attr('opacity', 0);
        tip.hide();
        return;
      }
      focus.attr('x', left + c.col * cs - 1).attr('y', top + c.row * cs - 1).attr('opacity', 1);
      const [hx, hy] = d3.pointer(event, box);
      tip.show(hx, hy, (el) => SR.tipBody(el, {
        head: SR.dday(c.iso),
        rows: c.future ? [{ label: 'À venir', value: '' }]
          : c.v ? [
            { label: 'Distance', value: `${SR.n1(c.v.km)} km` },
            { label: 'Temps', value: SR.hm(c.v.moving_s) },
            { label: c.v.runs > 1 ? 'Sorties' : 'Sortie', value: SR.n0(c.v.runs) },
          ] : [{ label: 'Repos', value: '' }],
      }));
    }).on('pointerleave', () => {
      focus.attr('opacity', 0);
      tip.hide();
    });
    // Résumé de l’année et légende.
    const yrow = years.find((r) => r.year === yr);
    const sum = $('#cal-sum');
    sum.replaceChildren();
    if (yrow) {
      const w = `year=${yr}`;
      sum.append(
        document.createTextNode(`${yr} : `),
        SR.mark(SR.el('b', null, SR.n0(yrow.km)), 'by_year', 'km', w), document.createTextNode(' km · '),
        SR.mark(SR.el('b', null, SR.n0(yrow.runs)), 'by_year', 'runs', w), document.createTextNode(' sorties · '),
        SR.mark(SR.el('b', null, SR.n0(yrow.active_days)), 'by_year', 'active_days', w), document.createTextNode(' jours courus'),
      );
    }
    $('#cal-legend').replaceChildren(
      legendItem(SR.col.grid, 'repos'),
      ...['< 5', '5–10', '10–15', '15–21', '21 km +'].map((t, i) => legendItem(ramp[i], t)),
    );
    enter(box);
  }

  /* ================= Année par année ================= */
  const yearCols = [
    { k: 'year', f: (v) => String(v), cls: 'sr-l sr-key' },
    { k: 'runs', f: SR.n0 },
    { k: 'km', f: SR.n0, bar: true },
    { k: 'hours', f: SR.n0, cls: 'sr-hide-sm' },
    { k: 'elev_m', f: SR.n0, cls: 'sr-hide-md' },
    { k: 'km_per_run', f: SR.n1, cls: 'sr-hide-md' },
    { k: 'longest_km', f: SR.n1, cls: 'sr-hide-md' },
    { k: 'pace_s', f: SR.pace },
    { k: 'active_days', f: SR.n0, cls: 'sr-hide-md' },
    { k: 'runs_per_week', f: SR.n1, cls: 'sr-hide-sm' },
    { k: 'best_week_km', f: SR.n0, cls: 'sr-hide-md' },
    { k: 'races', f: SR.n0, cls: 'sr-hide-sm' },
    { k: 'spm', f: (v) => (v == null ? '—' : SR.n0(v)), cls: 'sr-hide-md' },
  ];
  function drawYearTable() {
    const table = $('#t-years');
    const data = tableState(table, 'by_year');
    if (!data) return;
    const rows = [...data].sort((a, b) => cmp(a[ui.sortYears.k], b[ui.sortYears.k]) * ui.sortYears.dir);
    const maxKm = d3.max(rows, (r) => r.km) || 1;
    const cur = d3.max(rows, (r) => r.year);
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = String(r.year);
      yearCols.forEach((c) => {
        const td = SR.el('td', c.cls || null);
        if (c.bar) {
          const bar = SR.el('span', 'sr-cellbar');
          const fill = document.createElement('i');
          fill.style.width = `${(r.km / maxKm) * 100}%`;
          fill.style.background = r.year === cur ? SR.col.orange : SR.col.blue;
          bar.append(fill);
          td.append(bar, document.createTextNode(c.f(r[c.k])));
        } else td.textContent = c.f(r[c.k]);
        tr.append(td);
      });
      return tr;
    }));
    sortHeaders(table, ui.sortYears);
    enter(table);
  }

  function drawMonthHeat() {
    const box = $('#c-monthheat');
    const d = SR.ready(box, ['by_month', 'by_year', 'highlights']);
    if (!d || !d[0].length) return;
    const [months, years, hl] = d;
    const ys = [...new Set(months.map((r) => r.year))].sort((a, b) => b - a);
    const max = d3.max(months, (r) => r.km) || 1;
    const ramp = SR.ramp(6);
    const inks = ramp.map(SR.inkOn);
    const q = d3.scaleQuantize([0, max], d3.range(ramp.length));
    const grid = SR.el('div', 'sr-heat');
    const head = SR.el('div', 'sr-heat__row');
    head.append(SR.el('span', 'sr-heat__lab'));
    // Nom court du mois, ou son initiale quand la carte est étroite (bascule en CSS).
    for (let i = 0; i < 12; i++) {
      const name = SR.mon(new Date(Date.UTC(2001, i, 1))).replace('.', '');
      const lab = SR.el('span', 'sr-heat__lab sr-heat__lab--c');
      const short = SR.el('span', 'sr-heat__m--s', name.charAt(0).toUpperCase());
      short.setAttribute('aria-hidden', 'true');
      lab.append(SR.el('span', 'sr-heat__m--l', name), short);
      head.append(lab);
    }
    head.append(SR.el('span', 'sr-heat__lab sr-heat__lab--c', 'total'));
    grid.append(head);
    const cells = [];
    ys.forEach((yr) => {
      const row = SR.el('div', 'sr-heat__row');
      row.append(SR.el('span', 'sr-heat__lab', String(yr)));
      months.filter((r) => r.year === yr).sort((a, b) => a.m - b.m).forEach((r) => {
        const cell = SR.el('div', 'sr-heat__cell');
        if (r.future) cell.classList.add('is-future');
        else if (r.km > 0) {
          const k = q(r.km);
          cell.style.background = ramp[k];
          const s = SR.mark(SR.el('span', null, SR.n0(r.km)), 'by_month', 'km', `month=${r.month}`);
          s.style.color = inks[k];
          cell.append(s);
        } else cell.style.background = SR.col.grid;
        cells.push([cell, r]);
        row.append(cell);
      });
      const tot = SR.el('span', 'sr-heat__lab sr-heat__lab--r');
      const yrow = years.find((x) => x.year === yr);
      if (yrow) tot.append(SR.mark(SR.el('span', null, SR.n0(yrow.km)), 'by_year', 'km', `year=${yr}`));
      row.append(tot);
      grid.append(row);
    });
    box.replaceChildren(grid);
    const tip = SR.tip(box);
    cells.forEach(([cell, r]) => {
      cell.addEventListener('pointerenter', () => {
        const hb = box.getBoundingClientRect();
        const b = cell.getBoundingClientRect();
        tip.show(b.left - hb.left + b.width / 2, b.top - hb.top, (el) => SR.tipBody(el, {
          head: SR.dmonth(r.month),
          rows: r.future ? [{ label: 'À venir', value: '' }] : [
            { label: 'Distance', value: `${SR.n0(r.km)} km` },
            { label: 'Sorties', value: SR.n0(r.runs) },
            { label: 'Temps', value: SR.hm(r.hours * 3600) },
          ],
        }));
      });
      cell.addEventListener('pointerleave', () => tip.hide());
    });
    const legend = $('#heat-legend');
    const scale = SR.el('span', 'sr-scale');
    ramp.forEach((c) => {
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = c;
      scale.append(sw);
    });
    const top = SR.el('span');
    const topNum = SR.mark(SR.el('span', null, SR.n0(hl[0] ? hl[0].best_month_km : null)), 'highlights', 'best_month_km');
    topNum.dataset.row = '0';
    top.append(topNum, document.createTextNode(' km'));
    legend.replaceChildren(SR.el('span', null, '0'), scale, top);
    enter(box);
  }

  function bandInfo(rows) {
    return [...new Map(rows.map((r) => [r.band_i, r.band])).entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }

  function drawBandMix() {
    const box = $('#c-bandmix');
    const d = SR.ready(box, ['bands']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const names = bandInfo(rows);
    const ramp = SR.ramp(names.length);
    const inks = ramp.map(SR.inkOn);
    $('#band-legend').replaceChildren(...names.map((b, i) => legendItem(ramp[i], b)));
    const byYear = d3.group(rows, (r) => r.year);
    const years = [...byYear.keys()].filter((yr) => d3.sum(byYear.get(yr), (r) => r.runs) >= 20).sort((a, b) => b - a);
    const field = ui.mixBy === 'runs' ? 'share_runs' : 'share_km';
    const W = SR.width(box);
    const rowH = 28;
    const gapY = 14;
    const m = { t: 2, r: 2, b: 2, l: 46 };
    const H = m.t + years.length * (rowH + gapY) - gapY + m.b;
    box.style.setProperty('--h', `${H}px`);
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Part de chaque tranche de distance par année');
    const tip = SR.tip(box);
    const x = d3.scaleLinear([0, 1], [m.l, W - m.r]);
    years.forEach((yr, yi) => {
      const y0 = m.t + yi * (rowH + gapY);
      svg.append('text').attr('x', 0).attr('y', y0 + rowH / 2).attr('dy', '0.32em')
        .style('font-size', 'var(--cds-font-size-body)').style('fill', 'var(--color-fg)').text(String(yr));
      let acc = 0;
      const segs = [...byYear.get(yr)].sort((a, b) => a.band_i - b.band_i).map((r) => {
        const s = { ...r, x0: acc, x1: acc + r[field] };
        acc += r[field];
        return s;
      }).filter((s) => s.x1 - s.x0 > 0.0005);
      const segW = (s) => Math.max(0, x(s.x1) - x(s.x0) - (s.x0 > 0 ? 1 : 0) - (s.x1 < 0.9995 ? 1 : 0));
      const g = svg.append('g');
      const rects = g.selectAll('rect').data(segs).join('rect')
        .attr('x', (s) => x(s.x0) + (s.x0 > 0 ? 1 : 0)).attr('y', y0).attr('width', segW).attr('height', rowH)
        .attr('rx', 4).style('fill', (s) => ramp[s.band_i]);
      g.selectAll('text').data(segs.filter((s) => segW(s) >= 36)).join('text')
        .attr('x', (s) => x(s.x0) + (x(s.x1) - x(s.x0)) / 2).attr('y', y0 + rowH / 2).attr('dy', '0.32em')
        .attr('text-anchor', 'middle').style('font-size', 'var(--cds-font-size-caption)').style('pointer-events', 'none')
        .style('fill', (s) => inks[s.band_i]).text((s) => SR.pct(s[field]));
      SR.hover(rects, box, tip, (s) => ({
        head: `${s.year} · ${s.band}`,
        rows: [
          { color: ramp[s.band_i], label: 'Part des km', value: SR.pct(s.share_km) },
          { label: 'Part des sorties', value: SR.pct(s.share_runs) },
          { label: 'Sorties', value: SR.n0(s.runs) },
          { label: 'Distance', value: `${SR.n0(s.km)} km` },
          { label: 'Allure moyenne', value: s.pace_s ? `${SR.pace(s.pace_s)}/km` : '—' },
        ],
      }), (e, s) => rects.attr('opacity', (o) => (o.band_i === s.band_i ? 1 : 0.45)), () => rects.attr('opacity', 1));
    });
    enter(box);
  }

  function drawBandPace() {
    const box = $('#c-bandpace');
    const d = SR.ready(box, ['bands']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const cur = d3.max(rows, (r) => r.year);
    const shown = rows.filter((r) => r.year >= cur - 2 && r.runs >= 3 && r.pace_s);
    const names = bandInfo(rows).filter((b) => shown.some((r) => r.band === b));
    if (!shown.length) return;
    $('#bandpace-legend').replaceChildren(...[cur, cur - 1, cur - 2].filter((yr) => shown.some((r) => r.year === yr))
      .map((yr) => legendItem(SR.yearColor(yr, cur), String(yr), 'dot')));
    const W = SR.width(box);
    const rowH = 36;
    const m = { t: 6, r: 16, b: 34, l: 84 };
    const H = m.t + names.length * rowH + m.b;
    box.style.setProperty('--h', `${H}px`);
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Allure moyenne par tranche de distance et par année');
    const tip = SR.tip(box);
    const ext = d3.extent(shown, (r) => r.pace_s);
    const lo = Math.floor((ext[0] - 6) / 10) * 10;
    const hi = Math.ceil((ext[1] + 6) / 10) * 10;
    const x = d3.scaleLinear([hi, lo], [m.l, W - m.r]);
    const y = d3.scaleBand(names, [m.t, H - m.b]).padding(0.25);
    const stepS = (hi - lo) / (W < 420 ? 3 : 5);
    const tickStep = [10, 15, 20, 30, 60].find((s) => s >= stepS) || 60;
    d3.range(Math.ceil(lo / tickStep) * tickStep, hi + 1, tickStep).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b)
        .style('stroke', SR.col.grid).attr('shape-rendering', 'crispEdges');
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(SR.pace(t));
    });
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end')).text('plus rapide →');
    names.forEach((b) => {
      const cy = y(b) + y.bandwidth() / 2;
      svg.append('text').attr('x', 0).attr('y', cy).attr('dy', '0.32em')
        .style('font-size', 'var(--cds-font-size-body)').style('fill', 'var(--color-fg)').text(b);
      const pts = shown.filter((r) => r.band === b);
      if (pts.length > 1) {
        const e = d3.extent(pts, (r) => r.pace_s);
        svg.append('line').attr('x1', x(e[1])).attr('x2', x(e[0])).attr('y1', cy).attr('y2', cy)
          .style('stroke', SR.col.muted).attr('stroke-opacity', 0.5).attr('stroke-width', 3).attr('stroke-linecap', 'round');
      }
    });
    const dots = svg.append('g').selectAll('circle')
      .data([...shown].sort((a, b) => SR.yearRank(a.year, cur) - SR.yearRank(b.year, cur))).join('circle')
      .attr('cx', (r) => x(r.pace_s)).attr('cy', (r) => y(r.band) + y.bandwidth() / 2).attr('r', 6)
      .style('fill', (r) => SR.yearColor(r.year, cur)).style('stroke', SR.col.panel).attr('stroke-width', 2);
    SR.hover(dots, box, tip, (r) => ({
      head: `${r.year} · ${r.band}`,
      rows: [
        { color: SR.yearColor(r.year, cur), label: 'Allure moyenne', value: `${SR.pace(r.pace_s)}/km` },
        { label: 'Sorties', value: SR.n0(r.runs) },
        { label: 'Distance', value: `${SR.n0(r.km)} km` },
      ],
    }));
    enter(box);
  }

  /* ================= Distances ================= */
  function drawHist() {
    const box = $('#c-hist');
    const d = SR.ready(box, ['dist_hist']);
    if (!d || !d[0].length) return;
    const bins = d[0];
    const W = SR.width(box);
    const H = 260;
    const m = { t: 30, r: 8, b: 30, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Nombre de sorties par distance');
    const tip = SR.tip(box);
    const step = (W - m.l - m.r) / bins.length;
    const xL = (i) => m.l + i * step;
    const y = d3.scaleLinear([0, d3.max(bins, (b) => b.runs) * 1.1 || 1], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    const ramp = SR.ramp(6);
    const bandOf = (k) => d3.bisectRight([5, 10, 15, 20, 25], k);
    const gap = step >= 6 ? 2 : 1;
    const bw = Math.min(32, step - gap);
    const bars = svg.append('g').selectAll('path').data(bins).join('path')
      .attr('d', (b, i) => SR.barPath(xL(i) + (step - bw) / 2, y(b.runs), bw, y(0) - y(b.runs), Math.min(4, bw / 2)))
      .style('fill', (b) => ramp[bandOf(b.from_km)]);
    bins.forEach((b, i) => {
      if (b.from_km % 5) return;
      SR.cap(svg.append('text').attr('x', xL(i)).attr('y', H - m.b + 18).attr('text-anchor', i === 0 ? 'start' : 'middle'))
        .text(b.from_km === 0 ? '0' : `${b.from_km}${i + 5 >= bins.length ? ' km' : ''}`);
    });
    const topBin = bins.reduce((a, b) => (b.runs > a.runs ? b : a));
    const ti = bins.indexOf(topBin);
    halo(svg.append('text').attr('x', Math.min(W - m.r - 4, Math.max(m.l + 4, xL(ti) + step / 2))).attr('y', y(topBin.runs) - 9)
      .attr('text-anchor', xL(ti) > W * 0.75 ? 'end' : 'middle').style('font-size', 'var(--cds-font-size-caption)')
      .style('fill', 'var(--color-fg)')).text(`${topBin.from_km}–${topBin.to_km} km : ${SR.n0(topBin.runs)} sorties`);
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const i = Math.max(0, Math.min(bins.length - 1, Math.floor((mx - m.l) / step)));
        const b = bins[i];
        bars.attr('opacity', (o) => (o === b ? 1 : 0.5));
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: `De ${b.from_km} à ${b.to_km} km`,
          rows: [{ color: ramp[bandOf(b.from_km)], label: 'Sorties', value: SR.n0(b.runs) }],
        }));
      })
      .on('pointerleave', () => {
        bars.attr('opacity', 1);
        tip.hide();
      });
    enter(box);
  }

  function drawScatter() {
    const box = $('#c-scatter');
    const d = SR.ready(box, ['runs', 'race_results']);
    if (!d) return;
    const [runs, races] = d;
    const raceIds = new Set(races.map((r) => r.id));
    const pts = runs.filter((r) => r.km >= 1 && r.pace_s > 0);
    if (!pts.length) return;
    const cur = d3.max(pts, (r) => r.year);
    const legendYears = [cur, cur - 1, cur - 2].filter((yr) => pts.some((r) => r.year === yr));
    $('#scatter-legend').replaceChildren(
      ...legendYears.map((yr) => legendItem(SR.yearColor(yr, cur), String(yr), 'dot')),
      ...(pts.some((r) => r.year < cur - 2) ? [legendItem(SR.col.muted, `avant ${cur - 2}`, 'dot')] : []),
      legendItem(null, 'compétition', 'ring'),
    );
    const paces = pts.map((r) => r.pace_s).sort(d3.ascending);
    const pLo = d3.quantileSorted(paces, 0.005);
    const pHi = d3.quantileSorted(paces, 0.995);
    const lo = Math.floor((pLo - 5) / 30) * 30;
    const hi = Math.ceil((pHi + 5) / 30) * 30;
    const clampP = (p) => Math.max(lo, Math.min(hi, p));
    const W = SR.width(box);
    const H = 360;
    const m = { t: 12, r: 14, b: 34, l: 52 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Distance et allure de chaque sortie');
    const tip = SR.tip(box);
    const xMax = Math.ceil(d3.max(pts, (r) => r.km) / 5) * 5;
    const x = d3.scaleLinear([0, xMax], [m.l, W - m.r]);
    const y = d3.scaleLinear([hi, lo], [H - m.b, m.t]);
    const yTicks = d3.range(lo, hi + 1, (hi - lo) / 30 > 6 ? 60 : 30);
    SR.gridY(svg, y, m.l, W - m.r, yTicks, SR.pace, { noBase: true });
    const xStep = W < 480 ? 10 : 5;
    d3.range(0, xMax + 1, xStep).forEach((t) => {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', m.t).attr('y2', H - m.b)
        .style('stroke', SR.col.grid).attr('shape-rendering', 'crispEdges');
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 18).attr('text-anchor', 'middle'))
        .text(t === xMax ? `${t} km` : String(t));
    });
    const sorted = [...pts].sort((a, b) => SR.yearRank(a.year, cur) - SR.yearRank(b.year, cur) || Number(raceIds.has(a.id)) - Number(raceIds.has(b.id)));
    const px = (r) => x(r.km);
    const py = (r) => y(clampP(r.pace_s));
    svg.append('g').selectAll('circle').data(sorted).join('circle')
      .attr('cx', px).attr('cy', py).attr('r', (r) => (raceIds.has(r.id) ? 5 : 3.5))
      .style('fill', (r) => SR.yearColor(r.year, cur))
      .attr('fill-opacity', (r) => (SR.yearRank(r.year, cur) ? 0.9 : 0.6))
      .style('stroke', (r) => (raceIds.has(r.id) ? 'var(--color-fg)' : SR.col.panel))
      .attr('stroke-width', (r) => (raceIds.has(r.id) ? 1.5 : 1));
    const delaunay = d3.Delaunay.from(sorted, px, py);
    const ring = svg.append('circle').attr('r', 8).style('fill', 'none').style('stroke', 'var(--color-fg)')
      .attr('stroke-width', 2).attr('opacity', 0).style('pointer-events', 'none');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const i = delaunay.find(mx, my);
        const r = sorted[i];
        if (!r || Math.hypot(px(r) - mx, py(r) - my) > 28) {
          ring.attr('opacity', 0);
          tip.hide();
          return;
        }
        ring.attr('cx', px(r)).attr('cy', py(r)).attr('opacity', 1);
        const race = races.find((o) => o.id === r.id);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmed(r.date),
          title: race ? `${race.event} · ${SR.dur(race.time_s)}` : r.name,
          rows: [
            { color: SR.yearColor(r.year, cur), label: 'Distance', value: `${SR.n1(r.km)} km` },
            { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
            { label: 'Temps en mouvement', value: SR.hm(r.moving_s) },
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

  function drawBandTable() {
    const table = $('#t-bands');
    const rows = tableState(table, 'band_summary');
    if (!rows) return;
    const ramp = SR.ramp(rows.length);
    const maxShare = d3.max(rows, (r) => r.share_km) || 1;
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.band;
      const band = SR.el('td', 'sr-l sr-key');
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = ramp[r.band_i];
      sw.style.marginRight = '8px';
      band.append(sw, document.createTextNode(r.band));
      const share = SR.el('td');
      const bar = SR.el('span', 'sr-cellbar');
      const fill = document.createElement('i');
      fill.style.width = `${(r.share_km / maxShare) * 100}%`;
      fill.style.background = ramp[r.band_i];
      bar.append(fill);
      share.append(bar, document.createTextNode(SR.pct(r.share_km)));
      tr.append(band, SR.el('td', null, SR.n0(r.runs)), SR.el('td', null, SR.n0(r.km)), share,
        SR.el('td', null, SR.pace(r.pace_s)), SR.el('td', 'sr-hide-sm', SR.n1(r.avg_km)));
      return tr;
    }));
    enter(table);
  }

  function drawLongest() {
    const table = $('#t-longest');
    const rows = tableState(table, 'longest');
    if (!rows) return;
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.id;
      tr.append(SR.el('td', 'sr-l', SR.dmed(r.date)), SR.el('td', 'sr-l', r.name), SR.el('td', null, SR.n1(r.km)),
        SR.el('td', 'sr-hide-sm', SR.hm(r.moving_s)), SR.el('td', null, SR.pace(r.pace_s)));
      return tr;
    }));
    enter(table);
  }

  /* ================= Compétitions ================= */
  function drawFacets() {
    const box = $('#c-facets');
    const d = SR.ready(box, ['race_results', 'race_best']);
    if (!d || !d[0].length) return;
    const [results, best] = d;
    const cats = ['10 km', 'Semi', '20 km', 'Paris-Versailles', 'Marathon'].filter((c) => results.some((r) => r.category === c));
    const rs = results.filter((r) => cats.includes(r.category));
    const dayExt = d3.extent(rs, (r) => r.day);
    const pExt = d3.extent(rs, (r) => r.pace_s);
    const lo = Math.floor((pExt[0] - 4) / 10) * 10;
    const hi = Math.ceil((pExt[1] + 4) / 10) * 10;
    box.replaceChildren();
    const charts = cats.map((cat) => {
      const f = SR.el('div', 'sr-facet');
      const head = SR.el('div', 'sr-facet__head');
      const b = best.find((x) => x.category === cat);
      const bestEl = SR.el('span', 'sr-facet__best');
      if (b) bestEl.append(document.createTextNode('record '), SR.mark(SR.el('b', null, SR.dur(b.time_s)), 'race_best', 'time_s', `category=${SR.enc(cat)}`));
      head.append(SR.el('span', 'sr-facet__name', cat), bestEl);
      const chart = SR.el('div', 'sr-chart');
      chart.style.setProperty('--h', '172px');
      f.append(head, chart);
      box.append(f);
      return [chart, cat];
    });
    charts.forEach(([chart, cat]) => {
      const pts = rs.filter((r) => r.category === cat);
      const W = SR.width(chart, 220);
      const H = 172;
      const m = { t: 18, r: 14, b: 24, l: 46 };
      const svg = SR.svg(chart, W, H).attr('aria-label', `Allure en compétition : ${cat}`);
      const tip = SR.tip(chart);
      const x = d3.scaleLinear([dayExt[0] - 40, dayExt[1] + 40], [m.l, W - m.r]);
      const y = d3.scaleLinear([hi, lo], [H - m.b, m.t]);
      const tickStep = (hi - lo) / 20 > 4 ? 30 : 20;
      SR.gridY(svg, y, m.l, W - m.r, d3.range(Math.ceil(lo / tickStep) * tickStep, hi + 1, tickStep), SR.pace, { noBase: true });
      const y0 = new Date(dayExt[0] * DAY).getUTCFullYear();
      const y1 = new Date(dayExt[1] * DAY).getUTCFullYear();
      d3.range(y0 + 1, y1 + 1).forEach((yr) => {
        const xd = x(Date.UTC(yr, 0, 1) / DAY);
        svg.append('line').attr('x1', xd).attr('x2', xd).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.grid);
        SR.cap(svg.append('text').attr('x', xd + 3).attr('y', H - m.b + 16)).text(String(yr));
      });
      if (pts.length > 1) {
        svg.append('path').datum(pts).style('fill', 'none').style('stroke', SR.col.muted).attr('stroke-width', 1.5)
          .attr('stroke-linejoin', 'round').attr('d', d3.line().x((r) => x(r.day)).y((r) => y(r.pace_s)));
      }
      const dots = svg.append('g').selectAll('circle').data([...pts].sort((a, b) => Number(a.pr) - Number(b.pr))).join('circle')
        .attr('cx', (r) => x(r.day)).attr('cy', (r) => y(r.pace_s)).attr('r', (r) => (r.pr ? 5.5 : 4.5))
        .style('fill', (r) => (r.pr ? SR.col.orange : SR.col.blue)).style('stroke', SR.col.panel).attr('stroke-width', 2);
      const top = pts.reduce((a, r) => (r.time_s < a.time_s ? r : a));
      const tx = x(top.day);
      halo(svg.append('text').attr('x', Math.min(W - m.r, Math.max(m.l, tx))).attr('y', y(top.pace_s) - 10)
        .attr('text-anchor', tx > W - 60 ? 'end' : tx < m.l + 40 ? 'start' : 'middle')
        .style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)')
        .style('fill', 'var(--color-fg)')).text(SR.dur(top.time_s));
      SR.hover(dots, chart, tip, (r) => ({
        head: SR.dmed(r.date),
        title: r.event,
        rows: [
          { color: r.pr ? SR.col.orange : SR.col.blue, label: r.official ? 'Chrono officiel' : 'Temps écoulé', value: SR.dur(r.time_s) },
          { label: r.official_km ? 'Distance officielle' : 'Distance GPS', value: `${SR.n1(r.km)} km` },
          { label: 'Allure réelle', value: `${SR.pace(r.pace_s)}/km` },
          ...(r.place ? [{ label: 'Classement', value: r.place }] : []),
          ...(r.pr ? [{ label: 'Record personnel', value: 'oui' }] : []),
        ],
      }));
    });
    enter(box);
  }

  const raceCols = [
    { k: 'date', f: SR.dmed, cls: 'sr-l' },
    { k: 'event', f: (v) => v, cls: 'sr-l sr-key' },
    { k: 'category', f: (v) => v, cls: 'sr-l sr-hide-sm' },
    { k: 'km', f: SR.n1, cls: 'sr-hide-md' },
    { k: 'time_s', f: SR.dur },
    { k: 'pace_s', f: SR.pace, cls: 'sr-hide-sm' },
    { k: 'place', f: (v) => v || '—', cls: 'sr-hide-md' },
    { k: 'vdot', f: (v) => (v == null ? '—' : SR.n1(v)), cls: 'sr-hide-sm' },
    { k: 'hr_avg', f: (v) => (v == null ? '—' : SR.n0(v)), cls: 'sr-hide-md' },
    { k: 'pr', badge: true },
  ];
  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function drawRaceTable() {
    const table = $('#t-races');
    const data = tableState(table, 'race_results');
    if (!data) return;
    const extra = dash.data('race_plus');
    const plus = new Map((extra.status === 'ok' && Array.isArray(extra.data) ? extra.data : []).map((r) => [r.id, r]));
    const q = fold(ui.raceQuery.trim());
    const rows = data
      .map((r) => ({ ...r, vdot: plus.has(r.id) ? plus.get(r.id).vdot : null, hr_avg: plus.has(r.id) ? plus.get(r.id).hr_avg : null }))
      .filter((r) => !q || fold(`${r.event} ${r.category} ${r.year} ${r.place || ''}`).includes(q))
      .sort((a, b) => cmp(a[ui.sortRaces.k], b[ui.sortRaces.k]) * ui.sortRaces.dir);
    table.tBodies[0].replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      tr.dataset.key = r.id;
      raceCols.forEach((c) => {
        const td = SR.el('td', c.cls || null);
        if (c.badge) {
          if (r.pr) td.append(SR.el('span', 'sr-badge', 'RP'));
        } else td.textContent = c.f(r[c.k]);
        tr.append(td);
      });
      return tr;
    }));
    sortHeaders(table, ui.sortRaces);
    enter(table);
  }

  /* ================= Habitudes ================= */
  function drawClock() {
    const box = $('#c-clock');
    const d = SR.ready(box, ['hours']);
    if (!d || !d[0].length) return;
    const hours = d[0];
    const W = SR.width(box);
    const H = 320;
    const R = Math.min(W, H) / 2 - 24;
    const r0 = R * 0.36;
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Sorties selon l’heure de départ');
    const tip = SR.tip(box);
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    const max = d3.max(hours, (h) => h.runs) || 1;
    const rs = d3.scaleLinear([0, max], [r0, R]);
    [0.25, 0.5, 0.75, 1].forEach((t) => {
      g.append('circle').attr('r', rs(max * t)).style('fill', 'none').style('stroke', SR.col.grid);
    });
    const step = (2 * Math.PI) / 24;
    const pad = 0.03;
    const arc = d3.arc().innerRadius(r0).outerRadius((h) => rs(h.runs))
      .startAngle((h) => h.hour * step + pad).endAngle((h) => (h.hour + 1) * step - pad).cornerRadius(2.5);
    const peak = hours.reduce((a, h) => (h.runs > a.runs ? h : a));
    const wedges = g.append('g').selectAll('path').data(hours.filter((h) => h.runs > 0)).join('path')
      .attr('d', arc).style('fill', (h) => (h.hour === peak.hour ? SR.col.orange : SR.col.blue));
    d3.range(0, 24, 3).forEach((hr) => {
      const a = hr * step - Math.PI / 2;
      SR.cap(g.append('text').attr('x', Math.cos(a) * (R + 13)).attr('y', Math.sin(a) * (R + 13))
        .attr('dy', '0.32em').attr('text-anchor', 'middle')).text(`${hr}h`);
    });
    g.append('text').attr('text-anchor', 'middle').attr('dy', '-0.05em')
      .style('font-family', 'var(--font-display)').style('font-size', 'var(--cds-font-size-title)').style('font-weight', 800)
      .style('letter-spacing', '-.03em').style('fill', 'var(--color-fg)').text(`${peak.hour}h`);
    SR.cap(g.append('text').attr('text-anchor', 'middle').attr('dy', '1.45em')).text('heure de pointe');
    SR.hover(wedges, box, tip, (h) => ({
      head: `Départ entre ${h.hour}h et ${h.hour + 1}h`,
      rows: [
        { color: h.hour === peak.hour ? SR.col.orange : SR.col.blue, label: 'Sorties', value: SR.n0(h.runs) },
        { label: 'Distance', value: `${SR.n0(h.km)} km` },
      ],
    }), (e, h) => wedges.attr('opacity', (o) => (o.hour === h.hour ? 1 : 0.45)), () => wedges.attr('opacity', 1));
    const sum = $('#clock-sum');
    const w = `hour=${peak.hour}`;
    sum.replaceChildren(
      document.createTextNode(`Heure de pointe : départ entre ${peak.hour}h et ${peak.hour + 1}h, `),
      SR.mark(SR.el('b', null, SR.n0(peak.runs)), 'hours', 'runs', w), document.createTextNode(' sorties et '),
      SR.mark(SR.el('b', null, SR.n0(peak.km)), 'hours', 'km', w), document.createTextNode(' km.'),
    );
    enter(box);
  }

  function drawWeekdays() {
    const box = $('#c-weekdays');
    const d = SR.ready(box, ['weekdays']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const W = SR.width(box);
    const H = 260;
    const m = { t: 26, r: 4, b: 30, l: 4 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Sorties selon le jour de la semaine');
    const tip = SR.tip(box);
    const x = d3.scaleBand(rows.map((r) => r.day), [m.l, W - m.r]).paddingInner(0.32).paddingOuter(0.1);
    const y = d3.scaleLinear([0, d3.max(rows, (r) => r.runs) * 1.05 || 1], [H - m.b, m.t]);
    const bw = Math.min(40, x.bandwidth());
    const peak = rows.reduce((a, r) => (r.runs > a.runs ? r : a));
    const cxOf = (r) => x(r.day) + x.bandwidth() / 2;
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).style('stroke', SR.col.axis);
    const bars = svg.append('g').selectAll('path').data(rows).join('path')
      .attr('d', (r) => SR.barPath(cxOf(r) - bw / 2, y(r.runs), bw, y(0) - y(r.runs), 4))
      .style('fill', (r) => (r === peak ? SR.col.orange : SR.col.blue));
    svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cxOf).attr('y', (r) => y(r.runs) - 8).attr('text-anchor', 'middle')
      .style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg)').text((r) => SR.n0(r.runs));
    SR.cap(svg.append('g').selectAll('text').data(rows).join('text')
      .attr('x', cxOf).attr('y', H - m.b + 18).attr('text-anchor', 'middle')).text((r) => (x.bandwidth() < 34 ? r.day.slice(0, 1) : `${r.day.slice(0, 3).toLowerCase()}.`));
    const hits = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.day)).attr('y', m.t - 20).attr('width', x.bandwidth()).attr('height', H - m.t + 16)
      .style('fill', 'transparent');
    SR.hover(hits, box, tip, (r) => ({
      head: r.day,
      rows: [
        { label: 'Sorties', value: SR.n0(r.runs) },
        { label: 'Part des sorties', value: SR.pct(r.share_runs) },
        { label: 'Distance', value: `${SR.n0(r.km)} km` },
      ],
    }), (e, r) => bars.attr('opacity', (o) => (o === r ? 1 : 0.4)), () => bars.attr('opacity', 1));
    const w = `dow=${peak.dow}`;
    $('#weekday-sum').replaceChildren(
      document.createTextNode(`Jour préféré : le ${peak.day.toLowerCase()}, avec `),
      SR.mark(SR.el('b', null, SR.pct(peak.share_runs)), 'weekdays', 'share_runs', w),
      document.createTextNode(' des sorties et '),
      SR.mark(SR.el('b', null, SR.n0(peak.km)), 'weekdays', 'km', w),
      document.createTextNode(' km.'),
    );
    enter(box);
  }

  function drawRegularity() {
    const box = $('#regularity');
    const d = SR.ready(box, ['streaks', 'by_year']);
    if (!d || !d[0].length) return;
    const [streaks, years] = d;
    const cur = d3.max(years, (r) => r.year);
    const tile = (label, value, src, field, where, unit, sub) => {
      const t = SR.el('div', 'sr-tile');
      const v = SR.el('p', 'sr-tile__value');
      v.append(SR.mark(SR.el('span', null, value), src, field, where));
      if (unit) v.append(SR.el('span', 'sr-unit', unit));
      t.append(SR.el('p', 'sr-tile__label', label), v);
      if (sub) t.append(SR.el('p', 'sr-tile__sub', sub));
      return t;
    };
    const serie = streaks.find((s) => s.kind === 'serie');
    const cut = streaks.find((s) => s.kind === 'coupure');
    const tiles = [];
    if (serie) tiles.push(tile('Plus longue série', SR.n0(serie.days), 'streaks', 'days', 'kind=serie', 'jours d’affilée', `du ${SR.dshort(serie.from)} au ${SR.dmed(serie.to)}`));
    if (cut) tiles.push(tile('Plus longue coupure depuis 2024', SR.n0(cut.days), 'streaks', 'days', 'kind=coupure', 'jours', `du ${SR.dshort(cut.from)} au ${SR.dmed(cut.to)}`));
    [cur - 1, cur].forEach((yr) => {
      const r = years.find((x) => x.year === yr);
      if (r) tiles.push(tile(`Rythme ${yr}`, SR.n1(r.runs_per_week), 'by_year', 'runs_per_week', `year=${yr}`, 'sorties / semaine', `${SR.n0(r.active_days)} jours courus${yr === cur ? ' à ce jour' : ''}`));
    });
    box.replaceChildren(...tiles);
    enter(box);
  }

  function drawCadence() {
    const box = $('#c-cadence');
    const d = SR.ready(box, ['runs', 'cadence']);
    if (!d) return;
    const [runs, months] = d;
    const pts = runs.filter((r) => r.spm);
    if (!pts.length || !months.length) {
      box.replaceChildren(SR.el('p', 'sr-card__note', 'Aucune cadence enregistrée.'));
      return;
    }
    const W = SR.width(box);
    const H = 280;
    const m = { t: 12, r: 12, b: 28, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Cadence par sortie et par mois');
    const tip = SR.tip(box);
    const lastM = months[months.length - 1].month;
    const t0 = SR.utc(`${months[0].month}-01`);
    const t1 = new Date(Date.UTC(Number(lastM.slice(0, 4)), Number(lastM.slice(5, 7)), 1));
    const x = d3.scaleUtc([t0, t1], [m.l, W - m.r]);
    const vals = pts.map((p) => p.spm).sort(d3.ascending);
    const lo = Math.floor((d3.quantileSorted(vals, 0.01) - 2) / 5) * 5;
    const hi = Math.ceil((vals[vals.length - 1] + 2) / 5) * 5;
    const y = d3.scaleLinear([lo, hi], [H - m.b, m.t]);
    const clampV = (v) => Math.max(lo, Math.min(hi, v));
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(5), SR.n0, { noBase: true });
    let lastX = -Infinity;
    months.forEach((mo) => {
      const dt = SR.utc(`${mo.month}-01`);
      const px = x(dt);
      if (px - lastX < 46) return;
      lastX = px;
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', H - m.b).attr('y2', H - m.b + 4).style('stroke', SR.col.axis);
      SR.cap(svg.append('text').attr('x', px + 2).attr('y', H - m.b + 18)).text(dt.getUTCMonth() === 0 ? String(dt.getUTCFullYear()) : SR.mon(dt));
    });
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (p) => x(new Date(SR.utc(p.date).getTime() + DAY / 2))).attr('cy', (p) => y(clampV(p.spm))).attr('r', 3)
      .style('fill', SR.col.blue).attr('fill-opacity', 0.35);
    const mid = (mo) => new Date(Date.UTC(Number(mo.month.slice(0, 4)), Number(mo.month.slice(5, 7)) - 1, 15));
    svg.append('path').datum(months).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', d3.line().x((mo) => x(mid(mo))).y((mo) => y(clampV(mo.spm))));
    svg.append('g').selectAll('circle').data(months).join('circle')
      .attr('cx', (mo) => x(mid(mo))).attr('cy', (mo) => y(clampV(mo.spm))).attr('r', 4)
      .style('fill', SR.col.orange).style('stroke', SR.col.panel).attr('stroke-width', 2);
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    const mids = months.map((mo) => x(mid(mo)));
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const i = d3.minIndex(mids, (v) => Math.abs(v - mx));
        const mo = months[i];
        rule.attr('x1', mids[i]).attr('x2', mids[i]).attr('opacity', 1);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: SR.dmonth(mo.month),
          rows: [
            { color: SR.col.orange, line: true, label: 'Cadence moyenne', value: `${SR.n0(mo.spm)} pas/min` },
            { label: 'Sorties mesurées', value: SR.n0(mo.runs) },
          ],
        }));
      })
      .on('pointerleave', () => {
        rule.attr('opacity', 0);
        tip.hide();
      });
    enter(box);
  }

  function barList(box, rows, src, keyField, labelOf) {
    const max = d3.max(rows, (r) => r.runs) || 1;
    box.replaceChildren(...rows.map((r) => {
      const row = SR.el('div', 'sr-barrow');
      const track = SR.el('div', 'sr-barrow__track');
      const fill = SR.el('div', 'sr-barrow__fill');
      fill.style.width = `${(r.runs / max) * 100}%`;
      fill.style.background = SR.col.blue;
      track.append(fill);
      const val = SR.el('span', 'sr-barrow__value');
      const where = `${keyField}=${SR.enc(r[keyField])}`;
      val.append(SR.mark(SR.el('span', null, SR.n0(r.runs)), src, 'runs', where), SR.el('small', null, `· ${SR.n0(r.km)} km`));
      const lab = SR.el('span', 'sr-barrow__label', labelOf(r));
      row.append(lab, track, val);
      return row;
    }));
  }
  function drawPlaces() {
    const cbox = $('#c-countries');
    const c = SR.ready(cbox, ['countries']);
    if (c) {
      barList(cbox, c[0], 'countries', 'country', (r) => r.country);
      enter(cbox);
    }
    const vbox = $('#c-cities');
    const v = SR.ready(vbox, ['cities']);
    if (v) barList(vbox, v[0], 'cities', 'city', (r) => r.city);
  }

  function drawCross() {
    const box = $('#c-cross');
    const d = SR.ready(box, ['cross']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const sports = ['Musculation', 'Tennis & padel', 'Ski', 'Natation & marche'].filter((s) => rows.some((r) => r.sport === s));
    const colorOf = { Musculation: SR.col.blue, 'Tennis & padel': SR.col.orange, Ski: SR.col.aqua, 'Natation & marche': SR.col.muted };
    $('#cross-legend').replaceChildren(...sports.map((s) => legendItem(colorOf[s], s)));
    const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
    const stacks = years.map((yr) => {
      let acc = 0;
      return { year: yr, segs: sports.map((s) => rows.find((r) => r.year === yr && r.sport === s)).filter(Boolean).map((r) => {
        const seg = { ...r, y0: acc, y1: acc + r.hours };
        acc += r.hours;
        return seg;
      }), total: acc };
    });
    const W = SR.width(box);
    const H = 240;
    const m = { t: 22, r: 6, b: 28, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Heures d’autres sports par année');
    const tip = SR.tip(box);
    const x = d3.scaleBand(years, [m.l, W - m.r]).paddingInner(0.4).paddingOuter(0.2);
    const y = d3.scaleLinear([0, d3.max(stacks, (s) => s.total) * 1.08 || 1], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), (t) => `${SR.n0(t)} h`);
    const bw = Math.min(40, x.bandwidth());
    const segs = stacks.flatMap((s) => s.segs.map((g, i) => ({ ...g, top: i === s.segs.length - 1 })));
    const cx = (yr) => x(yr) + x.bandwidth() / 2;
    const rects = svg.append('g').selectAll('path').data(segs).join('path')
      .attr('d', (g) => {
        const yTop = y(g.y1);
        const h = Math.max(0, y(g.y0) - y(g.y1) - (g.y0 > 0 ? 2 : 0));
        return g.top ? SR.barPath(cx(g.year) - bw / 2, yTop, bw, h, 4) : `M${cx(g.year) - bw / 2},${yTop}h${bw}v${h}h${-bw}Z`;
      })
      .style('fill', (g) => colorOf[g.sport]);
    svg.append('g').selectAll('text').data(stacks).join('text')
      .attr('x', (s) => cx(s.year)).attr('y', (s) => y(s.total) - 7).attr('text-anchor', 'middle')
      .style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg)').text((s) => `${SR.n0(s.total)} h`);
    SR.cap(svg.append('g').selectAll('text').data(years).join('text')
      .attr('x', cx).attr('y', H - m.b + 18).attr('text-anchor', 'middle')).text(String);
    SR.hover(rects, box, tip, (g) => ({
      head: `${g.year} · ${g.sport}`,
      rows: [
        { color: colorOf[g.sport], label: 'Temps', value: SR.hm(g.hours * 3600) },
        { label: 'Séances', value: SR.n0(g.sessions) },
      ],
    }), (e, g) => rects.attr('opacity', (o) => (o.sport === g.sport ? 1 : 0.4)), () => rects.attr('opacity', 1));
    enter(box);
  }

  function drawKudos() {
    const box = $('#c-kudos');
    const d = SR.ready(box, ['kudos_top']);
    if (!d || !d[0].length) return;
    box.replaceChildren(...d[0].map((r, i) => {
      const li = document.createElement('li');
      const name = SR.el('span', 'sr-list__name', r.name);
      name.append(SR.el('span', 'sr-list__sub', `${SR.dmed(r.date)} · ${SR.n1(r.km)} km`));
      const val = SR.el('span', 'sr-list__value');
      val.append(SR.mark(SR.el('span', null, SR.n0(r.kudos)), 'kudos_top', 'kudos', `id=${r.id}`), SR.el('span', 'sr-unit', 'kudos'));
      li.append(SR.el('span', 'sr-list__rank', String(i + 1)), name, val);
      return li;
    }));
    enter(box);
  }

  /* ================= Orchestration ================= */
  const drawers = {
    apercu: [drawCumul, drawYtd, drawYears, drawCalendar],
    historique: [drawYearTable, drawMonthHeat, drawWeeks, drawBandMix, drawBandPace, drawHist, drawScatter, drawBandTable, drawLongest,
      drawClock, drawWeekdays, drawRegularity, drawPlaces, drawCross, drawKudos],
    cardio: [drawCadence],
    competitions: [drawFacets, drawRaceTable],
  };
  // Graphiques des autres fichiers (cardio.js, train.js, map.js, more.js, home.js), rangés par onglet.
  Object.entries(SR.pages || {}).forEach(([page, fns]) => {
    drawers[page] = (drawers[page] || []).concat(fns);
  });
  function draw() {
    run(() => SR.fillMarks());
    (drawers[ui.page] || []).forEach(run);
    if (ui.page === 'competitions') {
      const rec = $('#records');
      if (dash.data('race_best').status === 'ok') enter(rec);
    }
    if (pendingScroll && dash.data('runs').status === 'ok') {
      const target = pendingScroll;
      pendingScroll = null;
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: 'start' });
        dash.setLink(target.id);
      });
    }
  }

  seg('weeks-metric', 'weekMetric', drawWeeks);
  seg('weeks-range', 'weekRange', drawWeeks);
  seg('mix-by', 'mixBy', drawBandMix);
  $('#t-years').tHead.addEventListener('click', (e) => {
    const b = e.target.closest('.sr-th-btn');
    if (!b) return;
    ui.sortYears = nextSort(ui.sortYears, b.dataset.k, ['pace_s']);
    run(drawYearTable);
  });
  $('#t-races').tHead.addEventListener('click', (e) => {
    const b = e.target.closest('.sr-th-btn');
    if (!b) return;
    ui.sortRaces = nextSort(ui.sortRaces, b.dataset.k, ['event', 'category', 'time_s', 'pace_s', 'place']);
    run(drawRaceTable);
  });
  $('#race-search').addEventListener('input', (e) => {
    ui.raceQuery = e.target.value || '';
    run(drawRaceTable);
  });

  // Redessine si le thème change (les couleurs calculées en dépendent).
  let queued = false;
  const redraw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  };
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode'] });
  } catch (err) {
    /* thème fixe */
  }

  dash.onData(draw);
})();
