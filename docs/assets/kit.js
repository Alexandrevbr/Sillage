/* Outils partagés : formats, couleurs, infobulles, états. */
(() => {
  const SR = (window.SR = window.SR || {});
  const root = document.getElementById('sr');
  SR.root = root;

  /* ---------- Formats (français) ---------- */
  const nf = (o) => new Intl.NumberFormat('fr-FR', o);
  const F0 = nf({ maximumFractionDigits: 0 });
  const F1 = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const FP = nf({ style: 'percent', maximumFractionDigits: 0 });
  const FS = nf({ style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const F2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FS0 = nf({ maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const FP1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const FS1 = nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const ok = (v) => v != null && Number.isFinite(Number(v));
  SR.n0 = (v) => (ok(v) ? F0.format(Number(v)) : '—');
  SR.n1 = (v) => (ok(v) ? F1.format(Number(v)) : '—');
  SR.n2 = (v) => (ok(v) ? F2.format(Number(v)) : '—');
  SR.sn0 = (v) => (ok(v) ? FS0.format(Number(v)) : '—');
  SR.pct = (v) => (ok(v) ? FP.format(Number(v)) : '—');
  SR.pct1 = (v) => (ok(v) ? FP1.format(Number(v)) : '—');
  SR.spct = (v) => (ok(v) ? FS.format(Number(v)) : '—');
  SR.spct1 = (v) => (ok(v) ? FS1.format(Number(v)) : '—');
  const two = (n) => String(n).padStart(2, '0');
  SR.dur = (s) => {
    if (!ok(s)) return '—';
    const t = Math.round(Math.abs(Number(s)));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const x = t % 60;
    return h ? `${h}h${two(m)}′${two(x)}″` : `${m}′${two(x)}″`;
  };
  SR.pace = (s) => {
    if (!ok(s)) return '—';
    const t = Math.round(Number(s));
    return `${Math.floor(t / 60)}′${two(t % 60)}″`;
  };
  SR.gain = (s) => (ok(s) ? (Number(s) > 0 ? `−${SR.dur(s)}` : '—') : '—');
  SR.hm = (s) => {
    if (!ok(s)) return '—';
    const t = Math.round(Number(s) / 60);
    return t >= 60 ? `${Math.floor(t / 60)}h${two(t % 60)}` : `${t} min`;
  };
  SR.utc = (iso) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  };
  const df = (o) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o });
  const D = {
    long: df({ day: 'numeric', month: 'long', year: 'numeric' }),
    med: df({ day: 'numeric', month: 'short', year: 'numeric' }),
    short: df({ day: 'numeric', month: 'short' }),
    day: df({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    month: df({ month: 'long', year: 'numeric' }),
    mon: df({ month: 'short' }),
    monyear: df({ month: 'short', year: 'numeric' }),
  };
  // « 1er octobre », comme on l’écrit en français (Intl donne « 1 octobre »).
  const first = (s) => s.replace(/(^|\s)1(?=\s)/, '$11er');
  SR.dlong = (iso) => first(D.long.format(SR.utc(iso)));
  SR.dmed = (iso) => first(D.med.format(SR.utc(iso)));
  SR.dshort = (iso) => first(D.short.format(SR.utc(iso)));
  SR.dday = (iso) => {
    const s = first(D.day.format(SR.utc(iso)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  SR.dmonth = (iso) => {
    const s = D.month.format(SR.utc(String(iso).length === 7 ? `${iso}-01` : iso));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  SR.mon = (date) => D.mon.format(date);
  SR.monyear = (date) => D.monyear.format(date);
  SR.fmt = {
    n0: SR.n0, n1: SR.n1, n2: SR.n2, sn0: SR.sn0, pct: SR.pct, pct1: SR.pct1, spct: SR.spct, spct1: SR.spct1,
    dur: SR.dur, pace: SR.pace, gain: SR.gain,
    dlong: SR.dlong, dmed: SR.dmed, dshort: SR.dshort, month: SR.dmonth,
    text: (v) => (v == null || v === '' ? '—' : String(v)),
  };

  /* ---------- Couleurs (jetons du thème) ---------- */
  SR.col = {
    blue: dash.colors[0],
    orange: dash.colors[1],
    aqua: dash.colors[2],
    muted: 'var(--cds-chart-muted)',
    grid: 'var(--cds-chart-grid)',
    axis: 'var(--cds-chart-axis)',
    ref: 'var(--cds-chart-reference)',
    fg: 'var(--color-fg)',
    fgMuted: 'var(--color-fg-muted)',
    panel: 'var(--color-panel)',
  };
  root.style.setProperty('--sr-accent', SR.col.orange);
  root.style.setProperty('--sr-blue', SR.col.blue);
  root.style.setProperty('--sr-aqua', SR.col.aqua);

  // Couleur d’une année : l’année en cours en orange, les deux précédentes en bleu et vert, le reste en gris.
  SR.yearColor = (year, cur) => {
    if (year === cur) return SR.col.orange;
    if (year === cur - 1) return SR.col.blue;
    if (year === cur - 2) return SR.col.aqua;
    return SR.col.muted;
  };
  SR.yearRank = (year, cur) => (year === cur ? 3 : year === cur - 1 ? 2 : year === cur - 2 ? 1 : 0);

  // Lit la couleur calculée d’un jeton, en rgb() utilisable par d3.
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  SR.rgb = (css, fallback = 'rgb(128, 128, 128)') => {
    const probe = document.createElement('i');
    probe.style.color = css;
    probe.style.display = 'none';
    root.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    if (!cx) return c || fallback;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? fallback : `rgb(${r}, ${g}, ${b})`;
  };
  // Rampe séquentielle bleue validée (clair → foncé en thème clair, et l’inverse en thème sombre).
  SR.ramp = (n) => {
    const surface = SR.rgb(SR.col.panel, 'rgb(252, 252, 251)');
    const blue = SR.rgb(SR.col.blue, 'rgb(42, 120, 214)');
    const fg = SR.rgb(SR.col.fg, 'rgb(20, 20, 19)');
    const start = d3.interpolateRgb(surface, blue)(0.55);
    const end = d3.interpolateRgb(blue, fg)(0.62);
    const pw = d3.piecewise(d3.interpolateRgb, [start, blue, end]);
    return d3.range(n).map((i) => pw(n === 1 ? 0.5 : i / (n - 1)));
  };
  const lum = (rgb) => {
    const c = d3.rgb(rgb);
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  // Couleur de texte lisible sur un fond donné (jeton de texte, jamais une couleur de série).
  SR.inkOn = (bg) => {
    const fg = SR.rgb(SR.col.fg, 'rgb(20, 20, 19)');
    const panel = SR.rgb(SR.col.panel, 'rgb(252, 252, 251)');
    const contrast = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    return contrast(bg, fg) >= contrast(bg, panel) ? 'var(--color-fg)' : 'var(--color-panel)';
  };

  /* ---------- Structure des graphiques ---------- */
  SR.svg = (box, w, h, extra = '') => {
    const svg = d3.select(box).append('svg')
      .attr('width', '100%')
      .attr('viewBox', `0 0 ${w} ${h}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .style('height', 'auto')
      .style('display', 'block');
    if (extra) svg.attr('class', extra);
    return svg;
  };
  SR.width = (box, min = 280) => Math.max(min, Math.floor(box.clientWidth || box.getBoundingClientRect().width || min));
  // Mesure la largeur d’un texte dans un svg donné.
  SR.textWidth = (svg, str, cls = 'sr-t-cap') => {
    const t = svg.append('text').attr('class', cls).style('font-size', 'var(--cds-font-size-caption)').text(str);
    const w = t.node().getComputedTextLength();
    t.remove();
    return w;
  };
  SR.cap = (sel) => sel.style('font-size', 'var(--cds-font-size-caption)').style('fill', 'var(--color-fg-muted)');
  // Barre aux coins supérieurs arrondis, posée sur la ligne de base.
  SR.barPath = (x, y, w, h, r = 4) => {
    if (h <= 0 || w <= 0) return '';
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
  };
  // Barre horizontale aux coins droits arrondis, posée sur la gauche.
  SR.hbarPath = (x, y, w, h, r = 4) => {
    if (h <= 0 || w <= 0) return '';
    const rr = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
  };
  SR.gridY = (svg, y, x0, x1, ticks, fmt, opts = {}) => {
    const g = svg.append('g').attr('class', 'sr-grid-y');
    ticks.forEach((t) => {
      g.append('line').attr('x1', x0).attr('x2', x1).attr('y1', y(t)).attr('y2', y(t))
        .style('stroke', t === 0 && !opts.noBase ? SR.col.axis : SR.col.grid).attr('stroke-width', 1)
        .attr('shape-rendering', 'crispEdges');
      if (fmt) {
        SR.cap(g.append('text').attr('x', opts.right ? x1 : x0 - 8).attr('y', y(t)).attr('dy', '0.32em')
          .attr('text-anchor', opts.right ? 'start' : 'end')).text(fmt(t));
      }
    });
    return g;
  };
  // Garde des étiquettes à distance (positions triées ; écart minimal en px).
  SR.spread = (items, key, minGap, lo, hi) => {
    const s = [...items].sort((a, b) => a[key] - b[key]);
    for (let i = 1; i < s.length; i++) if (s[i][key] - s[i - 1][key] < minGap) s[i][key] = s[i - 1][key] + minGap;
    if (s.length && s[s.length - 1][key] > hi) {
      s[s.length - 1][key] = hi;
      for (let i = s.length - 2; i >= 0; i--) if (s[i + 1][key] - s[i][key] < minGap) s[i][key] = s[i + 1][key] - minGap;
    }
    if (s.length && s[0][key] < lo) s[0][key] = lo;
    return s;
  };

  /* ---------- Infobulle ---------- */
  SR.tip = (host) => {
    const el = document.createElement('div');
    el.className = 'sr-tip';
    el.setAttribute('aria-hidden', 'true');
    host.appendChild(el);
    return {
      show(x, y, build) {
        el.replaceChildren();
        build(el);
        el.classList.add('is-on');
        const hw = host.clientWidth;
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        let left = x + 14;
        if (left + tw > hw - 4) left = x - tw - 14;
        left = Math.max(4, Math.min(left, Math.max(4, hw - tw - 4)));
        let top = y - th - 12;
        if (top < 4) top = y + 16;
        el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      },
      hide() {
        el.classList.remove('is-on');
      },
    };
  };
  // Contenu : un titre, une ligne secondaire, puis des lignes « libellé · valeur ».
  SR.tipBody = (el, { head, title, rows = [] }) => {
    if (head) el.append(Object.assign(document.createElement('div'), { className: 'sr-tip__head', textContent: head }));
    if (title) el.append(Object.assign(document.createElement('div'), { className: 'sr-tip__title', textContent: title }));
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'sr-tip__row';
      if (r.color) {
        const sw = document.createElement('i');
        sw.className = `sr-sw${r.line ? ' sr-sw--line' : ''}`;
        sw.style.background = r.color;
        row.append(sw);
      }
      row.append(Object.assign(document.createElement('span'), { textContent: r.label }));
      row.append(Object.assign(document.createElement('b'), { textContent: r.value }));
      el.append(row);
    });
  };
  // Relie survol, toucher et clavier d’un élément à l’infobulle.
  SR.hover = (sel, host, tip, content, onEnter, onLeave) => {
    sel
      .attr('tabindex', 0)
      .on('pointerenter pointermove', (event, d) => {
        const [x, y] = d3.pointer(event, host);
        tip.show(x, y, (el) => SR.tipBody(el, content(d)));
        if (onEnter) onEnter(event, d);
      })
      .on('pointerleave', (event, d) => {
        tip.hide();
        if (onLeave) onLeave(event, d);
      })
      .on('focus', (event, d) => {
        const hb = host.getBoundingClientRect();
        const b = event.currentTarget.getBoundingClientRect();
        tip.show(b.left - hb.left + b.width / 2, b.top - hb.top, (el) => SR.tipBody(el, content(d)));
        if (onEnter) onEnter(event, d);
      })
      .on('blur', (event, d) => {
        tip.hide();
        if (onLeave) onLeave(event, d);
      });
  };

  /* ---------- États et marques ---------- */
  const BAD = ['error'];
  // Données prêtes pour une boîte : sinon squelette (chargement) ou ligne d’échec.
  SR.ready = (box, ids) => {
    const res = ids.map((id) => dash.data(id));
    if (res.some((r) => BAD.includes(r.status))) {
      box.classList.remove('dash-skeleton');
      const line = document.createElement('div');
      line.className = 'sr-failed';
      line.textContent = 'Failed to load';
      box.replaceChildren(line);
      return null;
    }
    if (res.some((r) => r.status !== 'ok')) {
      if (!box.dataset.drawn) {
        box.classList.add('dash-skeleton');
        box.replaceChildren();
      }
      return null;
    }
    box.classList.remove('dash-skeleton');
    box.dataset.drawn = '1';
    return res.map((r) => (Array.isArray(r.data) ? r.data : []));
  };
  const parseWhere = (w) => String(w).split('&').map((p) => p.split('=').map((s) => decodeURIComponent(s)));
  // Remplit chaque valeur marquée data-fmt depuis sa source.
  SR.fillMarks = (scope = root) => {
    scope.querySelectorAll('[data-source][data-field][data-fmt]').forEach((el) => {
      if (el.dataset.counting) return; // décompte en cours (chiffres clés de l’accueil)
      const res = dash.data(el.dataset.source);
      if (res.status !== 'ok' || !Array.isArray(res.data)) {
        if (!el.dataset.filled) {
          el.textContent = '—';
          el.classList.toggle('dash-skeleton', res.status === 'loading');
        }
        return;
      }
      let row = null;
      if (el.dataset.row != null) row = res.data[Number(el.dataset.row)];
      else if (el.dataset.where) {
        const conds = parseWhere(el.dataset.where);
        row = res.data.find((r) => conds.every(([k, v]) => String(r[k]) === v));
      }
      const fmt = SR.fmt[el.dataset.fmt] || SR.fmt.text;
      el.classList.remove('dash-skeleton');
      el.dataset.filled = '1';
      el.textContent = row ? fmt(row[el.dataset.field]) : '—';
    });
  };
  // Encode seulement &, = et % dans une valeur de data-where.
  SR.enc = (v) => String(v).replace(/%/g, '%25').replace(/&/g, '%26').replace(/=/g, '%3D');
  SR.mark = (el, source, field, where) => {
    el.dataset.source = source;
    el.dataset.field = field;
    if (where) el.dataset.where = where;
    return el;
  };
  SR.el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
})();
