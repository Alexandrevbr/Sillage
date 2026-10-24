/* Fiche athlète : ma carte de visite de coureur. La photo, mes records, mes chiffres clés, quatre points forts
 * tirés des données, mes meilleurs classements et mon prochain objectif (calcul « athlete »). */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const NB = ' ';
  const DAY = 864e5;
  // La course où la photo a été prise : la légende reprend son chrono.
  const PHOTO = { date: '2026-10-11', category: '20 km' };
  const MAIN = ['10 km', 'Semi', '20 km', 'Marathon'];
  const CAT = { '10 km': 'au 10 km', Semi: 'au semi', '20 km': 'au 20 km', Marathon: 'au marathon' };
  const brand = 'var(--sr-brand)';
  const muted = 'var(--cds-chart-muted)';
  const txt = (s) => document.createTextNode(s);
  const yearOf = (iso) => Number(String(iso).slice(0, 4));
  // « au 10 km du 17e », « au Semi de Rome », mais « à Paris-Versailles ».
  const au = (ev) => (/^(\d|semi|marathon|trail|cross|relais)/i.test(ev) ? `au ${ev}` : `à ${ev}`);
  const monthYear = (iso) => SR.dmonth(iso).toLowerCase();
  const today = () => {
    const n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY;
  };
  const dayOf = (iso) => SR.utc(iso).getTime() / DAY;
  // Part du peloton devant moi, arrondie au dixième supérieur : la fiche ne m’attribue jamais mieux que la réalité.
  const topTxt = (p) => `${SR.n1(Math.ceil(p * 10 - 1e-9) / 10)}${NB}%`;
  const gapTxt = (s) => {
    const a = Math.round(Math.abs(s));
    return a < 60 ? `${a}${NB}s` : SR.dur(a);
  };
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
    if (!el || entered.has(el)) return;
    entered.add(el);
    el.classList.add('sr-enter');
  };

  /* ================= En-tête : photo, records, chiffres clés ================= */
  let shareText = '';
  function drawHero() {
    const stats = $('#athlete-stats');
    const recs = $('#athlete-records');
    if (!stats || !recs) return;
    const d = SR.ready(stats, ['athlete', 'race_results']);
    SR.ready(recs, ['athlete', 'race_results']);
    if (!d || !d[0].length) return;
    const [[a], results] = d;

    const main = a.records.filter((r) => MAIN.includes(r.category));
    recs.replaceChildren(...main.map((r) => {
      const el = SR.el('div', 'sr-athlete__rec');
      el.title = `${r.event}, ${SR.dlong(r.date)}`;
      el.append(
        SR.el('span', 'sr-athlete__rec-cat', r.category),
        SR.el('span', 'sr-athlete__rec-time', SR.dur(r.time_s)),
        SR.el('span', 'sr-athlete__rec-sub', `${SR.pace(r.pace_s)}/km · ${yearOf(r.date)}`),
      );
      return el;
    }));

    const stat = (value, unit, label) => {
      const div = SR.el('div', 'sr-athlete__stat');
      const dd = SR.el('dd', null, value);
      if (unit) dd.append(SR.el('span', 'sr-unit', unit));
      div.append(SR.el('dt', null, label), dd);
      return div;
    };
    const items = [];
    if (a.best_vdot != null) items.push(stat(SR.n1(a.best_vdot), null, 'VDOT, mon meilleur niveau'));
    items.push(stat(SR.n0(a.races), null, `compétitions depuis ${a.first_race_year}`));
    items.push(stat(SR.n0(a.prs), null, 'records personnels battus'));
    items.push(stat(SR.n0(a.km), 'km', `courus depuis ${yearOf(a.first_date)}`));
    stats.replaceChildren(...items);

    const cap = $('#athlete-caption');
    const shot = results.find((r) => r.date === PHOTO.date && r.category === PHOTO.category);
    if (cap && shot) {
      cap.replaceChildren(
        SR.el('b', null, `${shot.event} ${yearOf(shot.date)}`),
        SR.el('span', null, `${SR.dur(shot.time_s)}${shot.pr ? ' · record battu' : ''}`),
      );
    }
    shareText = `Alexandre Barreau, coureur sur route : ${main.filter((r) => r.category !== '20 km')
      .map((r) => `${SR.dur(r.time_s)} ${CAT[r.category]}`).join(', ')}.`;
    enter(recs);
    enter(stats);
  }

  /* Photo plus haute que son format (tablette) : elle est rognée sur les côtés. On décale la fenêtre pour garder
   * le coureur entier et, si la place le permet, le logo de l’épreuve en bas à droite. Repères en part de la largeur. */
  const RUNNER = [0.27, 0.7];
  function fitPhoto() {
    const fig = $('.sr-athlete__photo');
    const img = fig && fig.querySelector('img');
    if (!img || !fig.clientWidth || !fig.clientHeight) return;
    const iw = img.naturalWidth || 1000;
    const ih = img.naturalHeight || 1500;
    const scale = Math.max(fig.clientWidth / iw, fig.clientHeight / ih);
    const f = fig.clientWidth / (iw * scale); // part de la largeur visible
    if (f > 0.995) {
      img.style.objectPosition = '';
      return;
    }
    const lo = Math.max(0, RUNNER[1] - f);
    const hi = Math.min(RUNNER[0], 1 - f);
    const o = lo <= hi ? hi : Math.max(0, Math.min(1 - f, (RUNNER[0] + RUNNER[1] - f) / 2));
    img.style.objectPosition = `${((o / (1 - f)) * 100).toFixed(1)}% 100%`;
  }
  const fig = $('.sr-athlete__photo');
  if (fig && 'ResizeObserver' in window) new ResizeObserver(() => run(fitPhoto)).observe(fig);

  /* ================= Points forts ================= */
  const ICONS = {
    speed: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
    star: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.7 10.1 6 3h4l2 4.3L14 3h4l-2.7 7.1"/>',
    prog: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    endu: '<path d="M18.2 8.5c-1.9 0-3.3 1.4-6.2 3.5s-4.3 3.5-6.2 3.5a3.5 3.5 0 1 1 0-7c1.9 0 3.3 1.4 6.2 3.5s4.3 3.5 6.2 3.5a3.5 3.5 0 1 0 0-7z"/>',
  };
  const force = (icon, label, value, qual, sub, aria, chart) => {
    const el = SR.el('article', 'sr-force');
    const ic = SR.el('span', 'sr-force__icon');
    ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    const head = SR.el('div', 'sr-force__head');
    head.append(ic, SR.el('h3', 'sr-force__label', label));
    el.append(head, SR.el('p', 'sr-force__value', value), SR.el('p', 'sr-force__qual', qual), SR.el('p', 'sr-force__sub', sub));
    const host = SR.el('div', 'sr-force__chart');
    el.append(host);
    el.draw = () => {
      const W = Math.max(120, Math.floor(host.clientWidth || 150));
      const H = 64;
      const svg = d3.select(host).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('width', '100%')
        .attr('role', 'img').attr('aria-label', aria).style('height', 'auto');
      chart(svg, W, H, host);
    };
    return el;
  };

  // Chronos d’une distance au fil du temps : le plus rapide en haut, le meilleur en bleu.
  const timeChart = (pts, opts) => (svg, W, H, host) => {
    const best = pts.reduce((m, p) => (p.time_s < m.time_s ? p : m));
    const ext = d3.extent(pts, (p) => p.time_s);
    if (opts.ref) ext[0] = Math.min(ext[0], opts.ref);
    const span = Math.max(1, ext[1] - ext[0]);
    const right = opts.ref ? 24 : 6;
    const x = d3.scaleUtc(d3.extent(pts, (p) => SR.utc(p.date)), [6, W - right]);
    const y = d3.scaleLinear([ext[1] + span * 0.06, ext[0] - span * 0.06], [H - 6, 6]);
    if (opts.ref) {
      svg.append('line').attr('x1', 0).attr('x2', W - right + 4).attr('y1', y(opts.ref)).attr('y2', y(opts.ref))
        .style('stroke', 'var(--cds-chart-reference)').attr('stroke-width', 1).attr('stroke-dasharray', '3 3');
      SR.cap(svg.append('text').attr('x', W).attr('y', y(opts.ref)).attr('dy', '0.32em').attr('text-anchor', 'end'))
        .style('font-size', '11px').text(opts.refLabel);
    }
    if (opts.line) {
      svg.append('path').datum(pts).attr('d', d3.line().x((p) => x(SR.utc(p.date))).y((p) => y(p.time_s)).curve(d3.curveMonotoneX))
        .style('fill', 'none').style('stroke', brand).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('opacity', 0.9);
    }
    const dot = (p) => (p === best ? brand : opts.line ? brand : muted);
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (p) => x(SR.utc(p.date))).attr('cy', (p) => y(p.time_s))
      .attr('r', (p) => (p === best ? 4.5 : opts.line ? 2.6 : 3))
      .style('fill', dot).style('stroke', 'var(--color-panel)').attr('stroke-width', (p) => (p === best ? 2 : 1.5));
    // Zones de survol plus grandes que les points.
    const tip = SR.tip(host);
    const hits = svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (p) => x(SR.utc(p.date))).attr('cy', (p) => y(p.time_s)).attr('r', 9)
      .style('fill', 'transparent').style('cursor', 'default')
      .attr('aria-label', (p) => `${p.event}, ${SR.dlong(p.date)} : ${SR.dur(p.time_s)}`);
    SR.hover(hits, host, tip, (p) => ({
      head: SR.dlong(p.date), title: p.event,
      rows: [{ label: p === best ? 'Record' : 'Chrono', value: SR.dur(p.time_s) }],
    }));
  };

  // Le peloton en 100 points : chacun vaut 1 % des partants ; les miens sont en bleu, en tête.
  const pelotonChart = (topPct) => (svg, W, H) => {
    const cols = W >= 220 ? 25 : 20;
    const rows = 100 / cols;
    const cell = Math.min(W / cols, (H - 18) / rows);
    const k = Math.max(1, Math.ceil(topPct - 1e-9));
    const cells = d3.range(cols * rows);
    svg.append('g').selectAll('circle').data(cells).join('circle')
      .attr('cx', (i) => (i % cols) * cell + cell / 2).attr('cy', (i) => Math.floor(i / cols) * cell + cell / 2)
      .attr('r', (i) => (i < k ? cell * 0.46 : cell * 0.3))
      .style('fill', (i) => (i < k ? brand : muted));
    SR.cap(svg.append('text').attr('x', 0).attr('y', rows * cell + 14)).style('font-size', '11px').text(`1 point = 1${NB}% des coureurs`);
  };

  // Kilomètres par année depuis ma première compétition ; la meilleure en bleu, l’année en cours plus claire.
  const yearsChart = (years, best, current) => (svg, W, H, host) => {
    const base = H - 16;
    const x = d3.scaleBand(years.map((d) => d.year), [0, W]).padding(0.3);
    const y = d3.scaleLinear([0, d3.max(years, (d) => d.km) || 1], [base, 16]);
    svg.append('g').selectAll('path').data(years).join('path')
      .attr('d', (d) => SR.barPath(x(d.year), y(d.km), x.bandwidth(), base - y(d.km), 4))
      .style('fill', (d) => (d.year === best ? brand : muted)).attr('fill-opacity', (d) => (d.year === current && d.year !== best ? 0.55 : 1));
    svg.append('line').attr('x1', 0).attr('x2', W).attr('y1', base + 0.5).attr('y2', base + 0.5).style('stroke', 'var(--cds-chart-axis)');
    svg.append('g').selectAll('text').data(years).join('text')
      .attr('x', (d) => x(d.year) + x.bandwidth() / 2).attr('y', H - 2).attr('text-anchor', 'middle')
      .style('font-size', '11px').style('fill', (d) => (d.year === best ? 'var(--color-fg)' : 'var(--color-fg-muted)'))
      .style('font-weight', (d) => (d.year === best ? 700 : 400)).text((d) => d.year);
    const top = years.find((d) => d.year === best);
    if (top) {
      const label = `${SR.n0(top.km)}${NB}km`;
      const w = SR.textWidth(svg, label) * (11 / 12);
      const cx = Math.max(w / 2, Math.min(W - w / 2, x(top.year) + x.bandwidth() / 2));
      svg.append('text').attr('x', cx).attr('y', y(top.km) - 5).attr('text-anchor', 'middle')
        .style('font-size', '11px').style('font-weight', 700).style('fill', 'var(--color-fg)').text(label);
    }
    const tip = SR.tip(host);
    const hits = svg.append('g').selectAll('rect').data(years).join('rect')
      .attr('x', (d) => x(d.year) - (x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', 0).attr('height', base)
      .style('fill', 'transparent')
      .attr('aria-label', (d) => `${d.year} : ${SR.n0(d.km)} km${d.year === current ? ' (année en cours)' : ''}`);
    SR.hover(hits, host, tip, (d) => ({
      head: d.year === current ? `${d.year}, en cours` : String(d.year),
      rows: [{ label: 'Distance', value: `${SR.n0(d.km)} km` }, { label: 'Meilleure semaine', value: `${SR.n0(d.best_week_km)} km` }],
    }));
  };

  function drawForces() {
    const box = $('#athlete-forces');
    if (!box) return;
    const d = SR.ready(box, ['athlete', 'race_results', 'by_year']);
    if (!d || !d[0].length) return;
    const [[a], results, years] = d;
    const cards = [];
    const ofCat = (c) => results.filter((r) => r.category === c);

    const s = a.speed;
    if (s) {
      const pts = ofCat('10 km');
      cards.push(force('speed', 'Vitesse', `Sub-${s.sub_min}`, 'au 10 km',
        `${SR.dur(s.time_s)} ${au(s.event)} (${monthYear(s.date)}), soit ${SR.pace(s.pace_s)}/km.`,
        `Mes ${pts.length} chronos sur 10 km, du ${SR.dlong(pts[0].date)} au ${SR.dlong(pts[pts.length - 1].date)} ; record ${SR.dur(s.time_s)}.`,
        timeChart(pts, { ref: s.sub_min * 60, refLabel: `${s.sub_min}′` })));
    }
    const st = a.star;
    if (st) {
      cards.push(force('star', 'Grands rendez-vous', `Top ${topTxt(st.top_pct)}`, au(st.event),
        `${SR.n0(st.rank)}e sur ${SR.n0(st.field)} coureurs, en ${SR.dur(st.time_s)} (${monthYear(st.date)}).`,
        `Le peloton du ${st.event} en 100 points de 1 % : je finis dans le premier.`,
        pelotonChart(st.top_pct)));
    }
    const p = a.progress;
    if (p) {
      const pts = ofCat(p.category);
      const label = p.category === 'Semi' ? 'sur semi-marathon' : `sur ${p.category}`;
      cards.push(force('prog', 'Progression', `−${SR.dur(p.gain_s)}`, label,
        `De ${SR.dur(p.first_time_s)} en ${monthYear(p.first_date)} à ${SR.dur(p.best_time_s)} en ${monthYear(p.best_date)}.`,
        `Mes ${pts.length} chronos ${label}, de ${SR.dur(p.first_time_s)} à ${SR.dur(p.best_time_s)}.`,
        timeChart(pts, { line: true })));
    }
    const e = a.endurance;
    if (e && e.marathon_s) {
      const ys = years.filter((y) => y.year >= a.first_race_year);
      const current = years.length ? years[years.length - 1].year : null;
      const parts = [`${e.marathon_event} ${yearOf(e.marathon_date)}, à ${SR.pace(e.marathon_pace_s)}/km.`];
      if (e.best_year_km) parts.push(`Jusqu’à ${SR.n0(e.best_year_km)}${NB}km par an et ${SR.n0(e.best_week_km)}${NB}km par semaine.`);
      cards.push(force('endu', 'Endurance', SR.dur(e.marathon_s), 'au marathon', parts.join(' '),
        `Kilomètres courus par année depuis ${a.first_race_year} ; meilleure année ${e.best_year} avec ${SR.n0(e.best_year_km)} km.`,
        yearsChart(ys, e.best_year, current)));
    }
    box.replaceChildren(...cards);
    cards.forEach((c) => run(c.draw));
    enter(box);
  }

  /* ================= Meilleurs classements ================= */
  function drawPlacings() {
    const box = $('#athlete-placings');
    if (!box) return;
    const d = SR.ready(box, ['athlete']);
    if (!d || !d[0].length) return;
    const [[a]] = d;
    const list = a.placings.filter((p) => p.rank != null).slice(0, 6);
    box.replaceChildren(...list.map((p) => {
      const li = document.createElement('li');
      const rank = SR.el('span', 'sr-placing__rank');
      const b = SR.el('b', null, SR.n0(p.rank));
      b.append(SR.el('sup', null, p.rank === 1 ? 'er' : 'e'));
      rank.append(b);
      if (p.field) rank.append(SR.el('small', null, `sur ${SR.n0(p.field)}`));
      const name = SR.el('span', 'sr-placing__name', p.event);
      name.append(SR.el('span', 'sr-list__sub', `${SR.dmed(p.date)} · ${SR.dur(p.time_s)}`));
      const badge = p.podium ? SR.el('span', 'sr-placing__badge sr-placing__badge--podium', 'Podium')
        : p.top_pct != null ? SR.el('span', 'sr-placing__badge', `Top ${topTxt(p.top_pct)}`) : SR.el('span');
      li.append(rank, name, badge);
      return li;
    }));
    enter(box);
  }

  /* ================= Prochain objectif ================= */
  function drawNext() {
    const box = $('#athlete-next');
    if (!box) return;
    const d = SR.ready(box, ['athlete']);
    if (!d || !d[0].length) return;
    const [[a]] = d;
    const link = (page, label, cls) => {
      const el = SR.el('a', cls, label);
      el.href = `#${page}`;
      el.dataset.goto = page;
      return el;
    };
    const g = a.goal;
    if (!g) {
      box.replaceChildren(SR.el('p', 'sr-next__note', 'Mon prochain objectif s’affichera ici dès qu’il sera fixé.'),
        link('competitions', 'Toutes mes courses', 'sr-next__go'));
      enter(box);
      return;
    }
    const left = Math.round(dayOf(g.date) - today());
    const top = SR.el('div', 'sr-next__top');
    const id = SR.el('div');
    id.append(SR.el('p', 'sr-next__event', g.event), SR.el('p', 'sr-next__when', SR.dday(g.date)));
    top.append(id, SR.el('span', 'sr-next__count', left > 0 ? `J-${left}` : 'Jour J'));
    const tile = (label, value, sub, cls) => {
      const t = SR.el('div', `sr-next__tile${cls ? ` ${cls}` : ''}`);
      t.append(SR.el('span', null, label), SR.el('b', null, value), SR.el('small', null, sub));
      return t;
    };
    const rec = a.records.find((r) => r.category === g.category);
    const duo = SR.el('div', 'sr-next__duo');
    if (g.target_s) duo.append(tile('Objectif', SR.dur(g.target_s), `${SR.pace(g.target_pace_s)}/km`, 'sr-next__tile--goal'));
    if (rec) duo.append(tile('Mon record', SR.dur(rec.time_s), SR.dmed(rec.date)));
    const parts = [top];
    if (duo.children.length) parts.push(duo);
    if (rec && g.target_s) {
      const gap = rec.time_s - g.target_s;
      const note = SR.el('p', 'sr-next__note');
      note.append(gap > 0 ? txt(`Je vise ${gapTxt(gap)} de moins que mon record.`) : txt('Je vise mon record actuel, ou mieux.'));
      parts.push(note);
    }
    // Où j’en suis de mes 16 semaines de préparation.
    const SPAN = 16 * 7;
    if (left > 0 && left < SPAN) {
      const week = Math.min(16, Math.max(1, Math.ceil((SPAN - left) / 7)));
      const prep = SR.el('div', 'sr-next__prep');
      const head = SR.el('p', 'sr-next__prephead');
      head.append(SR.el('span', null, 'Préparation'), SR.el('b', null, `semaine ${week} sur 16`));
      const track = SR.el('div', 'sr-next__track');
      const fill = document.createElement('i');
      fill.style.width = `${Math.max(3, (1 - left / SPAN) * 100)}%`;
      track.append(fill);
      prep.append(head, track);
      parts.push(prep);
    }
    parts.push(link('objectif', 'Suivre ma préparation', 'sr-next__go'));
    box.replaceChildren(...parts);
    enter(box);
  }

  /* ================= Partager ================= */
  const share = $('#athlete-share');
  const hint = $('#athlete-share-hint');
  let hintTimer = null;
  const say = (msg) => {
    if (!hint) return;
    hint.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.textContent = '';
    }, 3500);
  };
  if (share) {
    share.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#fiche`;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Alexandre Barreau · Fiche athlète', text: shareText || 'Ma fiche de coureur', url });
        } catch (err) {
          /* partage annulé */
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        say('Lien copié : il ne reste qu’à le coller.');
      } catch (err) {
        say(`Lien de ma fiche : ${url}`);
      }
    });
  }

  SR.pages = SR.pages || {};
  const add = (page, fns) => {
    SR.pages[page] = (SR.pages[page] || []).concat(fns);
  };
  add('fiche', [drawHero, drawForces, drawPlacings, drawNext]);
})();
