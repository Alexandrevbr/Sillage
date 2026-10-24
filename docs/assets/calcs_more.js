/* Calculs : gestion de course, plan d’allure, charge et reprise, boucles et segments, récap partageable.
 * Chaque formule est une fonction pure de ses sources. */

dash.calc('race_pacing', {
  title: 'Gestion de course',
  description: 'Pour chaque compétition où la montre a fait des tours automatiques au kilomètre : temps de chaque km (tour GPS, recalé sur le chrono officiel), allure de la première et de la deuxième moitié (temps au milieu de la distance GPS), écart entre les deux, km le plus rapide et le plus lent, régularité (écart-type des km complets) et FC de chaque km (les tours où la FC est anormalement basse, quand le capteur se cale, sont écartés).',
  inputs: ['race_results', 'laps'],
  fn: (race_results, laps) => {
    const by = new Map();
    laps.forEach((l) => {
      if (!by.has(l.id)) by.set(l.id, []);
      by.get(l.id).push(l);
    });
    const median = (a) => {
      const s = a.filter((x) => x != null).sort((x, y) => x - y);
      if (!s.length) return null;
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    return race_results.map((r) => {
      const L = (by.get(r.id) || []).slice().sort((a, b) => a.i - b.i).filter((l) => l.d > 0 && l.et > 0);
      const full = L.slice(0, -1);
      const auto = L.length >= 4 && full.filter((l) => Math.abs(l.d - 1000) <= 30).length >= 0.8 * full.length;
      const base = {
        id: r.id, date: r.date, year: r.year, day: r.day, event: r.event, category: r.category, km: r.km,
        time_s: r.time_s, pace_s: r.pace_s, pr: r.pr, place: r.place, laps_known: L.length > 0,
      };
      if (!auto) return { ...base, splits: null, source: L.length === 1 ? 'un seul tour' : L.length ? 'tours manuels' : null };
      const gps = L.reduce((s, l) => s + l.d, 0);
      const k = r.time_s / L.reduce((s, l) => s + l.et, 0);
      const hrMed = median(L.map((l) => (l.hr > 0 ? l.hr : null)));
      let cum = 0;
      const splits = L.map((l, i) => {
        const t = l.et * k;
        cum += t;
        return {
          k: i + 1, d: l.d, t, pace: t / (l.d / 1000), cum, part: l.d < 900,
          hr: l.hr > 0 && hrMed && l.hr >= 0.85 * hrMed ? l.hr : null, el: l.el, g: l.g,
        };
      });
      const half = gps / 2;
      let dd = 0;
      let tt = 0;
      let t1 = null;
      for (const s of splits) {
        if (dd + s.d >= half) {
          t1 = tt + ((half - dd) / s.d) * s.t;
          break;
        }
        dd += s.d;
        tt += s.t;
      }
      const kms = splits.filter((s) => !s.part);
      const mean = kms.reduce((s, x) => s + x.pace, 0) / kms.length;
      const sd = Math.sqrt(kms.reduce((s, x) => s + (x.pace - mean) ** 2, 0) / kms.length);
      const fast = kms.reduce((a, s) => (!a || s.pace < a.pace ? s : a), null);
      const slow = kms.reduce((a, s) => (!a || s.pace > a.pace ? s : a), null);
      const hrOf = (a) => {
        const v = a.filter((s) => s.hr);
        const w = v.reduce((s, x) => s + x.t, 0);
        return w ? v.reduce((s, x) => s + x.hr * x.t, 0) / w : null;
      };
      const mid = Math.ceil(splits.length / 2);
      const h1 = t1 / (r.km / 2);
      const h2 = (r.time_s - t1) / (r.km / 2);
      return {
        ...base, source: 'tours au km', splits, gps_km: gps / 1000, mean_lap_pace: mean, sd,
        half1_pace: h1, half2_pace: h2, split_pct: h2 / h1 - 1,
        fast_k: fast.k, fast_pace: fast.pace, slow_k: slow.k, slow_pace: slow.pace,
        hr1: hrOf(splits.slice(0, mid)), hr2: hrOf(splits.slice(mid)),
      };
    });
  },
});

dash.calc('goal_plan', {
  title: 'Plan d’allure de la course objectif',
  description: 'Temps visé réparti sur chaque km de la dernière édition (tours automatiques de la montre) selon la pente moyenne du km : +3 % de temps par % de montée, −1,8 % par % de descente, puis recalé pour tomber pile sur l’objectif. À côté, les passages réels de la dernière édition et l’écart cumulé. Sans édition précédente avec des tours au km, l’allure est régulière.',
  inputs: ['goal_info', 'race_pacing'],
  fn: (goal_info, race_pacing) => {
    if (!goal_info.length || !goal_info[0].target_s) return [];
    const g = goal_info[0];
    const prev = race_pacing.filter((r) => r.event === g.event && r.date < g.date && r.splits)
      .reduce((a, r) => (!a || r.date > a.date ? r : a), null);
    if (!prev) {
      const n = Math.ceil(g.km);
      let cum = 0;
      return Array.from({ length: n }, (_, i) => {
        const d = Math.min(1000, g.km * 1000 - i * 1000);
        const t = g.target_s * (d / (g.km * 1000));
        cum += t;
        return { k: i + 1, d, part: d < 900, g: null, plan_t: t, plan_pace: t / (d / 1000), plan_cum: cum, prev_t: null, prev_cum: null, gap: null, prev_year: null, prev_time_s: null, watch_pace: g.target_pace_s, gps_km: g.km };
      });
    }
    const L = prev.splits;
    const gps = L.reduce((s, l) => s + l.d, 0);
    const w = L.map((l) => (l.d / 1000) * (1 + (l.g > 0 ? 0.03 : 0.018) * Math.max(-4, Math.min(4, l.g || 0))));
    const W = w.reduce((s, x) => s + x, 0);
    let cp = 0;
    return L.map((l, i) => {
      const t = (g.target_s * w[i]) / W;
      cp += t;
      return {
        k: l.k, d: l.d, part: l.part, g: l.g, el: l.el, plan_t: t, plan_pace: t / (l.d / 1000), plan_cum: cp,
        prev_t: l.t, prev_pace: l.pace, prev_cum: l.cum, gap: l.cum - cp, prev_hr: l.hr,
        prev_year: prev.year, prev_time_s: prev.time_s, prev_id: prev.id, watch_pace: g.target_s / (gps / 1000), gps_km: gps / 1000,
      };
    });
  },
});

dash.calc('ramp_weeks', {
  title: 'Hausse du volume semaine par semaine',
  description: 'Pour chacune des 52 dernières semaines (lundi → dimanche) : km de la semaine comparés à la moyenne des 4 semaines précédentes. Repère : au-delà de +30 % d’une semaine sur l’autre, le risque de blessure augmente nettement.',
  inputs: ['by_week'],
  fn: (by_week) => by_week.map((w, i) => {
    const prev = by_week.slice(Math.max(0, i - 4), i);
    const p4 = prev.length === 4 ? prev.reduce((s, x) => s + x.km, 0) / 4 : null;
    return { week: w.week, km: w.km, runs: w.runs, prev4: p4, ramp: p4 != null && p4 >= 10 ? w.km / p4 - 1 : null };
  }).slice(-52),
});

dash.calc('acwr', {
  title: 'Charge aiguë et chronique',
  description: 'Chaque jour des 6 derniers mois : charge des 7 derniers jours (somme des efforts relatifs, tous sports) divisée par la charge hebdomadaire moyenne des 28 derniers jours. Entre 0,8 et 1,3 : progression maîtrisée ; au-delà de 1,5 : hausse brutale.',
  inputs: ['load', 'race_results'],
  fn: (load, race_results) => {
    const races = new Map(race_results.map((r) => [r.date, r.event]));
    const v = load.map((l) => l.load || 0);
    const out = [];
    let a = 0;
    let c = 0;
    v.forEach((x, i) => {
      a += x - (i >= 7 ? v[i - 7] : 0);
      c += x - (i >= 28 ? v[i - 28] : 0);
      if (i >= 27) out.push({ date: load[i].date, acute: a, chronic: c / 4, ratio: c > 0 ? a / (c / 4) : null, race: races.get(load[i].date) || null });
    });
    return out.slice(-183);
  },
});

dash.calc('reprises', {
  title: 'Coupures et reprises',
  description: 'Les baisses de volume depuis 2023 : au moins 2 semaines d’affilée sous la moitié de la moyenne des 8 semaines d’avant (si elle dépassait 20 km). Pour chacune : volume d’avant, volume pendant la baisse, puis la reprise semaine par semaine (km et hausse par rapport aux 4 semaines précédentes) jusqu’au retour à 85 % du volume d’avant.',
  inputs: ['by_week'],
  fn: (by_week) => {
    const W = by_week.filter((w) => w.week >= '2022-11-01');
    const out = [];
    const avg = (a) => a.reduce((s, x) => s + x.km, 0) / a.length;
    let i = 8;
    while (i < W.length - 1) {
      const base = avg(W.slice(i - 8, i));
      if (!(base >= 20 && W[i].km < 0.5 * base && W[i + 1].km < 0.5 * base)) {
        i++;
        continue;
      }
      let j = i;
      while (j < W.length && W[j].km < 0.5 * base) j++;
      const low = W.slice(i, j);
      let k = j;
      while (k < W.length && W[k].km < 0.85 * base) k++;
      const back = k < W.length ? k : null;
      const rec = W.slice(j, Math.min(W.length, (back == null ? W.length : back + 1), j + 12)).map((w, n) => {
        const idx = j + n;
        const p4 = idx >= 4 ? avg(W.slice(idx - 4, idx)) : null;
        return { week: w.week, km: w.km, ramp: p4 >= 10 ? w.km / p4 - 1 : null };
      });
      out.push({
        start: W[i].week, low_weeks: low.length, base, low_avg: avg(low), rec_start: j < W.length ? W[j].week : null,
        weeks: rec, back_weeks: back == null ? null : back - j + 1, back_week: back == null ? null : W[back].week, ongoing: back == null,
        max_ramp: rec.reduce((m, r) => (r.ramp != null && (m == null || r.ramp > m) ? r.ramp : m), null),
      });
      i = back == null ? W.length : back + 1;
    }
    return out.reverse();
  },
});

dash.calc('charge_summary', {
  title: 'Charge et reprise en résumé',
  description: 'Dernière semaine complète comparée aux 4 précédentes, rapport charge aiguë / chronique du dernier jour et son pic sur 4 semaines, nombre de semaines de hausse d’affilée, et dernière reprise après une baisse de volume.',
  inputs: ['ramp_weeks', 'acwr', 'reprises'],
  fn: (ramp_weeks, acwr, reprises) => {
    const w = ramp_weeks[ramp_weeks.length - 1];
    let up = 0;
    for (let i = ramp_weeks.length - 1; i > 0; i--) {
      if (ramp_weeks[i].km > ramp_weeks[i - 1].km) up++;
      else break;
    }
    const a = acwr[acwr.length - 1];
    const peak = acwr.slice(-28).reduce((m, r) => (r.ratio != null && (!m || r.ratio > m.ratio) ? r : m), null);
    const b = reprises[0];
    return [{
      week: w ? w.week : null, km: w ? w.km : null, prev4: w ? w.prev4 : null, ramp: w ? w.ramp : null, up_weeks: up,
      ratio: a ? a.ratio : null, ratio_date: a ? a.date : null, peak_ratio: peak ? peak.ratio : null, peak_date: peak ? peak.date : null,
      rep_start: b ? b.start : null, rep_low_weeks: b ? b.low_weeks : null, rep_base: b ? b.base : null, rep_low: b ? b.low_avg : null,
      rep_back_weeks: b ? b.back_weeks : null, rep_back_week: b ? b.back_week : null, rep_ongoing: b ? b.ongoing : null, rep_max_ramp: b ? b.max_ramp : null,
    }];
  },
});

dash.calc('loops', {
  title: 'Boucles habituelles',
  description: 'Les parcours refaits : chaque tracé d’entraînement (hors compétitions) est rééchantillonné en 24 points régulièrement espacés ; deux sorties suivent la même boucle quand leurs tracés restent en moyenne à moins de 200 m l’un de l’autre (dans un sens ou dans l’autre) et que leurs distances diffèrent de moins de 12 %. Boucles d’au moins 4 sorties, classées en boucle, aller-retour (le retour repasse par l’aller) ou parcours d’un point à un autre, avec l’allure, la FC et les mètres par battement de chaque passage.',
  inputs: ['routes', 'runs', 'hr_runs', 'race_results'],
  fn: (routes, runs, hr_runs, race_results) => {
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
    const M = (a, b) => {
      const kx = 111320 * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
      return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540);
    };
    const resample = (pts, n) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + M(pts[i - 1], pts[i]));
      const L = cum[cum.length - 1];
      if (!(L > 0)) return null;
      const out = [];
      let j = 0;
      for (let s = 0; s < n; s++) {
        const target = (L * s) / (n - 1);
        while (j < cum.length - 2 && cum[j + 1] < target) j++;
        const seg = cum[j + 1] - cum[j] || 1;
        const f = Math.max(0, Math.min(1, (target - cum[j]) / seg));
        out.push([pts[j][0] + f * (pts[j + 1][0] - pts[j][0]), pts[j][1] + f * (pts[j + 1][1] - pts[j][1])]);
      }
      return out;
    };
    const N = 24;
    const races = new Set(race_results.map((r) => r.id));
    const byRun = new Map(runs.map((r) => [r.id, r]));
    const hr = new Map(hr_runs.map((r) => [r.id, r]));
    const items = routes.filter((r) => byRun.has(r.id) && !races.has(r.id)).map((r) => {
      const pts = decode(r.p);
      const s = pts.length > 1 ? resample(pts, N) : null;
      return s ? { id: r.id, run: byRun.get(r.id), s, pts } : null;
    }).filter(Boolean).sort((a, b) => a.run.day - b.run.day);
    const dist = (a, b, rev) => {
      let sum = 0;
      for (let j = 0; j < N; j++) sum += M(a[j], b[rev ? N - 1 - j : j]);
      return sum / N;
    };
    const clusters = [];
    items.forEach((it) => {
      let best = null;
      clusters.forEach((c) => {
        const ref = c.ref;
        if (Math.abs(it.run.km / ref.run.km - 1) > 0.12) return;
        const fwd = M(it.s[0], ref.s[0]) < 800 ? dist(it.s, ref.s, false) : Infinity;
        const rev = M(it.s[0], ref.s[N - 1]) < 800 ? dist(it.s, ref.s, true) : Infinity;
        const d = Math.min(fwd, rev);
        if (d < 200 && (!best || d < best.d)) best = { c, d };
      });
      if (best) best.c.items.push(it);
      else clusters.push({ ref: it, items: [it] });
    });
    const generic = /^((morning|afternoon|evening|lunch|night) run|course à pied.*)$/i;
    const median = (a) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    return clusters.filter((c) => c.items.length >= 4).map((c, i) => {
      const its = c.items;
      const names = new Map();
      its.forEach((x) => {
        if (!generic.test(String(x.run.name || '').trim())) names.set(x.run.name, (names.get(x.run.name) || 0) + 1);
      });
      const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
      const cities = new Map();
      its.forEach((x) => x.run.city && cities.set(x.run.city, (cities.get(x.run.city) || 0) + 1));
      const city = [...cities.entries()].sort((a, b) => b[1] - a[1])[0];
      const km = median(its.map((x) => x.run.km));
      const passes = its.map((x) => {
        const h = hr.get(x.id);
        const hrAvg = h ? h.hr_avg : null;
        return {
          id: x.id, date: x.run.date, day: x.run.day, km: x.run.km, pace_s: x.run.pace_s, hr: hrAvg, name: x.run.name,
          mpb: hrAvg && x.run.pace_s ? (1000 / x.run.pace_s) / (hrAvg / 60) : null,
        };
      });
      const bestP = passes.reduce((a, p) => (p.pace_s && (!a || p.pace_s < a.pace_s) ? p : a), null);
      const step = Math.max(1, Math.floor(c.ref.pts.length / 80));
      // Forme : aller-retour (le retour repasse par l’aller), boucle (on revient au départ), ou parcours d’un point à un autre.
      const s = c.ref.s;
      let back = 0;
      for (let j = 0; j < N / 2; j++) back += M(s[j], s[N - 1 - j]);
      const kind = M(s[0], s[N - 1]) > 600 ? 'Parcours' : back / (N / 2) < 150 ? 'Aller-retour' : 'Boucle';
      return {
        key: `b${i}`, n: its.length, km, kind, name: top && top[1] >= 2 ? top[0] : null, city: city ? city[0] : null,
        first: passes[0].date, last: passes[passes.length - 1].date, best_pace: bestP ? bestP.pace_s : null, best_date: bestP ? bestP.date : null,
        ids: passes.map((p) => p.id), passes, shape: c.ref.pts.filter((p, j) => j % step === 0 || j === c.ref.pts.length - 1),
      };
    }).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, 12);
  },
});

dash.calc('seg_top', {
  title: 'Segments les plus courus',
  description: 'Les segments d’au moins 300 m sur lesquels je suis passé au moins 3 fois (un passage par sortie : le plus rapide), avec le temps, l’allure et la FC de chaque passage, le meilleur et le dernier.',
  inputs: ['seg_efforts', 'segments', 'runs', 'race_results'],
  fn: (seg_efforts, segments, runs, race_results) => {
    const def = new Map(segments.map((s) => [String(s.s), s]));
    const byRun = new Map(runs.map((r) => [r.id, r]));
    const races = new Map(race_results.map((r) => [r.id, r.event]));
    const per = new Map();
    seg_efforts.forEach((row) => {
      const run = byRun.get(row.id);
      if (!run) return;
      const seen = new Map();
      row.e.forEach(([sid, t, hr]) => {
        const d = def.get(String(sid));
        if (!d || !(d.d >= 300) || !(t > 0)) return;
        const prev = seen.get(sid);
        if (!prev || t < prev.t) seen.set(sid, { t, hr });
      });
      seen.forEach((v, sid) => {
        const d = def.get(String(sid));
        if (!per.has(sid)) per.set(sid, []);
        per.get(sid).push({ id: row.id, date: run.date, day: run.day, t: v.t, hr: v.hr, pace_s: v.t / (d.d / 1000), race: races.get(row.id) || null });
      });
    });
    return [...per.entries()].filter(([, list]) => list.length >= 3).map(([sid, list]) => {
      const d = def.get(String(sid));
      const passes = list.sort((a, b) => a.day - b.day);
      const best = passes.reduce((a, p) => (!a || p.t < a.t ? p : a), null);
      const last = passes[passes.length - 1];
      return {
        s: sid, name: d.n, d: d.d, e: d.e, n: passes.length, best_t: best.t, best_pace: best.pace_s, best_date: best.date,
        last_t: last.t, last_date: last.date, passes,
      };
    }).sort((a, b) => b.n - a.n || b.d - a.d).slice(0, 15);
  },
});

dash.calc('recap', {
  title: 'Récap partageable',
  description: 'Bilan du mois en cours, du mois précédent, de l’année en cours et de l’année précédente (le « présent » est la date de la dernière sortie) : distance, sorties, temps, dénivelé, jours actifs, plus longue sortie et sortie la plus rapide sur 5 km et plus à l’entraînement, compétitions et records, km jour par jour (mois) ou mois par mois (année), et comparaison avec la même période un an plus tôt, à date égale pour une période en cours.',
  inputs: ['runs', 'race_results'],
  fn: (runs, race_results) => {
    if (!runs.length) return [];
    const asOf = runs.reduce((a, r) => (r.date > a ? r.date : a), '');
    const [Y, Mo, Dd] = asOf.split('-').map(Number);
    const pad = (n) => String(n).padStart(2, '0');
    const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const pm = Mo === 1 ? [Y - 1, 12] : [Y, Mo - 1];
    const periods = [
      { key: 'month', kind: 'month', y: Y, m: Mo, label: `${months[Mo - 1]} ${Y}`, current: true },
      { key: 'prevmonth', kind: 'month', y: pm[0], m: pm[1], label: `${months[pm[1] - 1]} ${pm[0]}`, current: false },
      { key: 'year', kind: 'year', y: Y, label: String(Y), current: true },
      { key: 'prevyear', kind: 'year', y: Y - 1, label: String(Y - 1), current: false },
    ];
    const raceBy = new Map(race_results.map((r) => [r.id, r]));
    const stats = (a, b) => {
      const rs = runs.filter((r) => r.date >= a && r.date <= b);
      const km = rs.reduce((s, r) => s + r.km, 0);
      return { rs, km };
    };
    return periods.map((p) => {
      const start = p.kind === 'month' ? `${p.y}-${pad(p.m)}-01` : `${p.y}-01-01`;
      const endFull = p.kind === 'month' ? `${p.y}-${pad(p.m)}-${pad(dim(p.y, p.m))}` : `${p.y}-12-31`;
      const end = p.current ? asOf : endFull;
      const { rs, km } = stats(start, end);
      // Même période un an plus tôt (à date égale si la période est en cours).
      const ly = (iso) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
      const cmpEnd = p.current ? ly(asOf) : ly(endFull);
      const cmp = stats(ly(start), cmpEnd.endsWith('-02-29') ? cmpEnd.replace('-02-29', '-02-28') : cmpEnd);
      // Plus longue et plus rapide : à l’entraînement (les compétitions ont leur propre ligne).
      const train = rs.filter((r) => !raceBy.has(r.id));
      const long = train.reduce((a, r) => (!a || r.km > a.km ? r : a), null);
      const fast = train.filter((r) => r.km >= 5 && r.pace_s).reduce((a, r) => (!a || r.pace_s < a.pace_s ? r : a), null);
      const races = rs.filter((r) => raceBy.has(r.id)).map((r) => {
        const x = raceBy.get(r.id);
        return { id: r.id, date: r.date, event: x.event, category: x.category, time_s: x.time_s, pace_s: x.pace_s, pr: x.pr, place: x.place };
      });
      let series;
      if (p.kind === 'month') {
        series = Array.from({ length: dim(p.y, p.m) }, (_, i) => {
          const d = `${p.y}-${pad(p.m)}-${pad(i + 1)}`;
          return { label: String(i + 1), km: rs.filter((r) => r.date === d).reduce((s, r) => s + r.km, 0), future: d > end };
        });
      } else {
        series = Array.from({ length: 12 }, (_, i) => {
          const m = `${p.y}-${pad(i + 1)}`;
          return { label: months[i].slice(0, 1).toUpperCase(), km: rs.filter((r) => r.month === m).reduce((s, r) => s + r.km, 0), future: m > end.slice(0, 7) };
        });
      }
      return {
        key: p.key, kind: p.kind, label: p.label, year: p.y, month: p.m || null, start, end, current: p.current, partial: p.current && end < endFull,
        runs: rs.length, km, hours: rs.reduce((s, r) => s + r.moving_s, 0) / 3600, elev: rs.reduce((s, r) => s + (r.elev_m || 0), 0),
        days: new Set(rs.map((r) => r.date)).size, pace_s: km > 0 ? rs.reduce((s, r) => s + r.moving_s, 0) / km : null,
        kudos: rs.reduce((s, r) => s + (r.kudos || 0), 0),
        long_km: long ? long.km : null, long_date: long ? long.date : null, long_name: long ? (raceBy.has(long.id) ? raceBy.get(long.id).event : long.name) : null,
        fast_pace: fast ? fast.pace_s : null, fast_date: fast ? fast.date : null, fast_km: fast ? fast.km : null,
        races, prs: races.filter((r) => r.pr).length, series, ids: rs.map((r) => r.id),
        cmp_km: cmp.km, cmp_runs: cmp.rs.length, cmp_label: p.kind === 'month' ? `${months[p.m - 1]} ${p.y - 1}` : String(p.y - 1),
      };
    });
  },
});

dash.calc('athlete', {
  title: 'Fiche athlète',
  description: 'Ma carte de visite de coureur, en chiffres parlants pour tous. En tête : la vitesse moyenne de mon record du 10 km (et le 100 m équivalent), celle tenue sur mon record du marathon, et mon meilleur classement rapporté au nombre de coureurs. Puis quatre points forts : la progression (la distance où mon record a le plus baissé depuis ma première course), les records battus rapportés au nombre de compétitions, la fréquence cardiaque à allure égale d’une année sur l’autre, et ma plus grosse semaine (comptée en marathons) avec la moyenne quotidienne de ma meilleure année. Enfin, mes meilleurs classements notés.',
  inputs: ['race_results', 'race_best', 'highlights', 'hr_pace', 'hr_pace_focus'],
  fn: (race_results, race_best, highlights, hr_pace, hr_pace_focus) => {
    const h = highlights[0];
    if (!race_results.length) return [];
    const best = (c) => race_best.find((b) => b.category === c) || null;

    // Classements notés : « 47e / 31 000 », « 3e, premier podium », « 370e »…
    const num = (s) => Number(String(s).replace(/\D/g, ''));
    const placings = race_results.filter((r) => r.place).map((r) => {
      const m = String(r.place).match(/(\d[\d\s  ]*?)\s*e\b/);
      const f = String(r.place).match(/\/\s*(\d[\d\s  ]*)/);
      const rank = m ? num(m[1]) : null;
      const field = f ? num(f[1]) : null;
      return {
        id: r.id, event: r.event, date: r.date, category: r.category, time_s: r.time_s, place: r.place,
        rank, field, top_pct: rank && field ? (rank / field) * 100 : null, podium: rank != null && rank <= 3,
      };
    });
    // Podiums d’abord, puis la plus petite part du peloton devant moi, puis les places sans effectif connu.
    const score = (p) => (p.podium ? p.rank : p.top_pct != null ? 10 + p.top_pct : p.rank != null ? 1000 + p.rank : 1e6);
    placings.sort((a, b) => score(a) - score(b) || (a.date < b.date ? 1 : -1));
    const fielded = placings.filter((p) => p.top_pct != null);
    const star = fielded.length ? fielded.reduce((a, p) => (p.top_pct < a.top_pct ? p : a)) : null;

    // Progression : la distance où le record a le plus baissé, en proportion, depuis ma première course.
    const prog = race_best.filter((b) => b.starts >= 2 && b.gain_s > 0 && b.category !== 'Trail')
      .map((b) => {
        const first = race_results.find((r) => r.category === b.category);
        return { category: b.category, first_time_s: b.first_time_s, first_date: first.date,
          best_time_s: b.time_s, best_date: b.date, gain_s: b.gain_s, gain_pct: b.gain_s / b.first_time_s };
      })
      .reduce((a, p) => (!a || p.gain_pct > a.gain_pct ? p : a), null);

    // Cœur : FC moyenne, chaque année, sur la tranche d’allure suivie (hr_pace_focus).
    const f = hr_pace_focus[0] || null;
    const heart = f ? {
      pace_lo: f.pace_lo, pace_hi: f.pace_hi, kmh_lo: 3600 / f.pace_hi, kmh_hi: 3600 / f.pace_lo,
      from_year: f.from_year, from_hr: f.from_hr, to_year: f.to_year, to_hr: f.to_hr, delta_bpm: f.delta_bpm,
      years: hr_pace.filter((r) => r.pace_lo === f.pace_lo && r.year >= f.from_year).map((r) => ({ year: r.year, hr: r.hr, points: r.points })),
    } : null;

    // Volume : la plus grosse semaine (en marathons de 42,195 km) et la moyenne par jour de la meilleure année.
    let volume = null;
    if (h && h.best_week_km) {
      const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const days = h.best_year === h.ytd_year
        ? Math.round((Date.parse(h.ytd_as_of) - Date.UTC(h.best_year, 0, 1)) / 864e5) + 1
        : leap(h.best_year) ? 366 : 365;
      volume = { best_week: h.best_week, best_week_km: h.best_week_km, marathons: h.best_week_km / 42.195,
        best_year: h.best_year, best_year_km: h.best_year_km, per_day_km: h.best_year_km / days };
    }
    const ten = best('10 km');
    const mara = best('Marathon');
    return [{
      races: race_results.length, prs: race_results.filter((r) => r.pr).length, first_race_year: race_results[0].year,
      speed: ten ? { time_s: ten.time_s, kmh: 36000 / ten.time_s, per100_s: ten.time_s / 100, event: ten.event, date: ten.date } : null,
      marathon: mara ? { time_s: mara.time_s, kmh: (42.195 * 3600) / mara.time_s, event: mara.event, date: mara.date } : null,
      star: star ? { event: star.event, date: star.date, time_s: star.time_s, rank: star.rank, field: star.field, top_pct: star.top_pct } : null,
      progress: prog, heart, volume, placings,
    }];
  },
});
