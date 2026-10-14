/* Calculs des onglets Objectif, Entraînement et Carte. Chaque formule est une fonction pure de ses sources. */

dash.calc('goal_info', {
  title: 'Course objectif',
  description: 'La prochaine course marquée « objectif » dans le calendrier (ou la dernière, pendant les 3 semaines qui suivent) : date, distance, chrono visé, allure correspondante, jours restants depuis la dernière sortie enregistrée et, une fois courue, le chrono de la compétition du même jour.',
  inputs: ['goal', 'runs', 'race_results'],
  fn: (goal, runs, race_results) => {
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const asOf = runs.reduce((a, r) => (r.date > a ? r.date : a), '');
    const goals = goal.filter((g) => g.role === 'objectif').sort((x, y) => (x.date < y.date ? -1 : 1));
    const a = goals.find((g) => g.date >= asOf) || goals.filter((g) => day(asOf) - day(g.date) <= 21).pop();
    if (!a) return [];
    const km = Number(a.distance_km);
    const res = race_results.filter((r) => r.date === a.date).sort((x, y) => Math.abs(x.km - km) - Math.abs(y.km - km))[0];
    return [{
      event: a.event, date: a.date, category: a.category, km, target_s: a.target_s,
      target_pace_s: a.target_s ? a.target_s / km : null, days_left: day(a.date) - day(asOf), as_of: asOf,
      result_s: res ? res.time_s : null, result_pace_s: res ? res.pace_s : null, result_place: res ? res.place : null,
    }];
  },
});

dash.calc('goal_calendar', {
  title: 'Calendrier des courses',
  description: 'Les courses prévues après la dernière sortie enregistrée, avec le nombre de jours entre chaque course et la précédente (la dernière compétition courue sert de point de départ).',
  inputs: ['goal', 'runs', 'race_results'],
  fn: (goal, runs, race_results) => {
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const asOf = runs.reduce((a, r) => (r.date > a ? r.date : a), '');
    const past = race_results.length ? race_results[race_results.length - 1] : null;
    let prev = past ? { event: past.event, date: past.date } : null;
    return goal.filter((g) => g.date > asOf).sort((x, y) => (x.date < y.date ? -1 : 1)).map((g) => {
      const row = {
        event: g.event, date: g.date, role: g.role, km: Number(g.distance_km), target_s: g.target_s,
        days_left: day(g.date) - day(asOf), gap_days: prev ? day(g.date) - day(prev.date) : null,
        prev_event: prev ? prev.event : null,
      };
      prev = { event: g.event, date: g.date };
      return row;
    });
  },
});

dash.calc('goal_predict', {
  title: 'Chrono prédit pour la course objectif',
  description: 'Chrono équivalent sur la distance de la course objectif d’après la formule VDOT de Jack Daniels : à partir du meilleur VDOT des 12 derniers mois et du VDOT de la dernière compétition sur route ; plus le VDOT qu’il faut pour le chrono visé.',
  inputs: ['race_plus', 'goal_info'],
  fn: (race_plus, goal_info) => {
    if (!goal_info.length) return [];
    const g = goal_info[0];
    const vdot = (m, s) => {
      const t = s / 60;
      const v = m / t;
      return (-4.6 + 0.182258 * v + 0.000104 * v * v) / (0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t));
    };
    const solve = (m, target) => {
      let lo = 60;
      let hi = 8 * 3600;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (vdot(m, mid) > target) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const since = `${Number(g.as_of.slice(0, 4)) - 1}${g.as_of.slice(4)}`;
    const withV = race_plus.filter((r) => r.vdot != null);
    const best = withV.filter((r) => r.date > since).reduce((a, r) => (!a || r.vdot > a.vdot ? r : a), null);
    const last = withV.reduce((a, r) => (!a || r.date > a.date ? r : a), null);
    const m = g.km * 1000;
    const rows = [];
    if (best) rows.push({ basis: 'best', event: best.event, date: best.date, vdot: best.vdot, time_s: solve(m, best.vdot) });
    if (last) rows.push({ basis: 'last', event: last.event, date: last.date, vdot: last.vdot, time_s: solve(m, last.vdot) });
    if (g.target_s) rows.push({ basis: 'target', event: g.event, date: g.date, vdot: vdot(m, g.target_s), time_s: g.target_s });
    return rows;
  },
});

dash.calc('goal_build', {
  title: 'Forme avant la course objectif',
  description: 'Forme (charge moyenne des 42 derniers jours) et fraîcheur, jour par jour sur les 120 jours qui précèdent la course objectif, comparées aux 120 jours qui ont précédé la dernière édition courue de la même épreuve.',
  inputs: ['load', 'goal_info', 'race_results'],
  fn: (load, goal_info, race_results) => {
    if (!goal_info.length) return [];
    const g = goal_info[0];
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
    const prev = race_results.filter((r) => r.event === g.event && r.date < g.date)
      .reduce((a, r) => (!a || r.date > a.date ? r : a), null);
    const by = new Map(load.map((l) => [l.date, l]));
    const g0 = day(g.date);
    const p0 = prev ? day(prev.date) : null;
    const out = [];
    for (let d = -120; d <= 0; d++) {
      const c = by.get(iso(g0 + d));
      const p = p0 != null ? by.get(iso(p0 + d)) : null;
      out.push({
        d, cur_date: iso(g0 + d), cur: c ? c.fitness : null, cur_form: c ? c.form : null,
        prev_date: p0 != null ? iso(p0 + d) : null, prev: p ? p.fitness : null, prev_form: p ? p.form : null,
        prev_event: prev ? prev.event : null, prev_year: prev ? prev.year : null, prev_time_s: prev ? prev.time_s : null,
      });
    }
    return out;
  },
});

dash.calc('goal_weeks', {
  title: 'Volume des semaines avant la course objectif',
  description: 'Kilomètres courus chaque semaine des 16 semaines qui précèdent la course objectif (S-1 = les 7 jours avant la course), comparés aux mêmes semaines avant la dernière édition courue. La semaine en cours est partielle.',
  inputs: ['runs', 'goal_info', 'race_results'],
  fn: (runs, goal_info, race_results) => {
    if (!goal_info.length) return [];
    const g = goal_info[0];
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const prev = race_results.filter((r) => r.event === g.event && r.date < g.date)
      .reduce((a, r) => (!a || r.date > a.date ? r : a), null);
    const last = Math.max(...runs.map((r) => r.day));
    const g0 = day(g.date);
    const p0 = prev ? day(prev.date) : null;
    const sum = (end, w) => runs.filter((r) => r.day >= end - 7 * w && r.day <= end - 7 * (w - 1) - 1).reduce((s, r) => s + r.km, 0);
    const out = [];
    for (let w = 16; w >= 1; w--) {
      const started = g0 - 7 * w <= last;
      out.push({
        w: -w, label: `S-${w}`, cur: started ? sum(g0, w) : null, cur_partial: started && g0 - 7 * (w - 1) - 1 > last,
        prev: p0 != null ? sum(p0, w) : null, prev_year: prev ? prev.year : null,
      });
    }
    return out;
  },
});

dash.calc('run_class', {
  title: 'Type de chaque sortie',
  description: 'Chaque sortie depuis 2023 classée en compétition, séance de qualité ou footing. Avec les tours de la montre : tours plus rapides que 1,2 × l’allure du meilleur 10 km des 12 mois précédents = travail ; des tours de travail qui se suivent forment un bloc ; une séance compte au moins 1,5 km de travail en 2 blocs, ou un bloc de 3 km. Type selon la longueur médiane des blocs (≤ 600 m : fractionné court ; < 2 km : fractionné long ; sinon seuil / tempo). Sans tours : séance si 15 % du temps en zones 4-5 ou allure moyenne sous ce seuil. Pour chaque footing : part du temps au-dessus de la zone 2 (zones 3 à 5).',
  inputs: ['runs', 'hr_runs', 'laps', 'race_results'],
  fn: (runs, hr_runs, laps, race_results) => {
    const races = new Map(race_results.map((r) => [r.id, r]));
    const hr = new Map(hr_runs.map((r) => [r.id, r]));
    const lapsBy = new Map();
    laps.forEach((l) => {
      if (!lapsBy.has(l.id)) lapsBy.set(l.id, []);
      lapsBy.get(l.id).push(l);
    });
    const tens = race_results.filter((r) => r.category === '10 km').map((r) => ({ day: r.day, pace: r.time_s / r.km }));
    const thrAt = (d) => {
      const win = tens.filter((t) => t.day < d && t.day >= d - 365);
      const pool = win.length ? win : tens.filter((t) => t.day < d);
      return pool.length ? 1.2 * Math.min(...pool.map((t) => t.pace)) : 255;
    };
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const median = (a) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const label = (d) => (d >= 1950 ? `${(Math.round(d / 100) / 10).toLocaleString('fr-FR')} km` : `${d >= 1000 ? Math.round(d / 100) * 100 : Math.round(d / 50) * 50} m`);
    const detect = (L, thr) => {
      const ls = [...L].sort((a, b) => a.i - b.i).filter((l) => l.d >= 80 && l.mt >= 15).map((l) => ({ ...l, p: l.mt / (l.d / 1000) }));
      if (ls.length < 2) return null;
      // Tours automatiques au kilomètre : seul un bloc continu d’au moins 3 km rapides compte (un km rapide isolé n’est pas une répétition).
      const auto = ls.slice(0, -1).filter((l) => Math.abs(l.d - 1000) <= 30).length >= 0.8 * (ls.length - 1);
      const asRep = (b) => {
        const ht = sum(b.filter((l) => l.hr), (l) => l.mt);
        return { d: sum(b, (l) => l.d), t: sum(b, (l) => l.mt), hr: ht ? sum(b.filter((l) => l.hr), (l) => l.hr * l.mt) / ht : null };
      };
      let reps;
      if (auto) {
        const blocks = [];
        let cur = null;
        ls.forEach((l) => {
          if (l.p <= thr) {
            if (!cur) cur = [];
            cur.push(l);
          } else if (cur) {
            blocks.push(cur);
            cur = null;
          }
        });
        if (cur) blocks.push(cur);
        reps = blocks.map(asRep).filter((r) => r.d >= 2950);
        if (!reps.length) return null;
      } else {
        // Tours manuels ou séance programmée : chaque tour rapide est une répétition.
        reps = ls.filter((l) => l.p <= thr && l.d >= 150).map((l) => asRep([l]));
      }
      const work = sum(reps, (r) => r.d);
      const long = reps.some((r) => r.d >= 2950);
      if (!(long || (work >= 1500 && reps.length >= 2))) return null;
      const med = median(reps.map((r) => r.d));
      const type = med <= 600 ? 'Fractionné court' : med < 2000 ? 'Fractionné long' : 'Seuil / tempo';
      const groups = new Map();
      reps.forEach((r) => groups.set(label(r.d), (groups.get(label(r.d)) || 0) + 1));
      const structure = reps.length === 1 ? `${label(reps[0].d)} continus`
        : [...groups.entries()].map(([k, n]) => `${n} × ${k}`).join(' · ');
      const main = [...groups.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const same = reps.filter((r) => label(r.d) === main).map((r) => r.t / (r.d / 1000));
      const mu = same.reduce((s, x) => s + x, 0) / same.length;
      const ht = sum(reps.filter((r) => r.hr), (r) => r.t);
      return {
        type, structure, work_km: work / 1000, reps: reps.length, rep_pace: sum(reps, (r) => r.t) / (work / 1000),
        rep_hr: ht ? sum(reps.filter((r) => r.hr), (r) => r.hr * r.t) / ht : null,
        rep_sd: same.length > 1 ? Math.sqrt(same.reduce((s, x) => s + (x - mu) ** 2, 0) / same.length) : null,
        detail: reps.map((r) => ({ d: Math.round(r.d), t: r.t, hr: r.hr == null ? null : Math.round(r.hr) })),
      };
    };
    return runs.filter((r) => r.date >= '2023-01-01').map((r) => {
      const h = hr.get(r.id);
      const L = lapsBy.get(r.id);
      const thr = thrAt(r.day);
      const mv = h ? h.z1_s + h.z2_s + h.z3_s + h.z4_s + h.z5_s : 0;
      const base = {
        id: r.id, date: r.date, day: r.day, week: r.week, year: r.year, name: r.name, km: r.km, pace_s: r.pace_s,
        moving_s: r.moving_s, effort: r.effort, hr_avg: h ? h.hr_avg : null,
        z3p: mv ? (h.z3_s + h.z4_s + h.z5_s) / mv : null, z4p: mv ? (h.z4_s + h.z5_s) / mv : null,
        has_laps: !!L, thr,
      };
      if (races.has(r.id)) return { ...base, kind: 'course', type: 'Course', structure: races.get(r.id).event };
      if (L) {
        const q = detect(L, thr);
        return q ? { ...base, kind: 'qualité', ...q } : { ...base, kind: 'footing' };
      }
      if ((base.z4p != null && base.z4p >= 0.15) || (r.pace_s && r.pace_s <= thr && r.km >= 3)) {
        return { ...base, kind: 'qualité', type: 'Séance (sans tours)', structure: null };
      }
      return { ...base, kind: 'footing' };
    });
  },
});

dash.calc('easy_runs_class', {
  title: 'Footings : vrai facile ou zone grise',
  description: 'Chaque footing avec cardio (3 km et plus, hors jours de compétition : pas d’échauffement ni de retour au calme) classé selon la part de son temps au-dessus de la zone 2 (zones 3 à 5) : facile sous 10 %, limite de 10 à 30 %, zone grise à partir de 30 %.',
  inputs: ['run_class'],
  fn: (run_class) => {
    const raceDays = new Set(run_class.filter((r) => r.kind === 'course').map((r) => r.day));
    return run_class.filter((r) => r.kind === 'footing' && r.z3p != null && r.km >= 3 && !raceDays.has(r.day)).map((r) => ({
      id: r.id, date: r.date, day: r.day, week: r.week, year: r.year, name: r.name, km: r.km, pace_s: r.pace_s,
      hr_avg: r.hr_avg, z3p: r.z3p, level: r.z3p < 0.1 ? 'facile' : r.z3p < 0.3 ? 'limite' : 'zone grise',
    }));
  },
});

dash.calc('easy_weeks', {
  title: 'Footings par semaine',
  description: 'Pour chacune des 26 dernières semaines (lundi → dimanche) : nombre de footings faciles, limites et en zone grise, et FC moyenne des footings.',
  inputs: ['easy_runs_class', 'by_week'],
  fn: (easy, by_week) => by_week.slice(-26).map((w) => {
    const rs = easy.filter((r) => r.week === w.week);
    const n = (l) => rs.filter((r) => r.level === l).length;
    return {
      week: w.week, facile: n('facile'), limite: n('limite'), grise: n('zone grise'), total: rs.length,
      hr_avg: rs.length ? rs.reduce((s, r) => s + r.hr_avg, 0) / rs.length : null,
    };
  }),
});

dash.calc('easy_summary', {
  title: 'Zone grise en résumé',
  description: 'Part des footings en zone grise sur les 4 et 8 dernières semaines, sur l’année en cours et sur l’année précédente ; FC et allure médianes des footings des 8 dernières semaines.',
  inputs: ['easy_runs_class', 'runs'],
  fn: (easy, runs) => {
    const last = Math.max(...runs.map((r) => r.day));
    const year = Number(new Date(last * 864e5).toISOString().slice(0, 4));
    const share = (rs) => (rs.length ? rs.filter((r) => r.level === 'zone grise').length / rs.length : null);
    const med = (a) => {
      const s = a.filter((x) => x != null).sort((x, y) => x - y);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    const w4 = easy.filter((r) => r.day > last - 28);
    const w8 = easy.filter((r) => r.day > last - 56);
    return [{
      share_4w: share(w4), n_4w: w4.length, share_8w: share(w8), n_8w: w8.length,
      share_year: share(easy.filter((r) => r.year === year)), year,
      share_prev: share(easy.filter((r) => r.year === year - 1)), prev_year: year - 1,
      hr_med_8w: med(w8.map((r) => r.hr_avg)), pace_med_8w: med(w8.map((r) => r.pace_s)),
    }];
  },
});

dash.calc('vol_weeks', {
  title: 'Volume glissant',
  description: 'Kilomètres de chaque semaine et moyennes glissantes sur 4, 8 et 13 semaines, avec le nombre de semaines consécutives à 90 km ou plus.',
  inputs: ['by_week'],
  fn: (by_week) => {
    let streak = 0;
    return by_week.map((w, i) => {
      const avg = (n) => {
        const win = by_week.slice(Math.max(0, i - n + 1), i + 1);
        return win.reduce((s, x) => s + x.km, 0) / n;
      };
      streak = w.km >= 90 ? streak + 1 : 0;
      return { week: w.week, km: w.km, runs: w.runs, avg4: avg(4), avg8: avg(8), avg13: avg(13), streak90: streak };
    });
  },
});

dash.calc('vol_summary', {
  title: 'Volume en résumé',
  description: 'Moyennes sur 4, 8 et 13 semaines à la dernière semaine enregistrée, série en cours de semaines à 90 km ou plus, et plus longue série jamais faite (début, fin, moyenne).',
  inputs: ['vol_weeks'],
  fn: (vol_weeks) => {
    if (!vol_weeks.length) return [];
    const now = vol_weeks[vol_weeks.length - 1];
    let best = null;
    let run = null;
    vol_weeks.forEach((w) => {
      if (w.km >= 90) {
        run = run ? { ...run, end: w.week, n: run.n + 1, km: run.km + w.km } : { start: w.week, end: w.week, n: 1, km: w.km };
        if (!best || run.n > best.n) best = { ...run };
      } else run = null;
    });
    return [{
      week: now.week, avg4: now.avg4, avg8: now.avg8, avg13: now.avg13, streak: now.streak90,
      best_n: best ? best.n : 0, best_start: best ? best.start : null, best_end: best ? best.end : null,
      best_avg: best ? best.km / best.n : null,
    }];
  },
});

dash.calc('vol_race', {
  title: 'Volume avant chaque course',
  description: 'Pour chaque compétition sur route avec un VDOT (10 km, 20 km, semi, marathon) : kilomètres moyens par semaine sur les 8 semaines (56 jours) qui l’ont précédée, et VDOT obtenu.',
  inputs: ['runs', 'race_plus', 'race_results'],
  fn: (runs, race_plus, race_results) => {
    const days = new Map(race_results.map((r) => [r.id, r.day]));
    return race_plus.filter((r) => r.vdot != null && days.has(r.id)).map((r) => {
      const d = days.get(r.id);
      const km = runs.filter((x) => x.day >= d - 56 && x.day < d).reduce((s, x) => s + x.km, 0);
      return { id: r.id, date: r.date, year: r.year, event: r.event, category: r.category, vdot: r.vdot, pr: r.pr, km8: km / 8 };
    });
  },
});

dash.calc('long_runs', {
  title: 'Sorties longues',
  description: 'Toutes les sorties de 18 km ou plus, compétitions comprises, avec leur allure.',
  inputs: ['runs', 'race_results'],
  fn: (runs, race_results) => {
    const races = new Map(race_results.map((r) => [r.id, r]));
    return runs.filter((r) => r.km >= 18).map((r) => ({
      id: r.id, date: r.date, day: r.day, year: r.year, name: r.name, km: r.km, pace_s: r.pace_s,
      race: races.has(r.id), event: races.has(r.id) ? races.get(r.id).event : null,
    }));
  },
});

dash.calc('long_summary', {
  title: 'Sorties longues en résumé',
  description: 'Sorties d’entraînement de 25 km ou plus sur les 8 dernières semaines et sur les 12 derniers mois, dernière sortie de 30 km ou plus, plus longue sortie des 12 dernières semaines.',
  inputs: ['long_runs', 'runs'],
  fn: (long_runs, runs) => {
    const last = Math.max(...runs.map((r) => r.day));
    const train = long_runs.filter((r) => !r.race);
    const in12w = long_runs.filter((r) => r.day > last - 84);
    const top = in12w.reduce((a, r) => (!a || r.km > a.km ? r : a), null);
    const l30 = train.filter((r) => r.km >= 30).reduce((a, r) => (!a || r.day > a.day ? r : a), null);
    return [{
      n25_8w: train.filter((r) => r.km >= 25 && r.day > last - 56).length,
      n25_12m: train.filter((r) => r.km >= 25 && r.day > last - 365).length,
      last30_date: l30 ? l30.date : null, last30_km: l30 ? l30.km : null,
      top12w_km: top ? top.km : null, top12w_date: top ? top.date : null,
    }];
  },
});

dash.calc('recov', {
  title: 'Récupération après chaque course',
  description: 'Pour chaque compétition depuis 2024 : jours avant la séance dure suivante (séance de qualité, course, ou sortie d’effort relatif d’au moins 70), et charge (efforts relatifs) des 7 jours d’après comparée aux 7 jours d’avant.',
  inputs: ['race_results', 'run_class', 'load'],
  fn: (race_results, run_class, load) => {
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const L = new Map(load.map((l) => [day(l.date), l.load]));
    const hard = run_class.filter((r) => r.kind === 'qualité' || r.kind === 'course' || (r.effort != null && r.effort >= 70))
      .sort((a, b) => a.day - b.day);
    const span = (a, b) => {
      let s = 0;
      for (let d = a; d <= b; d++) s += L.get(d) || 0;
      return s;
    };
    const lastDay = Math.max(...load.map((l) => day(l.date)));
    return race_results.filter((r) => r.date >= '2024-01-01').map((r) => {
      const next = hard.find((h) => h.day > r.day);
      return {
        id: r.id, date: r.date, day: r.day, event: r.event, category: r.category,
        gap: next ? next.day - r.day : null, open: !next && lastDay - r.day < 14,
        next_date: next ? next.date : null, next_kind: next ? next.kind : null,
        next_label: next ? (next.kind === 'course' ? next.structure : next.kind === 'qualité' ? next.structure || next.type : `sortie d’effort ${next.effort}`) : null,
        load_before: span(r.day - 7, r.day - 1), load_after: span(r.day + 1, Math.min(r.day + 7, lastDay)),
      };
    });
  },
});

dash.calc('recov_summary', {
  title: 'Récupération en résumé',
  description: 'Sur les compétitions des 12 derniers mois : délai médian avant la séance dure suivante, part des courses suivies d’une séance dure ou d’une course en moins de 72 heures, nombre de courses sur les 8 dernières semaines et dans les 8 prochaines.',
  inputs: ['recov', 'goal_calendar', 'runs'],
  fn: (recov, goal_calendar, runs) => {
    const last = Math.max(...runs.map((r) => r.day));
    const yr = recov.filter((r) => r.day > last - 365 && r.gap != null);
    const gaps = yr.map((r) => r.gap).sort((a, b) => a - b);
    return [{
      n: yr.length, gap_med: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      share_72h: yr.length ? yr.filter((r) => r.gap <= 3).length / yr.length : null,
      races_8w: recov.filter((r) => r.day > last - 56).length,
      next_8w: goal_calendar.filter((g) => g.days_left <= 56).length,
    }];
  },
});

dash.calc('race_density', {
  title: 'Courses rapprochées',
  description: 'Pour chacune des 26 dernières semaines (lundi → dimanche), puis chaque semaine jusqu’à la dernière course prévue au calendrier : nombre de compétitions sur les 8 semaines qui se terminent avec elle, et compétitions de la semaine (courues ou prévues).',
  inputs: ['race_results', 'goal_calendar', 'by_week'],
  fn: (race_results, goal_calendar, by_week) => {
    const day = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
    const all = [
      ...race_results.map((r) => ({ day: r.day, event: r.event, future: false })),
      ...goal_calendar.map((g) => ({ day: day(g.date), event: g.event, future: true })),
    ];
    const weeks = by_week.slice(-26).map((w) => day(w.week));
    if (!weeks.length) return [];
    const lastWeek = weeks[weeks.length - 1];
    const lastPlan = goal_calendar.length ? Math.max(...goal_calendar.map((g) => day(g.date))) : lastWeek;
    for (let d = lastWeek + 7; d <= lastPlan; d += 7) weeks.push(d);
    return weeks.map((w) => {
      const end = w + 6;
      const inWeek = all.filter((r) => r.day >= w && r.day <= end);
      return {
        week: iso(w), n: all.filter((r) => r.day > end - 56 && r.day <= end).length, future: w > lastWeek,
        k: inWeek.length, events: inWeek.map((r) => r.event).join(' · '),
      };
    });
  },
});

dash.calc('quality_weeks', {
  title: 'Séances de qualité par semaine',
  description: 'Pour chacune des 26 dernières semaines : séances de qualité par type (fractionné court, fractionné long, seuil / tempo, séance repérée sans tours) et compétitions, avec la part des sorties dont les tours sont connus.',
  inputs: ['run_class', 'by_week'],
  fn: (run_class, by_week) => by_week.slice(-26).map((w) => {
    const rs = run_class.filter((r) => r.week === w.week);
    const n = (t) => rs.filter((r) => r.kind === 'qualité' && r.type === t).length;
    return {
      week: w.week, court: n('Fractionné court'), long: n('Fractionné long'), seuil: n('Seuil / tempo'),
      autre: n('Séance (sans tours)'), course: rs.filter((r) => r.kind === 'course').length,
      runs: rs.length, laps: rs.filter((r) => r.has_laps).length,
    };
  }),
});

dash.calc('quality_list', {
  title: 'Dernières séances de qualité',
  description: 'Les séances de qualité des 6 derniers mois, repérées avec les tours de la montre : structure, allure et FC moyennes des répétitions, régularité (écart-type de l’allure des répétitions de même longueur) et détail de chaque répétition.',
  inputs: ['run_class', 'runs'],
  fn: (run_class, runs) => {
    const last = Math.max(...runs.map((r) => r.day));
    return run_class.filter((r) => r.kind === 'qualité' && r.has_laps && r.day > last - 183)
      .sort((a, b) => b.day - a.day)
      .map((r) => ({
        id: r.id, date: r.date, name: r.name, type: r.type, structure: r.structure, km: r.km, work_km: r.work_km,
        reps: r.reps, rep_pace: r.rep_pace, rep_hr: r.rep_hr, rep_sd: r.rep_sd, detail: r.detail,
      }));
  },
});

dash.calc('laps_coverage', {
  title: 'Sorties avec tours',
  description: 'Nombre de sorties de course à pied dont les tours et les meilleurs efforts ont déjà été récupérés (rattrapage de l’historique en cours, des plus récentes aux plus anciennes).',
  inputs: ['laps', 'runs'],
  fn: (laps, runs) => {
    const ids = new Set(laps.map((l) => l.id));
    const with_ = runs.filter((r) => ids.has(r.id));
    return [{
      runs: runs.length, with_laps: with_.length,
      oldest: with_.length ? with_.reduce((a, r) => (r.date < a ? r.date : a), with_[0].date) : null,
    }];
  },
});

dash.calc('effort_best', {
  title: 'Meilleurs efforts à l’entraînement et en course',
  description: 'Pour chaque distance de mes meilleurs temps : record (date, en course ou non), meilleur temps des 12 derniers mois et des 30 derniers jours.',
  inputs: ['efforts', 'runs', 'race_results'],
  fn: (efforts, runs, race_results) => {
    const order = ['400 m', '800 m', '1 km', '1 mile', '2 miles', '5 km', '10 km', '15 km', '10 miles', '20 km', 'Semi', '30 km', 'Marathon'];
    const km = { '400 m': 0.4, '800 m': 0.8045, '1 km': 1, '1 mile': 1.609344, '2 miles': 3.218688, '5 km': 5, '10 km': 10, '15 km': 15, '10 miles': 16.09344, '20 km': 20, Semi: 21.0975, '30 km': 30, Marathon: 42.195 };
    const byId = new Map(runs.map((r) => [r.id, r]));
    const races = new Set(race_results.map((r) => r.id));
    const last = Math.max(...runs.map((r) => r.day));
    const rows = efforts.filter((e) => byId.has(e.id)).map((e) => ({ ...e, day: byId.get(e.id).day, date: byId.get(e.id).date, race: races.has(e.id) }));
    const min = (a) => a.reduce((x, e) => (!x || e.s < x.s ? e : x), null);
    return order.filter((n) => rows.some((e) => e.e === n)).map((n) => {
      const all = rows.filter((e) => e.e === n);
      const rec = min(all);
      const y = min(all.filter((e) => e.day > last - 365));
      const m = min(all.filter((e) => e.day > last - 30));
      return {
        effort: n, km: km[n], n: all.length, best_s: rec.s, best_date: rec.date, best_race: rec.race, best_id: rec.id,
        y_s: y ? y.s : null, y_date: y ? y.date : null, m_s: m ? m.s : null, m_date: m ? m.date : null,
      };
    });
  },
});

dash.calc('effort_monthly', {
  title: 'Meilleurs efforts par mois',
  description: 'Meilleur temps de chaque mois sur 1 km, 5 km et 10 km (meilleurs temps, courses comprises), converti en allure au kilomètre.',
  inputs: ['efforts', 'runs'],
  fn: (efforts, runs) => {
    const km = { '1 km': 1, '5 km': 5, '10 km': 10 };
    const byId = new Map(runs.map((r) => [r.id, r]));
    const best = new Map();
    efforts.filter((e) => km[e.e] && byId.has(e.id)).forEach((e) => {
      const r = byId.get(e.id);
      const k = `${r.month}|${e.e}`;
      if (!best.has(k) || e.s < best.get(k).s) best.set(k, { month: r.month, effort: e.e, s: e.s, pace_s: e.s / km[e.e], id: e.id, date: r.date });
    });
    return [...best.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  },
});

dash.calc('map_runs', {
  title: 'Parcours',
  description: 'Tracé simplifié (polyligne encodée) de chaque sortie de course à pied, avec sa date, sa distance, son allure et, pour une compétition, l’épreuve, la distance officielle et le chrono.',
  inputs: ['routes', 'runs', 'race_results'],
  fn: (routes, runs, race_results) => {
    const byId = new Map(runs.map((r) => [r.id, r]));
    const races = new Map(race_results.map((r) => [r.id, r]));
    return routes.filter((r) => byId.has(r.id)).map((r) => {
      const run = byId.get(r.id);
      const race = races.get(r.id);
      return {
        id: r.id, date: run.date, day: run.day, year: run.year, km: run.km, name: run.name, city: run.city, moving_s: run.moving_s, pace_s: run.pace_s, p: r.p,
        race: !!race, event: race ? race.event : null, category: race ? race.category : null,
        race_km: race ? race.km : null, time_s: race ? race.time_s : null, race_pace_s: race ? race.pace_s : null, place: race ? race.place : null,
      };
    });
  },
});
