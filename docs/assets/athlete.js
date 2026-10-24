/* Fiche athlète : ma carte de visite de coureur, en chiffres parlants pour tous (calcul « athlete »).
 * Rien n’y reprend l’accueil : pas de records bruts ni de totaux, mais ce qu’ils veulent dire (vitesse en km/h,
 * place dans le peloton, battements de cœur, semaines comptées en marathons). */
(() => {
  const SR = window.SR;
  const root = SR.root;
  const $ = (s) => root.querySelector(s);
  const NB = ' ';
  // La course où la photo a été prise : la légende reprend son chrono.
  const PHOTO = { date: '2026-10-11', category: '20 km' };
  const MARATHON_KM = 42.195;
  const brand = 'var(--sr-brand)';
  const muted = 'var(--cds-chart-muted)';
  const yearOf = (iso) => Number(String(iso).slice(0, 4));
  const monthYear = (iso) => SR.dmonth(iso).toLowerCase();
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // « au 10 km du 17e », « au Semi de Rome », mais « à Paris-Versailles ».
  const au = (ev) => (/^(\d|semi|marathon|trail|cross|relais)/i.test(ev) ? `au ${ev}` : `à ${ev}`);
  const CAT = { Semi: 'sur semi-marathon', Marathon: 'sur marathon', 'Paris-Versailles': 'à Paris-Versailles' };
  const onCat = (c) => CAT[c] || `sur ${c}`;
  // Part du peloton devant moi, arrondie au dixième supérieur : la fiche ne m’attribue jamais mieux que la réalité.
  const topTxt = (p) => `${SR.n1(Math.ceil(p * 10 - 1e-9) / 10)}${NB}%`;
  // « près de 3 » pour 2,98 : on arrondit sans jamais gonfler.
  const about = (x) => {
    const n = Math.round(x);
    return x < n - 0.005 ? `près de ${SR.n0(n)}` : SR.n0(n);
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

  /* ================= En-tête : trois chiffres que tout le monde comprend ================= */
  let shareText = '';
  function drawHero() {
    const box = $('#athlete-big');
    if (!box) return;
    const d = SR.ready(box, ['athlete', 'race_results']);
    if (!d || !d[0].length) return;
    const [[a], results] = d;
    const item = (value, unit, label, sub) => {
      const li = SR.el('li', 'sr-athlete__bigitem');
      const v = SR.el('span', 'sr-athlete__bigval', value);
      if (unit) v.append(SR.el('span', 'sr-unit', unit));
      li.append(v, SR.el('span', 'sr-athlete__biglabel', label), SR.el('span', 'sr-athlete__bigsub', sub));
      return li;
    };
    const items = [];
    const s = a.speed;
    if (s) {
      items.push(item(SR.n1(s.kmh), 'km/h', 'sur 10 km',
        `Record en ${SR.dur(s.time_s)} : le 100 m en ${SR.n1(s.per100_s)}${NB}s, cent fois de suite.`));
    }
    const m = a.semi;
    if (m) {
      items.push(item(SR.n1(m.kmh), 'km/h', 'sur semi-marathon',
        `Record en ${SR.dur(m.time_s)} : 21${NB}km d’affilée à ce rythme.`));
    }
    const st = a.star;
    if (st) {
      items.push(item(`Top ${topTxt(st.top_pct)}`, null, au(st.event),
        `${SR.n0(st.rank)}e sur ${SR.n0(st.field)} coureurs.`));
    }
    box.replaceChildren(...items);

    const cap = $('#athlete-caption');
    const shot = results.find((r) => r.date === PHOTO.date && r.category === PHOTO.category);
    if (cap && shot) {
      cap.replaceChildren(
        SR.el('b', null, `${shot.event} ${yearOf(shot.date)}`),
        SR.el('span', null, `${SR.dur(shot.time_s)}${shot.pr ? ' · record battu' : ''}`),
      );
    }
    const bits = [];
    if (s) bits.push(`10 km à ${SR.n1(s.kmh)} km/h`);
    if (m) bits.push(`semi à ${SR.n1(m.kmh)} km/h`);
    if (st) bits.push(`top ${topTxt(st.top_pct)} ${au(st.event)}`);
    shareText = `Alexandre Barreau, coureur sur route${bits.length ? ` : ${bits.join(', ')}` : ''}.`;
    enter(box);
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
    prog: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    record: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h2.5a1.5 1.5 0 0 1 1.5 1.5c0 2-1.6 3.5-3.6 3.5M7 5H4.5A1.5 1.5 0 0 0 3 6.5C3 8.5 4.6 10 6.6 10"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/>',
    volume: '<path d="M18.2 8.5c-1.9 0-3.3 1.4-6.2 3.5s-4.3 3.5-6.2 3.5a3.5 3.5 0 1 1 0-7c1.9 0 3.3 1.4 6.2 3.5s4.3 3.5 6.2 3.5a3.5 3.5 0 1 0 0-7z"/>',
  };
  const force = (icon, label, value, unit, qual, sub, aria, chart) => {
    const el = SR.el('article', 'sr-force');
    const ic = SR.el('span', 'sr-force__icon');
    ic.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
    const head = SR.el('div', 'sr-force__head');
    head.append(ic, SR.el('h3', 'sr-force__label', label));
    const v = SR.el('p', 'sr-force__value', value);
    if (unit) v.append(SR.el('span', 'sr-unit', unit));
    el.append(head, v, SR.el('p', 'sr-force__qual', qual), SR.el('p', 'sr-force__sub', sub));
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
  // Légende sous un mini-graphique : la version longue si elle tient dans la largeur, sinon la courte.
  const caption = (svg, y, texts, W) => {
    const t = SR.cap(svg.append('text').attr('x', 0).attr('y', y)).style('font-size', '11px');
    for (const s of texts) {
      t.text(s);
      if (t.node().getComputedTextLength() <= W) break;
    }
    return t;
  };

  // Chronos d’une distance au fil du temps : le plus rapide en haut, le meilleur mis en avant.
  const timeChart = (pts) => (svg, W, H, host) => {
    const best = pts.reduce((m, p) => (p.time_s < m.time_s ? p : m));
    const ext = d3.extent(pts, (p) => p.time_s);
    const span = Math.max(1, ext[1] - ext[0]);
    const x = d3.scaleUtc(d3.extent(pts, (p) => SR.utc(p.date)), [6, W - 6]);
    const y = d3.scaleLinear([ext[1] + span * 0.06, ext[0] - span * 0.06], [H - 6, 6]);
    svg.append('path').datum(pts).attr('d', d3.line().x((p) => x(SR.utc(p.date))).y((p) => y(p.time_s)).curve(d3.curveMonotoneX))
      .style('fill', 'none').style('stroke', brand).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('opacity', 0.9);
    svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (p) => x(SR.utc(p.date))).attr('cy', (p) => y(p.time_s)).attr('r', (p) => (p === best ? 4.5 : 2.6))
      .style('fill', brand).style('stroke', 'var(--color-panel)').attr('stroke-width', (p) => (p === best ? 2 : 1.5));
    const tip = SR.tip(host);
    const hits = svg.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (p) => x(SR.utc(p.date))).attr('cy', (p) => y(p.time_s)).attr('r', 9).style('fill', 'transparent')
      .attr('aria-label', (p) => `${p.event}, ${SR.dlong(p.date)} : ${SR.dur(p.time_s)}`);
    SR.hover(hits, host, tip, (p) => ({
      head: SR.dlong(p.date), title: p.event, rows: [{ label: p === best ? 'Record' : 'Chrono', value: SR.dur(p.time_s) }],
    }));
  };

  // Toutes mes compétitions, une pastille chacune dans l’ordre, en bleu quand j’y ai battu un record.
  const racesChart = (races) => (svg, W, H, host) => {
    const n = races.length;
    const avail = H - 18;
    let best = { cell: 0, cols: n, rows: 1 };
    for (let rows = 1; rows <= 6; rows++) {
      const cols = Math.ceil(n / rows);
      const cell = Math.min(W / cols, avail / rows);
      if (cell > best.cell) best = { cell, cols, rows };
    }
    const { cell, cols, rows } = best;
    const cx = (i) => (i % cols) * cell + cell / 2;
    const cy = (i) => Math.floor(i / cols) * cell + cell / 2;
    svg.append('g').selectAll('circle').data(races).join('circle')
      .attr('cx', (r, i) => cx(i)).attr('cy', (r, i) => cy(i)).attr('r', (r) => cell * (r.pr ? 0.4 : 0.3))
      .style('fill', (r) => (r.pr ? brand : muted));
    caption(svg, rows * cell + 14, ['1 point = 1 course · en bleu : record', 'En bleu : mes records'], W);
    const tip = SR.tip(host);
    const hits = svg.append('g').selectAll('rect').data(races).join('rect')
      .attr('x', (r, i) => cx(i) - cell / 2).attr('y', (r, i) => cy(i) - cell / 2).attr('width', cell).attr('height', cell)
      .style('fill', 'transparent')
      .attr('aria-label', (r) => `${r.event}, ${SR.dlong(r.date)} : ${SR.dur(r.time_s)}${r.pr ? ', record' : ''}`);
    SR.hover(hits, host, tip, (r) => ({
      head: SR.dlong(r.date), title: r.event, rows: [{ label: r.pr ? 'Record battu' : 'Chrono', value: SR.dur(r.time_s) }],
    }));
  };

  // FC moyenne à la même allure, année après année : la courbe qui descend, c’est le cœur qui travaille moins.
  const heartChart = (years) => (svg, W, H, host) => {
    const ext = d3.extent(years, (p) => p.hr);
    const pad = Math.max(1.5, (ext[1] - ext[0]) * 0.25);
    const x = d3.scalePoint(years.map((p) => p.year), [22, W - 22]);
    const y = d3.scaleLinear([ext[0] - pad, ext[1] + pad], [H - 18, 14]);
    const last = years[years.length - 1];
    svg.append('path').datum(years).attr('d', d3.line().x((p) => x(p.year)).y((p) => y(p.hr)))
      .style('fill', 'none').style('stroke', brand).attr('stroke-width', 2).attr('stroke-linejoin', 'round');
    svg.append('g').selectAll('circle').data(years).join('circle')
      .attr('cx', (p) => x(p.year)).attr('cy', (p) => y(p.hr)).attr('r', (p) => (p === last ? 4.5 : 3))
      .style('fill', brand).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
    svg.append('g').selectAll('text').data(years).join('text')
      .attr('x', (p) => x(p.year)).attr('y', (p) => y(p.hr) - 8).attr('text-anchor', 'middle')
      .style('font-size', '11px').style('font-weight', (p) => (p === last ? 700 : 400))
      .style('fill', (p) => (p === last ? 'var(--color-fg)' : 'var(--color-fg-muted)')).text((p) => SR.n0(p.hr));
    svg.append('g').selectAll('text.yr').data(years).join('text').attr('class', 'yr')
      .attr('x', (p) => x(p.year)).attr('y', H - 2).attr('text-anchor', 'middle')
      .style('font-size', '11px').style('fill', 'var(--color-fg-muted)').text((p) => p.year);
    const tip = SR.tip(host);
    const hits = svg.append('g').selectAll('rect').data(years).join('rect')
      .attr('x', (p) => x(p.year) - 18).attr('y', 0).attr('width', 36).attr('height', H).style('fill', 'transparent')
      .attr('aria-label', (p) => `${p.year} : ${SR.n0(p.hr)} battements par minute`);
    SR.hover(hits, host, tip, (p) => ({ head: String(p.year), rows: [{ label: 'Cœur', value: `${SR.n0(p.hr)} bpm` }] }));
  };

  // Ma plus grosse semaine, découpée en marathons de 42,195 km.
  const marathonsChart = (km) => (svg, W) => {
    const n = Math.max(1, Math.ceil(km / MARATHON_KM - 1e-9));
    const bh = 9;
    const gap = Math.min(7, (46 - n * bh) / Math.max(1, n - 1));
    d3.range(n).forEach((i) => {
      const y = i * (bh + gap);
      const k = Math.max(0, Math.min(1, km / MARATHON_KM - i));
      svg.append('rect').attr('x', 0).attr('y', y).attr('width', W).attr('height', bh).attr('rx', bh / 2).style('fill', 'var(--sr-fill)');
      if (k > 0) svg.append('rect').attr('x', 0).attr('y', y).attr('width', Math.max(bh, W * k)).attr('height', bh).attr('rx', bh / 2).style('fill', brand);
    });
    caption(svg, n * (bh + gap) - gap + 15, [`1 barre = 1 marathon (42,2${NB}km)`, '1 barre = 1 marathon'], W);
  };

  function drawForces() {
    const box = $('#athlete-forces');
    if (!box) return;
    const d = SR.ready(box, ['athlete', 'race_results']);
    if (!d || !d[0].length) return;
    const [[a], results] = d;
    const cards = [];

    const p = a.progress;
    if (p) {
      const pts = results.filter((r) => r.category === p.category);
      const mins = Math.floor(p.gain_s / 60);
      cards.push(force('prog', 'Progression', `−${mins}`, 'min', onCat(p.category),
        `De ${SR.dur(p.first_time_s)} en ${monthYear(p.first_date)} à ${SR.dur(p.best_time_s)} en ${monthYear(p.best_date)}.`,
        `Mes ${pts.length} chronos ${onCat(p.category)}, de ${SR.dur(p.first_time_s)} à ${SR.dur(p.best_time_s)}.`,
        timeChart(pts)));
    }
    if (a.prs && a.races) {
      const r = a.prs / a.races;
      const share = r >= 0.5 ? 'Plus d’une course sur deux' : r >= 0.4 ? 'Presque une course sur deux'
        : r >= 0.3 ? 'Près d’une course sur trois' : `${SR.pct(r)} de mes courses`;
      cards.push(force('record', 'Records', SR.n0(a.prs), null, `battus en ${SR.n0(a.races)} courses`,
        `${share} se termine sur un record personnel, du 10${NB}km au marathon.`,
        `Mes ${a.races} compétitions dans l’ordre, dont ${a.prs} records personnels.`,
        racesChart(results)));
    }
    const h = a.heart;
    if (h && h.delta_bpm <= -2 && h.years.length >= 2) {
      cards.push(force('heart', 'Cœur', `−${SR.n0(-h.delta_bpm)}`, 'bpm', 'à la même vitesse',
        `Vers ${SR.n0(h.kmh_lo)}${NB}km/h, mon cœur bat ${SR.n0(h.to_hr)} fois par minute, contre ${SR.n0(h.from_hr)} en ${h.from_year}.`,
        `Battements par minute vers ${SR.n0(h.kmh_lo)} km/h : ${h.years.map((y) => `${SR.n0(y.hr)} en ${y.year}`).join(', ')}.`,
        heartChart(h.years)));
    }
    const v = a.volume;
    if (v) {
      cards.push(force('volume', 'Volume', SR.n0(v.best_week_km), 'km', 'en une semaine',
        `${cap1(about(v.marathons))} marathons en 7 jours (${monthYear(v.best_week)}). Sur l’année ${v.best_year} : ${about(v.per_day_km)}${NB}km par jour.`,
        `Ma plus grosse semaine, ${SR.n0(v.best_week_km)} km, comptée en marathons.`,
        marathonsChart(v.best_week_km)));
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
    // Seulement les classements qui comptent : podiums, top 1 % quand l’effectif est connu, top 10 sinon.
    const list = a.placings.filter((p) => p.podium || (p.top_pct != null ? p.top_pct <= 1 : p.rank != null && p.rank <= 10)).slice(0, 6);
    box.replaceChildren(...list.map((p) => {
      const li = SR.el('li', `sr-placing${p.podium ? ' is-podium' : ''}`);
      const top = SR.el('div', 'sr-placing__top');
      const rank = SR.el('span', 'sr-placing__rank', SR.n0(p.rank));
      rank.append(SR.el('sup', null, p.rank === 1 ? 'er' : 'e'));
      const badge = p.podium ? SR.el('span', 'sr-placing__badge sr-placing__badge--podium', 'Podium')
        : p.top_pct != null ? SR.el('span', 'sr-placing__badge', `Top ${topTxt(p.top_pct)}`) : null;
      top.append(rank);
      if (badge) top.append(badge);
      li.append(top);
      // Ce que j’ai noté en plus de la place (« 3e, premier podium » → « Premier podium »).
      const extra = String(p.place).replace(/^\s*\d[\d\s\u00a0\u202f]*e\b\s*(\/\s*\d[\d\s\u00a0\u202f]*)?[,;·\s-]*/, '').trim();
      if (p.field) li.append(SR.el('span', 'sr-placing__field', `sur ${SR.n0(p.field)} coureurs`));
      else if (extra) li.append(SR.el('span', 'sr-placing__field', cap1(extra)));
      li.append(SR.el('span', 'sr-placing__event', p.event), SR.el('span', 'sr-placing__meta', `${SR.dmed(p.date)} · ${SR.dur(p.time_s)}`));
      return li;
    }));
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
  add('fiche', [drawHero, fitPhoto, drawForces, drawPlacings]);
})();
