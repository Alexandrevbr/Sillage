/* Onglets Objectif et Entraînement : course visée, zone grise, volume, récupération, séances clés, records. */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const DAY = 864e5;
  const ui = { volAvg: 'avg8', qSel: null };
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
  const seg = (id, key, redraw) => {
    const group = $(`#${id}`);
    if (!group) return;
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      ui[key] = b.dataset.v;
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      run(redraw);
    });
  };
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
  // Écart de temps court : « 37 s », « 1′26″ ».
  const gapTxt = (s) => {
    const a = Math.round(Math.abs(s));
    const v = a < 60 ? `${a} s` : SR.dur(a);
    return `${s >= 0 ? '+' : '−'}${v}`;
  };
  const today = () => {
    const n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY;
  };
  const dayOf = (iso) => SR.utc(iso).getTime() / DAY;
  const daysTo = (iso) => Math.round(dayOf(iso) - today());
  const D = (iso) => {
    const s = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(SR.utc(iso))
      .replace(/(\s)1(?=\s)/, '$11er');
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Unité d’un axe vertical, au-dessus de la graduation la plus haute (prévoir m.t ≥ 26).
  const unit = (svg, x, label) => SR.cap(svg.append('text').attr('x', x).attr('y', 11).attr('text-anchor', 'end')).text(label);
  // Intensité des footings et délai de récupération : échelle divergente bleu (calme) → gris (entre deux) → orange (trop dur, trop tôt).
  // Types de séance : les trois premières teintes du thème, dans l’ordre ; les compétitions sont des losanges.
  const C = {
    facile: SR.col.blue,
    limite: SR.col.muted,
    grise: SR.col.orange,
    court: SR.col.blue,
    long: SR.col.orange,
    seuil: SR.col.aqua,
    autre: SR.col.muted,
  };
  const diamond = (x, y, r = 5) => `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`;
  const ready = (box, ids) => SR.ready(box, ids);
  const empty = (box, msg) => {
    box.classList.remove('dash-skeleton');
    box.replaceChildren(SR.el('p', 'sr-empty', msg));
  };

  /* ================= Objectif ================= */
  function drawGoalHero() {
    const box = $('#goal-hero');
    const d = ready(box, ['goal_info', 'goal_predict', 'race_best']);
    if (!d) return;
    const [info, pred, best] = d;
    // Sans objectif à venir, seul le bandeau reste, avec un message.
    [...$('#objectif').children].forEach((el) => {
      if (el !== box) el.hidden = !info.length;
    });
    if (!info.length) {
      box.classList.add('sr-goal--empty');
      empty(box, 'Pas de course objectif à venir pour l’instant.');
      return;
    }
    box.classList.remove('sr-goal--empty');
    const g = info[0];
    const left = daysTo(g.date);
    const rec = best.find((b) => b.category === g.category);
    const p = (b) => pred.find((r) => r.basis === b);
    box.replaceChildren();
    const head = SR.el('div', 'sr-goal__head');
    const count = SR.el('div', 'sr-goal__count');
    count.append(SR.el('span', 'sr-goal__j', left > 0 ? `J-${left}` : left === 0 ? 'Jour J' : 'Courue'),
      SR.el('span', 'sr-goal__date', D(g.date)));
    const title = SR.el('div', 'sr-goal__title');
    title.append(SR.el('p', 'sr-eyebrow', 'Objectif'), SR.el('h2', 'sr-goal__event', g.event));
    if (g.target_s) {
      const t = SR.el('p', 'sr-goal__target');
      t.append(txt('Sous '), SR.el('b', null, SR.dur(g.target_s)), txt(' · '), SR.el('b', null, `${SR.pace(g.target_pace_s)}/km`), txt(` sur ${SR.n1(g.km)} km`));
      title.append(t);
    }
    if (g.result_s) {
      const r = SR.el('p', 'sr-goal__target sr-goal__result');
      r.append(txt('Couru en '), SR.el('b', null, SR.dur(g.result_s)), txt(' · '), SR.el('b', null, `${SR.pace(g.result_pace_s)}/km`));
      if (g.result_place) r.append(txt(' · '), SR.el('b', null, g.result_place));
      if (g.target_s) {
        const diff = g.result_s - g.target_s;
        r.append(txt(diff <= 0 ? ` · objectif atteint${diff < 0 ? ` (${gapTxt(diff)})` : ''}` : ` · à ${gapTxt(diff).slice(1)} de l’objectif`));
      }
      title.append(r);
    }
    head.append(title, count);
    box.append(head);

    // Échelle des chronos : plus rapide à droite.
    const raw = [];
    if (g.result_s) raw.push({ k: 'result', s: g.result_s, label: 'Résultat', sub: SR.dur(g.result_s), color: 'var(--color-fg)' });
    if (g.target_s) raw.push({ k: 'target', s: g.target_s, label: 'Objectif', sub: SR.dur(g.target_s), color: 'var(--color-fg)' });
    if (rec) raw.push({ k: 'rec', s: rec.time_s, label: 'Record', sub: `${SR.dur(rec.time_s)} · ${rec.event}, ${SR.utc(rec.date).getUTCFullYear()}`, color: SR.col.blue });
    if (p('best')) raw.push({ k: 'best', s: p('best').time_s, label: 'Niveau des 12 derniers mois', sub: `${SR.dur(p('best').time_s)} · d’après ${p('best').event}`, color: SR.col.orange });
    // Une fois l’objectif couru, la « dernière course » est la course elle-même.
    if (p('last') && !(g.result_s && p('last').date === g.date)) {
      raw.push({ k: 'last', s: p('last').time_s, label: 'Dernière course', sub: `${SR.dur(p('last').time_s)} · d’après ${p('last').event}`, color: SR.col.aqua });
    }
    // Repères confondus (à 2 s près) : un seul point, libellés réunis.
    const marks = [];
    [...raw].sort((a, b) => a.s - b.s).forEach((k) => {
      const prev = marks.find((o) => Math.abs(o.s - k.s) <= 2);
      if (prev) prev.label += ` · ${k.label.toLowerCase()}`;
      else marks.push({ ...k });
    });
    if (marks.length < 2) {
      enter(box);
      return;
    }
    const wrap = SR.el('div', 'sr-goal__scale');
    box.append(wrap);
    const W = SR.width(wrap, 280);
    const narrow = W < 560;
    const m = { l: 14, r: 14 };
    const lo = Math.min(...marks.map((k) => k.s));
    const hi = Math.max(...marks.map((k) => k.s));
    const pad = Math.max(20, (hi - lo) * 0.18);
    const x = d3.scaleLinear([hi + pad, lo - pad], [m.l, W - m.r]);
    const svg = SR.svg(wrap, W, 100).attr('aria-label', 'Chrono visé, record et chronos prédits');
    const bold = (sel) => sel.style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 'var(--cds-font-weight-medium)').style('fill', 'var(--color-fg)');
    // Place de chaque libellé : sur téléphone, une ligne chacun sous l’axe ; sinon au-dessus ou au-dessous, sans chevauchement.
    const byX = [...marks].sort((a, b) => b.s - a.s);
    let axisY;
    let H;
    if (narrow) {
      axisY = 30;
      byX.forEach((k, i) => {
        const px = x(k.s);
        const anchor = px > W * 0.6 ? 'end' : px < W * 0.4 ? 'start' : 'middle';
        k.pos = { side: 'down', y: axisY + 38 + i * 34, anchor, tx: anchor === 'end' ? px + 6 : anchor === 'start' ? px - 6 : px };
      });
      H = axisY + 38 + (byX.length - 1) * 34 + 22;
    } else {
      const used = { up: [[], [], []], down: [[], [], []] };
      byX.forEach((k, i) => {
        const px = x(k.s);
        const w = Math.max(SR.textWidth(svg, k.label) * 1.08, SR.textWidth(svg, k.sub)) + 8;
        let anchor = 'middle';
        let a0 = px - w / 2;
        let a1 = px + w / 2;
        if (a0 < m.l) {
          anchor = 'start';
          a0 = px - 6;
          a1 = a0 + w;
        } else if (a1 > W - m.r) {
          anchor = 'end';
          a1 = px + 6;
          a0 = a1 - w;
        }
        const order = i % 2 === 0 ? ['up', 'down'] : ['down', 'up'];
        const slots = [0, 1, 2].flatMap((t) => order.map((sd) => [sd, t]));
        const free = ([sd, t]) => used[sd][t].every(([b0, b1]) => a1 + 10 < b0 || a0 - 10 > b1);
        const [side, tier] = slots.find(free) || ['down', 2];
        used[side][tier].push([a0, a1]);
        k.pos = { side, tier, anchor, tx: anchor === 'end' ? px + 6 : anchor === 'start' ? px - 6 : px };
      });
      const depth = (sd) => byX.reduce((n, k) => (k.pos.side === sd ? Math.max(n, k.pos.tier + 1) : n), 0);
      const up = depth('up');
      const down = depth('down');
      axisY = 14 + up * 34 + (up ? 4 : 0);
      byX.forEach((k) => {
        k.pos.y = k.pos.side === 'up' ? axisY - 26 - k.pos.tier * 34 : axisY + 34 + k.pos.tier * 34;
      });
      H = axisY + (down ? 34 + (down - 1) * 34 + 22 : 28);
    }
    svg.attr('viewBox', `0 0 ${W} ${H}`);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', axisY).attr('y2', axisY).style('stroke', SR.col.axis).attr('stroke-width', 1);
    if (g.target_s) {
      svg.append('rect').attr('x', x(g.target_s)).attr('y', axisY - 10).attr('width', Math.max(0, W - m.r - x(g.target_s))).attr('height', 20)
        .attr('rx', 10).style('fill', 'var(--sr-brand)').attr('fill-opacity', 0.12);
    }
    const t0 = Math.ceil((lo - pad) / 30) * 30;
    for (let t = t0; t <= hi + pad; t += 30) {
      svg.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', axisY - 3).attr('y2', axisY + 3).style('stroke', SR.col.axis);
      // Graduation à la minute, sauf près d’un repère (son chrono est déjà écrit) ou de la mention « plus rapide ».
      if (t % 60 === 0 && marks.every((k) => Math.abs(x(k.s) - x(t)) > 36) && (narrow || x(t) < W - m.r - 110)) {
        SR.cap(svg.append('text').attr('x', x(t)).attr('y', axisY + 17).attr('text-anchor', 'middle')).text(SR.dur(t));
      }
    }
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', narrow ? axisY - 14 : axisY + 17).attr('text-anchor', 'end')).text('plus rapide →');
    // Traits de rappel d’abord, puis les libellés (avec un liseré) par-dessus.
    byX.forEach((k) => {
      const px = x(k.s);
      const { side, y: ly } = k.pos;
      if (side === 'up') svg.append('line').attr('x1', px).attr('x2', px).attr('y1', axisY - 8).attr('y2', ly + 5).style('stroke', SR.col.grid);
      else svg.append('line').attr('x1', px).attr('x2', px).attr('y1', axisY + 8).attr('y2', ly - 13).style('stroke', SR.col.grid);
    });
    byX.forEach((k) => {
      const { side, y: ly, anchor, tx } = k.pos;
      const yl = side === 'up' ? ly - 14 : ly;
      halo(bold(svg.append('text').attr('x', tx).attr('y', yl).attr('text-anchor', anchor))).text(k.label);
      halo(SR.cap(svg.append('text').attr('x', tx).attr('y', yl + 14).attr('text-anchor', anchor))).text(k.sub);
    });
    byX.forEach((k) => {
      const hollow = k.k === 'target';
      svg.append('circle').attr('cx', x(k.s)).attr('cy', axisY).attr('r', hollow ? 6 : 5.5)
        .style('fill', hollow ? 'var(--color-panel)' : k.color).style('stroke', hollow ? 'var(--color-fg)' : 'var(--color-panel)')
        .attr('stroke-width', 2);
    });
    enter(box);
  }

  function drawGoalTiles() {
    const box = $('#goal-tiles');
    const d = ready(box, ['goal_info', 'goal_predict', 'goal_build', 'goal_weeks', 'long_summary']);
    if (!d) return;
    const [info, pred, build, weeks, longs] = d;
    if (!info.length) {
      box.replaceChildren();
      return;
    }
    const g = info[0];
    const best = pred.find((r) => r.basis === 'best');
    const tgt = pred.find((r) => r.basis === 'target');
    const left = Math.max(0, daysTo(g.date));
    const tiles = [];
    if (g.result_s) {
      const diff = g.target_s ? g.result_s - g.target_s : null;
      const sub = diff == null ? [txt(`${SR.pace(g.result_pace_s)}/km`)]
        : diff === 0 ? [SR.el('b', null, 'pile l’objectif')]
          : [SR.el('b', null, `${gapTxt(diff).slice(1)} de ${diff < 0 ? 'mieux' : 'plus'}`), txt(` que l’objectif (${SR.dur(g.target_s)})`)];
      tiles.push(tile('Résultat', SR.dur(g.result_s), null, sub, diff != null && diff <= 0 ? 'sr-tile--good' : null));
    } else if (best && tgt) {
      const gap = best.time_s - tgt.time_s;
      tiles.push(tile(gap > 0 ? 'Il me manque' : 'D’avance sur l’objectif', gapTxt(gap).slice(1), null, [
        txt('VDOT '), SR.el('b', null, SR.n1(best.vdot)), txt(' sur 12 mois, '), SR.el('b', null, SR.n1(tgt.vdot)), txt(' pour l’objectif'),
      ], gap > 0 ? 'sr-tile--warn' : 'sr-tile--good'));
    }
    const now = [...build].reverse().find((r) => r.cur != null);
    const same = build.find((r) => r.d === -left) || now;
    if (now && same && same.prev != null) {
      tiles.push(tile('Forme aujourd’hui', SR.n0(now.cur), null, [
        SR.el('b', null, SR.n0(same.prev)), txt(` à J-${left} en ${same.prev_year}, avant mon ${SR.dur(same.prev_time_s)}`),
      ], now.cur < same.prev * 0.85 ? 'sr-tile--warn' : null));
    }
    const full = weeks.filter((w) => w.cur != null && !w.cur_partial).slice(-4);
    if (full.length) {
      const avg = (k) => full.reduce((s, w) => s + (w[k] || 0), 0) / full.length;
      tiles.push(tile(`Volume sur ${full.length > 1 ? `${full.length} semaines` : '1 semaine'}`, SR.n0(avg('cur')), 'km/sem', full[0].prev_year ? [
        SR.el('b', null, `${SR.n0(avg('prev'))} km/sem`), txt(` aux mêmes semaines en ${full[0].prev_year}`),
      ] : []));
    }
    const l = longs[0];
    if (l) {
      tiles.push(tile('Sorties ≥ 25 km', SR.n0(l.n25_8w), null, [
        txt('sur 8 semaines · '), SR.el('b', null, SR.n0(l.n25_12m)), txt(' en 12 mois'),
      ], l.n25_8w === 0 ? 'sr-tile--warn' : null));
    }
    box.replaceChildren(...tiles);
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawGoalBuild() {
    const box = $('#c-goalbuild');
    const d = ready(box, ['goal_build', 'goal_info']);
    if (!d || !d[0].length) return;
    const [rows, info] = d;
    const g = info[0];
    const prevYear = rows[0].prev_year;
    const curYear = SR.utc(g.date).getUTCFullYear();
    const cPrev = SR.yearColor(prevYear, curYear);
    const cCur = SR.yearColor(curYear, curYear);
    $('#goalbuild-legend').replaceChildren(
      legendItem(cCur, `${curYear}`, 'line'),
      ...(prevYear ? [legendItem(cPrev, `${prevYear} · ${rows[0].prev_event} en ${SR.dur(rows[0].prev_time_s)}`, 'line')] : []),
    );
    const W = SR.width(box);
    const H = 260;
    const m = { t: 16, r: 44, b: 30, l: 36 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Forme jour par jour avant la course, comparée à l’an dernier');
    const tip = SR.tip(box);
    const x = d3.scaleLinear([-120, 0], [m.l, W - m.r]);
    const ymax = d3.max(rows, (r) => Math.max(r.prev || 0, r.cur || 0)) || 10;
    const y = d3.scaleLinear([0, ymax * 1.08], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    [-120, -90, -60, -30, 0].forEach((t) => {
      SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 17).attr('text-anchor', t === 0 ? 'end' : t === -120 ? 'start' : 'middle'))
        .text(t === 0 ? 'jour J' : `J${t}`);
    });
    const left = Math.max(0, daysTo(g.date));
    if (left > 0 && left < 120) {
      const px = x(-left);
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('stroke-dasharray', '3 3');
      SR.cap(svg.append('text').attr('x', px + 4).attr('y', m.t + 10)).text('aujourd’hui');
    }
    const line = (k) => d3.line().defined((r) => r[k] != null).x((r) => x(r.d)).y((r) => y(r[k]));
    if (prevYear) svg.append('path').datum(rows).style('fill', 'none').style('stroke', cPrev).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('d', line('prev'));
    svg.append('path').datum(rows).style('fill', 'none').style('stroke', cCur).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round').attr('d', line('cur'));
    const endCur = [...rows].reverse().find((r) => r.cur != null);
    const endPrev = rows[rows.length - 1];
    const labels = [];
    if (endCur) labels.push({ x: x(endCur.d), y: y(endCur.cur), c: cCur, t: SR.n0(endCur.cur) });
    if (prevYear && endPrev.prev != null) labels.push({ x: x(endPrev.d), y: y(endPrev.prev), c: cPrev, t: SR.n0(endPrev.prev) });
    labels.forEach((l) => {
      svg.append('circle').attr('cx', l.x).attr('cy', l.y).attr('r', 4).style('fill', l.c).style('stroke', SR.col.panel).attr('stroke-width', 2);
      halo(svg.append('text').attr('x', l.x + 7).attr('y', l.y).attr('dy', '0.32em').style('font-size', 'var(--cds-font-size-caption)')
        .style('font-weight', 'var(--cds-font-weight-medium)').style('fill', 'var(--color-fg)')).text(l.t);
    });
    const rule = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('opacity', 0);
    const dots = svg.append('g');
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b)
      .style('fill', 'transparent').style('touch-action', 'pan-y')
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const dd = Math.max(-120, Math.min(0, Math.round(x.invert(mx))));
        const r = rows.find((o) => o.d === dd);
        if (!r) return;
        rule.attr('x1', x(dd)).attr('x2', x(dd)).attr('opacity', 1);
        dots.selectAll('circle').data([[r.cur, cCur], [r.prev, cPrev]].filter((p) => p[0] != null)).join('circle')
          .attr('cx', x(dd)).attr('cy', (p) => y(p[0])).attr('r', 4).style('fill', (p) => p[1]).style('stroke', SR.col.panel).attr('stroke-width', 2);
        const [hx, hy] = d3.pointer(event, box);
        tip.show(hx, hy, (el) => SR.tipBody(el, {
          head: dd === 0 ? 'Jour de la course' : `J${dd}`,
          rows: [
            { color: cCur, line: true, label: `${SR.dshort(r.cur_date)} ${curYear}`, value: r.cur == null ? 'à venir' : SR.n0(r.cur) },
            ...(prevYear ? [{ color: cPrev, line: true, label: `${SR.dshort(r.prev_date)} ${prevYear}`, value: r.prev == null ? '—' : SR.n0(r.prev) }] : []),
          ],
        }));
      })
      .on('pointerleave', () => {
        rule.attr('opacity', 0);
        dots.selectAll('*').remove();
        tip.hide();
      });
    enter(box);
  }

  function drawGoalWeeks() {
    const box = $('#c-goalweeks');
    const d = ready(box, ['goal_weeks', 'goal_info']);
    if (!d || !d[0].length) return;
    const [weeks, info] = d;
    const curYear = SR.utc(info[0].date).getUTCFullYear();
    const prevYear = weeks[0].prev_year;
    const cCur = SR.yearColor(curYear, curYear);
    const cPrev = SR.yearColor(prevYear, curYear);
    $('#goalweeks-legend').replaceChildren(legendItem(cCur, String(curYear)), ...(prevYear ? [legendItem(cPrev, String(prevYear))] : []));
    const W = SR.width(box);
    const H = 260;
    const m = { t: 26, r: 8, b: 30, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Kilomètres par semaine avant la course, comparés à l’an dernier');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.label), [m.l, W - m.r]).paddingInner(0.28).paddingOuter(0.1);
    const ymax = d3.max(weeks, (w) => Math.max(w.cur || 0, w.prev || 0)) || 10;
    const y = d3.scaleLinear([0, ymax * 1.08], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), (t) => `${SR.n0(t)}`);
    unit(svg, m.l - 8, 'km');
    const bw = Math.max(2, (x.bandwidth() - 2) / 2);
    const every = x.step() >= 34 ? 1 : x.step() >= 17 ? 2 : 4;
    weeks.forEach((w, i) => {
      const x0 = x(w.label);
      if (prevYear && w.prev != null) svg.append('path').attr('d', SR.barPath(x0, y(w.prev), bw, y(0) - y(w.prev), 3)).style('fill', cPrev);
      if (w.cur != null) {
        svg.append('path').attr('d', SR.barPath(x0 + bw + 2, y(w.cur), bw, y(0) - y(w.cur), 3)).style('fill', cCur)
          .attr('fill-opacity', w.cur_partial ? 0.45 : 1);
      }
      if ((weeks.length - 1 - i) % every === 0) SR.cap(svg.append('text').attr('x', x0 + x.bandwidth() / 2).attr('y', H - m.b + 17).attr('text-anchor', 'middle')).text(w.label);
    });
    const hit = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.label) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b)
      .style('fill', 'transparent');
    SR.hover(hit, box, tip, (w) => ({
      head: `${w.label} · ${-w.w * 7}e au ${-w.w * 7 - 6}e jour avant la course`.replace('1e', '1er'),
      rows: [
        { color: cCur, label: String(curYear), value: w.cur == null ? 'à venir' : `${SR.n0(w.cur)} km${w.cur_partial ? ' (en cours)' : ''}` },
        ...(prevYear ? [{ color: cPrev, label: String(prevYear), value: `${SR.n0(w.prev)} km` }] : []),
      ],
    }));
    enter(box);
  }

  function drawGoalSplits() {
    const table = $('#t-goalsplits');
    const res = [dash.data('goal_info'), dash.data('race_best')];
    if (res.some((r) => r.status !== 'ok')) return;
    const [info, best] = res.map((r) => r.data);
    if (!info.length || !info[0].target_s) {
      table.closest('.sr-card').hidden = true;
      return;
    }
    const g = info[0];
    const rec = best.find((b) => b.category === g.category);
    const pts = [5, 10, 15, 20].filter((k) => k < g.km).map((k) => ({ k, label: `${k} km` }));
    pts.push({ k: g.km, label: 'Arrivée' });
    table.tBodies[0].classList.remove('dash-skeleton');
    const thead = table.tHead.rows[0];
    thead.replaceChildren(SR.el('th', 'sr-l', 'Passage'), SR.el('th', null, 'Objectif'), ...(rec ? [SR.el('th', null, `Record ${SR.utc(rec.date).getUTCFullYear()}`), SR.el('th', null, 'Écart')] : []));
    table.tBodies[0].replaceChildren(...pts.map((p) => {
      const tr = document.createElement('tr');
      const t = g.target_s * (p.k / g.km);
      tr.append(SR.el('td', 'sr-l sr-key', p.label), SR.el('td', null, SR.dur(t)));
      if (rec) {
        const r = rec.time_s * (p.k / g.km);
        tr.append(SR.el('td', null, SR.dur(r)), SR.el('td', null, gapTxt(t - r)));
      }
      return tr;
    }));
    const note = $('#goalsplits-note');
    if (note) note.textContent = `Allure régulière : ${SR.pace(g.target_pace_s)}/km pour l’objectif${rec ? `, ${SR.pace(rec.time_s / g.km)}/km pour mon record` : ''}`;
    enter(table);
  }

  function drawGoalCalendar() {
    const box = $('#c-goalcal');
    const d = ready(box, ['goal_calendar']);
    if (!d) return;
    const cal = d[0];
    if (!cal.length) {
      empty(box, 'Aucune course prévue.');
      return;
    }
    box.replaceChildren(...cal.map((c) => {
      const li = SR.el('li', `sr-cal__item${c.role === 'objectif' ? ' is-goal' : ''}`);
      const left = daysTo(c.date);
      const when = SR.el('div', 'sr-cal__when');
      when.append(SR.el('span', 'sr-cal__j', left > 0 ? `J-${left}` : left === 0 ? 'Jour J' : 'Courue'), SR.el('span', 'sr-cal__date', SR.dshort(c.date)));
      const what = SR.el('div', 'sr-cal__what');
      what.append(SR.el('span', 'sr-cal__event', c.event), SR.el('span', 'sr-cal__role', c.role));
      const gap = SR.el('div', `sr-cal__gap${c.gap_days != null && c.gap_days <= 7 ? ' is-tight' : ''}`);
      if (c.gap_days != null) gap.append(SR.el('b', null, `J+${c.gap_days}`), txt(` après ${c.prev_event}`));
      li.append(when, what, gap);
      return li;
    }));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  /* ================= Entraînement : constat ================= */
  function drawTrainLead() {
    const box = $('#train-lead');
    const d = ready(box, ['easy_summary', 'vol_summary', 'recov_summary']);
    if (!d) return;
    const [[e], [v], [r]] = d;
    box.replaceChildren();
    const hl = (s, cls = '') => SR.el('span', `sr-hl${cls ? ` ${cls}` : ''}`, s);
    if (e && e.share_8w != null) {
      box.append(txt('Sur 8 semaines, '), hl(SR.pct(e.share_8w)), txt(' de mes footings ont fini en zone grise'));
      if (e.share_prev != null) box.append(txt(` (${SR.pct(e.share_prev)} sur ${e.prev_year})`));
      box.append(txt('. '));
    }
    if (v) {
      box.append(txt('Je cours '), hl(`${SR.n0(v.avg8)} km`), txt(' par semaine en moyenne depuis 8 semaines'));
      if (v.best_n) {
        const m0 = SR.dmonth(v.best_start).toLowerCase();
        const m1 = SR.dmonth(v.best_end).toLowerCase();
        const same = m0.slice(-4) === m1.slice(-4);
        box.append(txt(`, contre ${SR.n0(v.best_avg)} km pendant mon meilleur bloc de ${v.best_n} semaines (${same ? m0.slice(0, -5) : m0} → ${m1})`));
      }
      box.append(txt('. '));
    }
    if (r && r.gap_med != null && r.n) {
      box.append(txt('Après une course, je refais une séance dure au bout de '), hl(`${SR.n0(r.gap_med)} jours`), txt(' en médiane.'));
    }
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  /* ================= Zone grise ================= */
  function drawEasyTiles() {
    const box = $('#easy-tiles');
    const d = ready(box, ['easy_summary']);
    if (!d || !d[0].length) return;
    const e = d[0][0];
    box.replaceChildren(
      tile('Zone grise, 4 semaines', e.share_4w == null ? '—' : SR.pct(e.share_4w), null, [txt(`sur ${SR.n0(e.n_4w)} footings`)], e.share_4w > 0.2 ? 'sr-tile--warn' : 'sr-tile--good'),
      tile(`Zone grise en ${e.year}`, e.share_year == null ? '—' : SR.pct(e.share_year), null, [txt(`${SR.pct(e.share_prev)} en ${e.prev_year}`)]),
      tile('FC des footings', SR.n0(e.hr_med_8w), 'bpm', [txt('médiane sur 8 semaines')]),
      tile('Allure des footings', SR.pace(e.pace_med_8w), '/km', [txt('médiane sur 8 semaines')]),
    );
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawEasyWeeks() {
    const box = $('#c-easyweeks');
    const d = ready(box, ['easy_weeks']);
    if (!d || !d[0].length) return;
    const weeks = d[0];
    const keys = [['facile', 'Facile', C.facile], ['limite', 'Limite', C.limite], ['grise', 'Zone grise', C.grise]];
    $('#easyweeks-legend').replaceChildren(...keys.map(([, l, c]) => legendItem(c, l)));
    const W = SR.width(box);
    const H = 230;
    const m = { t: 12, r: 6, b: 30, l: 26 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Footings par semaine : faciles, limites, en zone grise');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.week), [m.l, W - m.r]).paddingInner(0.24);
    const y = d3.scaleLinear([0, Math.max(4, d3.max(weeks, (w) => w.total) || 4)], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(Math.min(5, y.domain()[1])), SR.n0);
    weeks.forEach((w) => {
      let acc = 0;
      const parts = keys.map(([k, , c]) => ({ k, c, v: w[k] })).filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        const y1 = y(acc + p.v);
        const h = y(acc) - y1 - (acc > 0 ? 2 : 0);
        const x0 = x(w.week);
        svg.append('path').attr('d', j === parts.length - 1 ? SR.barPath(x0, y1, x.bandwidth(), h, 3) : `M${x0},${y1}h${x.bandwidth()}v${h}h${-x.bandwidth()}Z`)
          .style('fill', p.c);
        acc += p.v;
      });
    });
    let lastM = -1;
    weeks.forEach((w) => {
      const dt = SR.utc(w.week);
      if (dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7) {
        lastM = dt.getUTCMonth();
        SR.cap(svg.append('text').attr('x', x(w.week)).attr('y', H - m.b + 17)).text(SR.mon(dt));
      }
    });
    const hit = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.week) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (w) => ({
      head: `Semaine du ${SR.dshort(w.week)}`,
      title: `${SR.n0(w.total)} footing${w.total > 1 ? 's' : ''}${w.hr_avg ? ` · FC moyenne ${SR.n0(w.hr_avg)} bpm` : ''}`,
      rows: keys.map(([k, l, c]) => ({ color: c, label: l, value: SR.n0(w[k]) })),
    }));
    enter(box);
  }

  function drawEasyList() {
    const box = $('#c-easylist');
    const d = ready(box, ['easy_runs_class']);
    if (!d) return;
    const rows = d[0].filter((r) => r.level === 'zone grise').sort((a, b) => b.day - a.day).slice(0, 6);
    if (!rows.length) {
      empty(box, 'Aucun footing en zone grise. Bravo.');
      return;
    }
    box.replaceChildren(...rows.map((r) => {
      const li = SR.el('li');
      const name = SR.el('div');
      name.append(SR.el('span', 'sr-list__name', `${SR.dmed(r.date)} · ${SR.n1(r.km)} km à ${SR.pace(r.pace_s)}/km`),
        SR.el('span', 'sr-list__sub', `${SR.pct(r.z3p)} au-dessus de la zone 2`));
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = C.grise;
      li.append(sw, name, SR.el('span', 'sr-list__value', `${SR.n0(r.hr_avg)} bpm`));
      return li;
    }));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  /* ================= Volume ================= */
  function drawVolTiles() {
    const box = $('#vol-tiles');
    const d = ready(box, ['vol_summary']);
    if (!d || !d[0].length) return;
    const v = d[0][0];
    box.replaceChildren(
      tile('Moyenne 4 semaines', SR.n0(v.avg4), 'km/sem', [txt('jusqu’à la semaine du '), txt(SR.dshort(v.week))]),
      tile('Moyenne 8 semaines', SR.n0(v.avg8), 'km/sem', []),
      tile('Moyenne 13 semaines', SR.n0(v.avg13), 'km/sem', []),
      tile('Meilleur bloc', SR.n0(v.best_n), 'semaines', [txt(`à 90 km et plus, ${SR.n0(v.best_avg)} km/sem en moyenne · ${SR.dmed(v.best_start)} → ${SR.dmed(v.best_end)}`)]),
    );
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawVolume() {
    const box = $('#c-vol');
    const d = ready(box, ['vol_weeks']);
    if (!d || !d[0].length) return;
    const all = d[0];
    const weeks = all.slice(-78).map((w) => ({ ...w, t: SR.utc(w.week) }));
    const k = ui.volAvg;
    const label = { avg4: '4 semaines', avg8: '8 semaines', avg13: '13 semaines' }[k];
    $('#vol-legend').replaceChildren(legendItem(SR.col.muted, 'km de la semaine'), legendItem(SR.col.orange, `moyenne sur ${label}`, 'line'));
    const W = SR.width(box);
    const H = 280;
    const m = { t: 26, r: 40, b: 30, l: 38 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Kilomètres par semaine et moyenne glissante');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.week), [m.l, W - m.r]).paddingInner(0.2);
    const y = d3.scaleLinear([0, Math.max(120, d3.max(weeks, (w) => w.km) || 0) * 1.05], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    unit(svg, m.l - 8, 'km');
    weeks.forEach((w) => {
      if (w.km > 0) svg.append('path').attr('d', SR.barPath(x(w.week), y(w.km), x.bandwidth(), y(0) - y(w.km), Math.min(3, x.bandwidth() / 2)))
        .style('fill', w.km >= 90 ? SR.col.blue : SR.col.muted);
    });
    [90].forEach((ref) => {
      svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(ref)).attr('y2', y(ref)).style('stroke', SR.col.ref).attr('stroke-dasharray', '4 3');
      SR.cap(svg.append('text').attr('x', W - m.r + 4).attr('y', y(ref)).attr('dy', '0.32em')).text(`${ref} km`);
    });
    const cx = (w) => x(w.week) + x.bandwidth() / 2;
    svg.append('path').datum(weeks).style('fill', 'none').style('stroke', SR.col.orange).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round')
      .attr('d', d3.line().x(cx).y((w) => y(w[k])));
    const lastW = weeks[weeks.length - 1];
    svg.append('circle').attr('cx', cx(lastW)).attr('cy', y(lastW[k])).attr('r', 4).style('fill', SR.col.orange).style('stroke', SR.col.panel).attr('stroke-width', 2);
    let lastM = -1;
    weeks.forEach((w) => {
      const mo = w.t.getUTCMonth();
      if (mo !== lastM && w.t.getUTCDate() <= 7) {
        lastM = mo;
        if (mo % (x.step() * 4.3 >= 40 ? 1 : 3) === 0) {
          SR.cap(svg.append('text').attr('x', x(w.week)).attr('y', H - m.b + 17)).text(mo === 0 ? String(w.t.getUTCFullYear()) : SR.mon(w.t));
        }
      }
    });
    const hit = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.week) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (w) => ({
      head: `Semaine du ${SR.dshort(w.week)} ${w.t.getUTCFullYear()}`,
      title: `${SR.n0(w.km)} km en ${SR.n0(w.runs)} sortie${w.runs > 1 ? 's' : ''}`,
      rows: [
        { color: SR.col.orange, line: true, label: 'Moyenne 4 semaines', value: `${SR.n0(w.avg4)} km` },
        { label: 'Moyenne 8 semaines', value: `${SR.n0(w.avg8)} km` },
        { label: 'Moyenne 13 semaines', value: `${SR.n0(w.avg13)} km` },
        ...(w.streak90 ? [{ label: 'Série à 90 km et plus', value: `${w.streak90} sem.` }] : []),
      ],
    }));
    enter(box);
  }

  function drawVolRace() {
    const box = $('#c-volrace');
    const d = ready(box, ['vol_race', 'vol_summary']);
    if (!d || !d[0].length) return;
    const [all, [v]] = d;
    // Sous 5 km par semaine, il manque de l’historique (avant 2023) : le point ne dirait rien.
    const rows = all.filter((r) => r.km8 >= 5);
    if (!rows.length) return;
    const W = SR.width(box);
    const H = 280;
    const m = { t: 26, r: 14, b: 34, l: 40 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Volume des 8 semaines avant chaque course et VDOT obtenu');
    const tip = SR.tip(box);
    const x = d3.scaleLinear([0, Math.max(120, d3.max(rows, (r) => r.km8) || 0) * 1.05], [m.l, W - m.r]).nice();
    const yExt = d3.extent(rows, (r) => r.vdot);
    const y = d3.scaleLinear([Math.floor(yExt[0] - 1), Math.ceil(yExt[1] + 1)], [H - m.b, m.t]);
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.n0);
    x.ticks(5).forEach((t) => SR.cap(svg.append('text').attr('x', x(t)).attr('y', H - m.b + 17).attr('text-anchor', 'middle')).text(SR.n0(t)));
    SR.cap(svg.append('text').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end')).text('km par semaine sur les 8 semaines d’avant →');
    unit(svg, m.l - 8, 'VDOT');
    if (v) {
      const px = x(v.avg8);
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', m.t).attr('y2', H - m.b).style('stroke', SR.col.orange).attr('stroke-dasharray', '4 3');
      const right = px > m.l + (W - m.l - m.r) * 0.7;
      halo(SR.cap(svg.append('text').attr('x', right ? px - 5 : px + 5).attr('y', H - m.b - 8).attr('text-anchor', right ? 'end' : 'start')))
        .text(`maintenant : ${SR.n0(v.avg8)} km/sem`);
    }
    const cur = d3.max(rows, (r) => r.year);
    const dots = svg.append('g').selectAll('circle').data([...rows].sort((a, b) => a.year - b.year)).join('circle')
      .attr('cx', (r) => x(r.km8)).attr('cy', (r) => y(r.vdot)).attr('r', 5.5)
      .style('fill', (r) => SR.yearColor(r.year, cur)).style('stroke', SR.col.panel).attr('stroke-width', 2);
    const top = rows.reduce((a, r) => (!a || r.vdot > a.vdot ? r : a), null);
    if (top) {
      const tx = x(top.km8);
      const anchor = tx > W - m.r - 70 ? 'end' : tx < m.l + 70 ? 'start' : 'middle';
      halo(SR.cap(svg.append('text').attr('x', anchor === 'end' ? tx + 6 : anchor === 'start' ? tx - 6 : tx).attr('y', y(top.vdot) - 11).attr('text-anchor', anchor)))
        .style('fill', 'var(--color-fg)').text(`${top.event}, ${SR.utc(top.date).getUTCFullYear()}`);
    }
    $('#volrace-legend').replaceChildren(...[cur, cur - 1, cur - 2].filter((yr) => rows.some((r) => r.year === yr)).map((yr) => legendItem(SR.yearColor(yr, cur), String(yr), 'dot')),
      ...(rows.some((r) => r.year < cur - 2) ? [legendItem(SR.col.muted, `avant ${cur - 2}`, 'dot')] : []));
    SR.hover(dots, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.event,
      rows: [
        { color: SR.yearColor(r.year, cur), label: 'VDOT', value: SR.n1(r.vdot) },
        { label: 'Volume des 8 semaines d’avant', value: `${SR.n0(r.km8)} km/sem` },
      ],
    }));
    enter(box);
  }

  function drawLongRuns() {
    const box = $('#c-long');
    const d = ready(box, ['long_runs']);
    if (!d) return;
    const rows = d[0].filter((r) => r.date >= '2024-01-01').map((r) => ({ ...r, t: SR.utc(r.date) }));
    if (!rows.length) {
      empty(box, 'Aucune sortie de 18 km ou plus depuis 2024.');
      return;
    }
    $('#long-legend').replaceChildren(legendItem(SR.col.blue, 'entraînement', 'dot'), legendItem(SR.col.orange, 'compétition', 'dot'));
    const W = SR.width(box);
    const H = 280;
    const m = { t: 26, r: 14, b: 30, l: 34 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Sorties de 18 km et plus depuis 2024');
    const tip = SR.tip(box);
    const last = SR.utc(d3.max(rows, (r) => r.date));
    const x = d3.scaleUtc([SR.utc('2024-01-01'), new Date(last.getTime() + 20 * DAY)], [m.l, W - m.r]);
    const y = d3.scaleLinear([16, Math.max(44, d3.max(rows, (r) => r.km) + 2)], [H - m.b, m.t]);
    SR.gridY(svg, y, m.l, W - m.r, [20, 25, 30, 35, 40].filter((t) => t <= y.domain()[1]), SR.n0);
    unit(svg, m.l - 8, 'km');
    timeAxis(svg, x, H - m.b);
    const dots = svg.append('g').selectAll('circle').data([...rows].sort((a, b) => Number(a.race) - Number(b.race))).join('circle')
      .attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.km)).attr('r', (r) => (r.km >= 25 ? 5.5 : 4))
      .style('fill', (r) => (r.race ? SR.col.orange : SR.col.blue)).attr('fill-opacity', (r) => (r.km >= 25 || r.race ? 1 : 0.55))
      .style('stroke', SR.col.panel).attr('stroke-width', 1.5);
    SR.hover(dots, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.race ? r.event : r.name,
      rows: [
        { color: r.race ? SR.col.orange : SR.col.blue, label: 'Distance', value: `${SR.n1(r.km)} km` },
        { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
      ],
    }));
    enter(box);
  }

  /* ================= Récupération ================= */
  function drawRecovTiles() {
    const box = $('#recov-tiles');
    const d = ready(box, ['recov_summary']);
    if (!d || !d[0].length) return;
    const r = d[0][0];
    box.replaceChildren(
      tile('Reprise de l’intensité', r.gap_med == null ? '—' : SR.n0(r.gap_med), 'jours', [txt(`après une course, en médiane (${SR.n0(r.n)} courses en 12 mois)`)], r.gap_med != null && r.gap_med <= 3 ? 'sr-tile--warn' : null),
      tile('Reprise en moins de 72 h', r.share_72h == null ? '—' : SR.pct(r.share_72h), null, [txt('des courses des 12 derniers mois')], r.share_72h > 0.25 ? 'sr-tile--warn' : null),
      tile('Courses courues', SR.n0(r.races_8w), null, [txt('sur les 8 dernières semaines')]),
      tile('Courses à venir', SR.n0(r.next_8w), null, [txt('dans les 8 semaines')], r.next_8w >= 3 ? 'sr-tile--warn' : null),
    );
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  function drawRecov() {
    const box = $('#c-recov');
    const d = ready(box, ['recov']);
    if (!d || !d[0].length) return;
    const rows = d[0];
    const cls = (r) => (r.gap == null ? 'none' : r.gap <= 3 ? 'bad' : r.gap <= 6 ? 'mid' : 'ok');
    const col = { bad: C.grise, mid: C.limite, ok: C.facile, none: C.facile };
    $('#recov-legend').replaceChildren(legendItem(col.ok, '7 jours et plus'), legendItem(col.mid, '4 à 6 jours'), legendItem(col.bad, '3 jours ou moins'));
    const W = SR.width(box);
    const H = 240;
    const m = { t: 26, r: 8, b: 30, l: 30 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Jours entre chaque course et la séance dure suivante');
    const tip = SR.tip(box);
    const x = d3.scaleBand(rows.map((r) => r.id), [m.l, W - m.r]).paddingInner(0.25);
    const cap = 14;
    const y = d3.scaleLinear([0, cap], [H - m.b, m.t]);
    SR.gridY(svg, y, m.l, W - m.r, [0, 3, 7, 14], SR.n0);
    unit(svg, m.l - 8, 'jours');
    rows.forEach((r) => {
      const v = r.gap == null ? (r.open ? Math.min(cap, Math.max(1, -daysTo(r.date))) : cap) : Math.min(cap, r.gap);
      const p = svg.append('path').attr('d', SR.barPath(x(r.id), y(v), x.bandwidth(), y(0) - y(v), Math.min(3, x.bandwidth() / 2)))
        .style('fill', col[cls(r)]);
      // Course trop récente pour savoir : barre en pointillés, sans remplissage.
      if (r.gap == null) p.style('fill', 'none').style('stroke', col.none).attr('stroke-width', 1).attr('stroke-dasharray', '3 2');
    });
    let lastY = null;
    rows.forEach((r) => {
      const yr = r.date.slice(0, 4);
      if (yr !== lastY) {
        lastY = yr;
        SR.cap(svg.append('text').attr('x', x(r.id)).attr('y', H - m.b + 17)).text(yr);
      }
    });
    const hit = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.id) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (r) => ({
      head: SR.dmed(r.date),
      title: r.event,
      rows: [
        { color: col[cls(r)], label: 'Séance dure suivante', value: r.gap == null ? (r.open ? `pas encore (J+${Math.max(0, -daysTo(r.date))})` : 'aucune') : `J+${r.gap}` },
        ...(r.next_label ? [{ label: SR.dmed(r.next_date), value: r.next_label }] : []),
        { label: 'Charge 7 jours avant → après', value: `${SR.n0(r.load_before)} → ${SR.n0(r.load_after)}` },
      ],
    }));
    enter(box);
  }

  function drawDensity() {
    const box = $('#c-density');
    const d = ready(box, ['race_density']);
    if (!d || !d[0].length) return;
    const rows = d[0].map((r) => ({ ...r, t: SR.utc(r.week) }));
    $('#density-legend').replaceChildren(legendItem(SR.col.blue, 'courses sur 8 semaines'), legendItem('var(--color-fg)', 'course de la semaine', 'diamond'));
    const W = SR.width(box);
    const H = 240;
    const m = { t: 22, r: 8, b: 30, l: 22 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Nombre de courses sur 8 semaines glissantes, semaine par semaine, calendrier à venir compris');
    const tip = SR.tip(box);
    const x = d3.scaleBand(rows.map((r) => r.week), [m.l, W - m.r]).paddingInner(0.24);
    const y = d3.scaleLinear([0, Math.max(4, d3.max(rows, (r) => r.n) + 0.9)], [H - m.b, m.t]);
    SR.gridY(svg, y, m.l, W - m.r, d3.range(0, Math.floor(y.domain()[1]) + 1), SR.n0);
    const bw = x.bandwidth();
    rows.forEach((r) => {
      const x0 = x(r.week);
      if (r.n > 0) {
        const p = svg.append('path').attr('d', SR.barPath(x0, y(r.n), bw, y(0) - y(r.n), Math.min(3, bw / 2))).style('fill', SR.col.blue);
        // Semaines à venir : en pointillés, elles dépendent du calendrier.
        if (r.future) p.style('fill', 'none').style('stroke', SR.col.blue).attr('stroke-width', 1.2).attr('stroke-dasharray', '3 2');
      }
      if (r.k) {
        const rr = Math.max(3.5, Math.min(5.5, bw / 2));
        svg.append('path').attr('d', diamond(x0 + bw / 2, y(r.n) - rr - 4, rr))
          .style('fill', r.future ? 'var(--color-panel)' : 'var(--color-fg)').style('stroke', r.future ? 'var(--color-fg)' : SR.col.panel)
          .attr('stroke-width', 1.5);
      }
    });
    const firstFut = rows.find((r) => r.future);
    if (firstFut) {
      const px = x(firstFut.week) - (x.step() - bw) / 2;
      svg.append('line').attr('x1', px).attr('x2', px).attr('y1', m.t - 8).attr('y2', H - m.b).style('stroke', SR.col.ref).attr('stroke-dasharray', '3 3');
      SR.cap(svg.append('text').attr('x', px + 4).attr('y', m.t - 10)).text('à venir →');
    }
    let lastM = -1;
    rows.forEach((r) => {
      if (r.t.getUTCMonth() !== lastM && r.t.getUTCDate() <= 7) {
        lastM = r.t.getUTCMonth();
        SR.cap(svg.append('text').attr('x', x(r.week)).attr('y', H - m.b + 17)).text(SR.mon(r.t));
      }
    });
    const hit = svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', (r) => x(r.week) - (x.step() - bw) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (r) => ({
      head: `Semaine du ${SR.dshort(r.week)} ${r.t.getUTCFullYear()}${r.future ? ' · à venir' : ''}`,
      title: r.k ? r.events : 'Pas de course cette semaine',
      rows: [{ color: SR.col.blue, label: 'Courses sur 8 semaines', value: SR.n0(r.n) }],
    }));
    enter(box);
  }

  /* ================= Séances clés ================= */
  const qTypes = [
    ['court', 'Fractionné court', C.court],
    ['long', 'Fractionné long', C.long],
    ['seuil', 'Seuil / tempo', C.seuil],
    ['autre', 'Sans tours (repérée au cardio)', C.autre],
  ];
  function drawCoverage() {
    const el = $('#laps-cov');
    const res = dash.data('laps_coverage');
    if (!el || res.status !== 'ok' || !res.data.length) return;
    const c = res.data[0];
    el.textContent = c.with_laps >= c.runs
      ? `Repérées avec les tours de la montre, connus pour les ${SR.n0(c.runs)} sorties`
      : `Tours de la montre connus pour ${SR.n0(c.with_laps)} sorties sur ${SR.n0(c.runs)}${c.oldest ? ` (depuis le ${SR.dlong(c.oldest)})` : ''} : l’historique se complète chaque nuit`;
  }

  function drawQualityWeeks() {
    const box = $('#c-qweeks');
    const d = ready(box, ['quality_weeks']);
    if (!d || !d[0].length) return;
    const weeks = d[0];
    $('#qweeks-legend').replaceChildren(...qTypes.filter(([k]) => weeks.some((w) => w[k] > 0)).map(([, l, c]) => legendItem(c, l)),
      ...(weeks.some((w) => w.course > 0) ? [legendItem('var(--color-fg)', 'compétition', 'diamond')] : []));
    const W = SR.width(box);
    const H = 230;
    const m = { t: 12, r: 26, b: 30, l: 22 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Séances de qualité par semaine');
    const tip = SR.tip(box);
    const x = d3.scaleBand(weeks.map((w) => w.week), [m.l, W - m.r]).paddingInner(0.24);
    const tot = (w) => qTypes.reduce((s, [k]) => s + w[k], 0);
    const y = d3.scaleLinear([0, Math.max(3, d3.max(weeks, (w) => tot(w) + (w.course ? 0.8 : 0)))], [H - m.b, m.t]).nice();
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(Math.min(4, y.domain()[1])), SR.n0);
    svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(2)).attr('y2', y(2)).style('stroke', SR.col.ref).attr('stroke-dasharray', '4 3');
    SR.cap(svg.append('text').attr('x', W - m.r + 4).attr('y', y(2)).attr('dy', '0.32em')).text('2');
    weeks.forEach((w) => {
      let acc = 0;
      const parts = qTypes.map(([k, , c]) => ({ k, c, v: w[k] })).filter((p) => p.v > 0);
      const x0 = x(w.week);
      parts.forEach((p, j) => {
        const y1 = y(acc + p.v);
        const h = y(acc) - y1 - (acc > 0 ? 2 : 0);
        svg.append('path').attr('d', j === parts.length - 1 ? SR.barPath(x0, y1, x.bandwidth(), h, 3) : `M${x0},${y1}h${x.bandwidth()}v${h}h${-x.bandwidth()}Z`).style('fill', p.c);
        acc += p.v;
      });
      if (w.course) {
        const r = Math.max(3.5, Math.min(5.5, x.bandwidth() / 2));
        svg.append('path').attr('d', diamond(x0 + x.bandwidth() / 2, y(acc) - r - 3, r)).style('fill', 'var(--color-fg)')
          .style('stroke', SR.col.panel).attr('stroke-width', 1.5);
      }
    });
    let lastM = -1;
    weeks.forEach((w) => {
      const dt = SR.utc(w.week);
      if (dt.getUTCMonth() !== lastM && dt.getUTCDate() <= 7) {
        lastM = dt.getUTCMonth();
        SR.cap(svg.append('text').attr('x', x(w.week)).attr('y', H - m.b + 19)).text(SR.mon(dt));
      }
    });
    const hit = svg.append('g').selectAll('rect').data(weeks).join('rect')
      .attr('x', (w) => x(w.week) - (x.step() - x.bandwidth()) / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (w) => ({
      head: `Semaine du ${SR.dshort(w.week)} · ${SR.n0(w.runs)} sortie${w.runs > 1 ? 's' : ''}, tours connus pour ${SR.n0(w.laps)}`,
      title: tot(w) ? `${SR.n0(tot(w))} séance${tot(w) > 1 ? 's' : ''} dure${tot(w) > 1 ? 's' : ''}` : 'Aucune séance dure',
      rows: [
        ...qTypes.filter(([k]) => w[k] > 0).map(([k, l, c]) => ({ color: c, label: l, value: SR.n0(w[k]) })),
        ...(w.course ? [{ label: w.course > 1 ? 'Compétitions' : 'Compétition', value: SR.n0(w.course) }] : []),
      ],
    }));
    enter(box);
  }

  function drawQualityList() {
    const box = $('#c-qlist');
    const d = ready(box, ['quality_list']);
    if (!d) return;
    const rows = d[0].slice(0, 12);
    if (!rows.length) {
      empty(box, 'Pas encore de séance repérée avec les tours : ils arrivent au fil des nuits.');
      return;
    }
    if (!ui.qSel || !rows.some((r) => r.id === ui.qSel)) ui.qSel = rows[0].id;
    const color = (t) => (qTypes.find(([, l]) => l === t) || [null, null, SR.col.muted])[2];
    box.replaceChildren(...rows.map((r) => {
      const li = SR.el('li');
      const b = SR.el('button', 'sr-qbtn');
      b.type = 'button';
      b.dataset.id = r.id;
      b.setAttribute('aria-pressed', String(r.id === ui.qSel));
      const sw = SR.el('i', 'sr-sw');
      sw.style.background = color(r.type);
      const name = SR.el('span', 'sr-qbtn__main');
      name.append(SR.el('span', 'sr-list__name', r.structure),
        SR.el('span', 'sr-list__sub', `${SR.dshort(r.date)} · ${r.type} · ${SR.n1(r.work_km)} km de travail`));
      const val = SR.el('span', 'sr-list__value', `${SR.pace(r.rep_pace)}/km`);
      if (r.rep_hr) val.append(SR.el('small', null, `${SR.n0(r.rep_hr)} bpm`));
      b.append(sw, name, val);
      b.addEventListener('click', () => {
        ui.qSel = r.id;
        box.querySelectorAll('.sr-qbtn').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.id === r.id)));
        run(drawQualityReps);
      });
      li.append(b);
      return li;
    }));
    box.classList.remove('dash-skeleton');
    enter(box);
  }

  // Détail d’une séance : un point par répétition (allure, plus rapide en haut), reliés entre répétitions de même longueur.
  function drawQualityReps() {
    const box = $('#c-qreps');
    const d = ready(box, ['quality_list']);
    if (!d) return;
    const rows = d[0];
    const s = rows.find((r) => r.id === ui.qSel) || rows[0];
    const head = $('#qreps-title');
    const note = $('#qreps-note');
    if (!s) {
      if (head) head.textContent = 'Détail d’une séance';
      empty(box, 'Aucune séance à détailler pour l’instant.');
      return;
    }
    if (head) head.textContent = s.structure;
    if (note) {
      note.textContent = `${SR.dday(s.date)} · ${s.type.toLowerCase()} · ${SR.pace(s.rep_pace)}/km en moyenne${s.rep_hr ? ` à ${SR.n0(s.rep_hr)} bpm` : ''}${s.rep_sd != null ? ` · régularité ±${SR.n0(s.rep_sd)} s/km` : ''}`;
    }
    const lab = (dm) => (dm >= 1950 ? `${SR.n1(dm / 1000)} km` : `${dm >= 1000 ? Math.round(dm / 100) * 100 : Math.round(dm / 50) * 50} m`);
    const reps = s.detail.map((r, i) => ({ ...r, i, pace: r.t / (r.d / 1000), lab: lab(r.d) }));
    const color = (qTypes.find(([, l]) => l === s.type) || [null, null, SR.col.blue])[2];
    const hasHr = reps.some((r) => r.hr);
    const W = SR.width(box);
    const H = 230;
    const m = { t: 24, r: 12, b: hasHr ? 40 : 26, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Allure et FC de chaque répétition');
    const tip = SR.tip(box);
    const x = d3.scalePoint(reps.map((r) => r.i), [m.l, W - m.r]).padding(0.5);
    const pMin = d3.min(reps, (r) => r.pace);
    const pMax = d3.max(reps, (r) => r.pace);
    const span = Math.max(20, pMax - pMin);
    const y = d3.scaleLinear([pMax + span * 0.25, pMin - span * 0.35], [H - m.b, m.t]);
    const step = span > 60 ? 20 : span > 30 ? 10 : 5;
    SR.gridY(svg, y, m.l, W - m.r, d3.range(Math.ceil(y.domain()[1] / step) * step, y.domain()[0], step), SR.pace, { noBase: true });
    // Répétitions de même longueur qui se suivent : on relie les points pour voir la tenue de l’allure.
    d3.groups(reps, (r) => r.lab).filter(([, g]) => g.length > 1 && g[g.length - 1].i - g[0].i === g.length - 1).forEach(([, g]) => {
      svg.append('path').datum(g).style('fill', 'none').style('stroke', color).attr('stroke-opacity', 0.45).attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round').attr('d', d3.line().x((r) => x(r.i)).y((r) => y(r.pace)));
    });
    svg.append('g').selectAll('circle').data(reps).join('circle')
      .attr('cx', (r) => x(r.i)).attr('cy', (r) => y(r.pace)).attr('r', 6)
      .style('fill', color).style('stroke', SR.col.panel).attr('stroke-width', 2);
    const roomy = x.step() >= 34;
    reps.forEach((r) => {
      if (roomy || reps.length <= 8) {
        halo(svg.append('text').attr('x', x(r.i)).attr('y', y(r.pace) - 12).attr('text-anchor', 'middle')
          .style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg)')).text(SR.pace(r.pace));
      }
      if (roomy || r.i === 0 || r.lab !== reps[r.i - 1].lab) {
        SR.cap(svg.append('text').attr('x', x(r.i)).attr('y', H - m.b + 16).attr('text-anchor', 'middle')).text(r.lab);
      }
      if (hasHr && (roomy || r.i % 2 === 0)) {
        SR.cap(svg.append('text').attr('x', x(r.i)).attr('y', H - m.b + 31).attr('text-anchor', 'middle')).text(r.hr ? String(r.hr) : '—');
      }
    });
    if (hasHr) SR.cap(svg.append('text').attr('x', m.l - 8).attr('y', H - m.b + 31).attr('text-anchor', 'end')).text('bpm');
    const hit = svg.append('g').selectAll('rect').data(reps).join('rect')
      .attr('x', (r) => x(r.i) - x.step() / 2).attr('y', m.t).attr('width', x.step()).attr('height', H - m.t - m.b).style('fill', 'transparent');
    SR.hover(hit, box, tip, (r) => ({
      head: `Répétition ${r.i + 1} sur ${reps.length}`,
      title: `${SR.n0(r.d)} m en ${SR.dur(r.t)}`,
      rows: [
        { color, label: 'Allure', value: `${SR.pace(r.pace)}/km` },
        ...(r.hr ? [{ label: 'FC moyenne', value: `${r.hr} bpm` }] : []),
      ],
    }));
    enter(box);
  }

  /* ================= Records à l’entraînement ================= */
  function drawEffortTable() {
    const table = $('#t-efforts');
    const res = dash.data('effort_best');
    const tbody = table.tBodies[0];
    if (res.status !== 'ok') {
      if (!tbody.children.length) tbody.classList.add('dash-skeleton');
      return;
    }
    tbody.classList.remove('dash-skeleton');
    // Tant que l’historique des meilleurs efforts n’est pas rattrapé, le « record » n’est que le meilleur connu.
    const cov = dash.data('laps_coverage');
    const partial = cov.status === 'ok' && cov.data[0] && cov.data[0].with_laps < cov.data[0].runs;
    table.tHead.rows[0].cells[1].textContent = partial ? 'Meilleur connu' : 'Record';
    const rows = res.data.filter((r) => ['400 m', '1 km', '1 mile', '5 km', '10 km', '15 km', 'Semi', 'Marathon'].includes(r.effort));
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = SR.el('td', 'sr-l sr-muted', 'Les meilleurs efforts arrivent avec les tours, au fil des nuits.');
      td.colSpan = 4;
      tr.append(td);
      tbody.replaceChildren(tr);
      return;
    }
    tbody.replaceChildren(...rows.map((r) => {
      const tr = document.createElement('tr');
      const best = SR.el('td');
      best.append(SR.el('b', null, SR.dur(r.best_s)), SR.el('span', 'sr-cell-sub', `${SR.dmed(r.best_date)}${r.best_race ? ' · course' : ''}`));
      const y = SR.el('td', 'sr-hide-sm', r.y_s == null ? '—' : SR.dur(r.y_s));
      const mo = SR.el('td', r.m_s == null ? 'sr-muted' : null, r.m_s == null ? '—' : SR.dur(r.m_s));
      tr.append(SR.el('td', 'sr-l sr-key', r.effort), best, y, mo);
      return tr;
    }));
    enter(table);
  }

  function drawEffortMonthly() {
    const box = $('#c-effmonth');
    const d = ready(box, ['effort_monthly']);
    if (!d) return;
    const rows = d[0];
    const months = [...new Set(rows.map((r) => r.month))].sort();
    if (months.length < 3) {
      $('#effmonth-legend').replaceChildren();
      empty(box, months.length
        ? `${months.length === 1 ? 'Un seul mois connu' : 'Deux mois connus'} pour l’instant : la courbe se dessinera au fil des nuits, à mesure que l’historique arrive.`
        : 'Les meilleurs efforts arrivent avec les tours, au fil des nuits.');
      return;
    }
    const series = [['1 km', SR.col.blue], ['5 km', SR.col.orange], ['10 km', SR.col.aqua]].filter(([k]) => rows.some((r) => r.effort === k));
    $('#effmonth-legend').replaceChildren(...series.map(([k, c]) => legendItem(c, k, 'line')));
    const W = SR.width(box);
    const H = 260;
    const m = { t: 14, r: 14, b: 30, l: 44 };
    box.replaceChildren();
    const svg = SR.svg(box, W, H).attr('aria-label', 'Meilleure allure du mois sur 1 km, 5 km et 10 km');
    const tip = SR.tip(box);
    const t0 = SR.utc(`${months[0]}-01`);
    const t1 = SR.utc(`${months[months.length - 1]}-01`);
    const x = d3.scaleUtc([t0, t1.getTime() === t0.getTime() ? new Date(t0.getTime() + 30 * DAY) : t1], [m.l, W - m.r]);
    const ext = d3.extent(rows, (r) => r.pace_s);
    const y = d3.scaleLinear([Math.ceil((ext[1] + 8) / 10) * 10, Math.floor((ext[0] - 8) / 10) * 10], [H - m.b, m.t]);
    SR.gridY(svg, y, m.l, W - m.r, y.ticks(4), SR.pace, { noBase: true });
    timeAxis(svg, x, H - m.b);
    series.forEach(([k, c]) => {
      const pts = rows.filter((r) => r.effort === k).map((r) => ({ ...r, t: SR.utc(`${r.month}-01`) }));
      svg.append('path').datum(pts).style('fill', 'none').style('stroke', c).attr('stroke-width', 2).attr('stroke-linejoin', 'round')
        .attr('d', d3.line().x((r) => x(r.t)).y((r) => y(r.pace_s)));
      const dots = svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (r) => x(r.t)).attr('cy', (r) => y(r.pace_s))
        .attr('r', pts.length > 24 ? 3 : 4).style('fill', c).style('stroke', SR.col.panel).attr('stroke-width', 1.5);
      SR.hover(dots, box, tip, (r) => ({
        head: SR.dmonth(r.month),
        title: `Meilleur ${k} du mois`,
        rows: [
          { color: c, label: 'Temps', value: SR.dur(r.s) },
          { label: 'Allure', value: `${SR.pace(r.pace_s)}/km` },
          { label: 'Le', value: SR.dmed(r.date) },
        ],
      }));
    });
    enter(box);
  }

  SR.pages = SR.pages || {};
  const add = (page, fns) => {
    SR.pages[page] = (SR.pages[page] || []).concat(fns);
  };
  add('objectif', [drawGoalHero, drawGoalTiles, drawGoalBuild, drawGoalWeeks, drawGoalSplits, drawGoalCalendar]);
  add('entrainement', [drawTrainLead, drawVolTiles, drawVolume, drawLongRuns, drawVolRace, drawCoverage, drawQualityWeeks, drawQualityList,
    drawQualityReps, drawEasyTiles, drawEasyWeeks, drawEasyList, drawRecovTiles, drawRecov, drawDensity, drawEffortTable, drawEffortMonthly]);
  seg('vol-avg', 'volAvg', drawVolume);
})();
