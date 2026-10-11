/* Calculs cardio, charge d’entraînement, dénivelé et analyses croisées. Chaque formule est lisible dans Sources. */

dash.calc('hr_runs', {
  title: 'Cardio par sortie',
  description: 'Pour chaque sortie enregistrée avec un cardio : FC moyenne des points en mouvement (vitesse d’au moins 0,5 m/s, point de départ écarté), temps dans chaque zone Strava (part des points × temps en mouvement), mètres parcourus par battement (vitesse moyenne ÷ FC moyenne), dérive cardiaque (rapport vitesse/FC de la 2e moitié comparé à la 1re) et régularité de l’allure (écart-type ÷ moyenne de la vitesse). Les points dont la FC tombe sous 65 % de la médiane de la sortie (décrochage du capteur) sont écartés, ainsi que les sorties à la FC figée (moins de 5 valeurs différentes) ou avec moins de 20 points.',
  inputs: ['runs', 'hr_streams', 'hr_zones'],
  fn: (runs, hr_streams, hr_zones) => {
    const zoneOf = (bpm) => hr_zones.find((z) => bpm >= z.min_bpm && (z.max_bpm == null || bpm <= z.max_bpm)).zone;
    const byRun = new Map();
    hr_streams.forEach((p) => {
      if (p.point > 0 && p.hr > 0 && p.speed >= 0.5) {
        if (!byRun.has(p.id)) byRun.set(p.id, []);
        byRun.get(p.id).push(p);
      }
    });
    const mean = (pts, f) => pts.reduce((s, p) => s + f(p), 0) / pts.length;
    const clean = (pts) => {
      const sorted = pts.map((p) => p.hr).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      return pts.filter((p) => p.hr >= 0.65 * median).sort((a, b) => a.point - b.point);
    };
    return runs.filter((r) => byRun.has(r.id)).map((r) => {
      const pts = clean(byRun.get(r.id));
      if (pts.length < 20 || new Set(pts.map((p) => p.hr)).size < 5) return null;
      const hr = mean(pts, (p) => p.hr);
      const v = mean(pts, (p) => p.speed);
      const half = Math.floor(pts.length / 2);
      const eff = (part) => mean(part, (p) => p.speed) / mean(part, (p) => p.hr);
      const share = (k) => pts.filter((p) => zoneOf(p.hr) === k).length / pts.length;
      return {
        id: r.id, date: r.date, year: r.year, month: r.month, name: r.name, sport: r.sport,
        km: r.km, moving_s: r.moving_s, pace_s: r.pace_s, elev_m: r.elev_m, effort: r.effort, spm: r.spm,
        hr_avg: hr,
        z1_s: share(1) * r.moving_s, z2_s: share(2) * r.moving_s, z3_s: share(3) * r.moving_s,
        z4_s: share(4) * r.moving_s, z5_s: share(5) * r.moving_s,
        m_per_beat: ((r.km * 1000) / r.moving_s) * 60 / hr,
        drift: 1 - eff(pts.slice(half)) / eff(pts.slice(0, half)),
        speed_cv: Math.sqrt(mean(pts, (p) => (p.speed - v) ** 2)) / v,
      };
    }).filter(Boolean);
  },
});

dash.calc('zones_by_year', {
  title: 'Zones cardio par année',
  description: 'Heures passées dans chaque zone de fréquence cardiaque Strava, par année, part du temps en endurance (zones 1 et 2) et en intensité haute (zones 4 et 5), FC moyenne pondérée par le temps.',
  inputs: ['hr_runs'],
  fn: (hr_runs) => [...new Set(hr_runs.map((r) => r.year))].sort((a, b) => a - b).map((year) => {
    const rs = hr_runs.filter((r) => r.year === year);
    const sec = rs.reduce((s, r) => s + r.moving_s, 0);
    const h = (k) => rs.reduce((s, r) => s + r[`z${k}_s`], 0) / 3600;
    return {
      year, runs: rs.length, hours: sec / 3600,
      z1_h: h(1), z2_h: h(2), z3_h: h(3), z4_h: h(4), z5_h: h(5),
      easy_share: (h(1) + h(2)) / (sec / 3600),
      hard_share: (h(4) + h(5)) / (sec / 3600),
      hr_avg: rs.reduce((s, r) => s + r.hr_avg * r.moving_s, 0) / sec,
    };
  }),
});

dash.calc('zones_by_month', {
  title: 'Zones cardio par mois',
  description: 'Heures passées dans chaque zone de fréquence cardiaque Strava, mois par mois, du premier mois avec cardio au dernier mois couru (zéro pour un mois sans sortie).',
  inputs: ['hr_runs'],
  fn: (hr_runs) => {
    const months = hr_runs.map((r) => r.month).sort();
    const out = [];
    let [y, m] = months[0].split('-').map(Number);
    const [ly, lm] = months[months.length - 1].split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      const rs = hr_runs.filter((r) => r.month === month);
      const h = (k) => rs.reduce((s, r) => s + r[`z${k}_s`], 0) / 3600;
      out.push({
        month, year: y, runs: rs.length, hours: rs.reduce((s, r) => s + r.moving_s, 0) / 3600,
        z1_h: h(1), z2_h: h(2), z3_h: h(3), z4_h: h(4), z5_h: h(5),
      });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
    return out;
  },
});

dash.calc('zones_by_band', {
  title: 'Zones cardio par distance',
  description: 'Part du temps dans chaque zone de fréquence cardiaque Strava selon la tranche de distance de la sortie (moins de 5 km, 5–10, 10–15, 15–20, 20–25, 25 km et plus), avec la FC moyenne.',
  inputs: ['hr_runs'],
  fn: (hr_runs) => {
    const bands = [['< 5 km', 0, 5], ['5–10 km', 5, 10], ['10–15 km', 10, 15], ['15–20 km', 15, 20], ['20–25 km', 20, 25], ['25 km et +', 25, Infinity]];
    return bands.map(([band, lo, hi], band_i) => {
      const rs = hr_runs.filter((r) => r.km >= lo && r.km < hi);
      const sec = rs.reduce((s, r) => s + r.moving_s, 0);
      const sh = (k) => (sec ? rs.reduce((s, r) => s + r[`z${k}_s`], 0) / sec : null);
      return {
        band, band_i, runs: rs.length, hours: sec / 3600,
        z1: sh(1), z2: sh(2), z3: sh(3), z4: sh(4), z5: sh(5),
        hr_avg: sec ? rs.reduce((s, r) => s + r.hr_avg * r.moving_s, 0) / sec : null,
      };
    }).filter((b) => b.runs > 0);
  },
});

dash.calc('load', {
  title: 'Forme, fatigue et fraîcheur',
  description: 'Charge du jour = somme des efforts relatifs Strava du jour (course et autres sports avec cardio). Forme = moyenne exponentielle de la charge sur 42 jours, fatigue = sur 7 jours, fraîcheur = forme − fatigue (modèle forme/fatigue classique, calcul maison).',
  inputs: ['activities'],
  fn: (activities) => {
    const dayOf = (s) => {
      const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
      return Date.UTC(y, m - 1, d) / 864e5;
    };
    const loads = new Map();
    activities.filter((a) => a.relative_effort != null).forEach((a) => {
      const k = dayOf(a.start_local);
      const l = loads.get(k) || { all: 0, run: 0 };
      l.all += Number(a.relative_effort);
      if (['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type)) l.run += Number(a.relative_effort);
      loads.set(k, l);
    });
    const first = Math.min(...loads.keys());
    const last = Math.max(...activities.map((a) => dayOf(a.start_local)));
    let fitness = 0;
    let fatigue = 0;
    const out = [];
    for (let d = first; d <= last; d++) {
      const l = loads.get(d) || { all: 0, run: 0 };
      fitness += (l.all - fitness) / 42;
      fatigue += (l.all - fatigue) / 7;
      out.push({
        date: new Date(d * 864e5).toISOString().slice(0, 10), load: l.all, run_load: l.run,
        fitness, fatigue, form: fitness - fatigue,
      });
    }
    return out;
  },
});

dash.calc('load_now', {
  title: 'Forme du moment',
  description: 'Forme, fatigue et fraîcheur au dernier jour de l’export, forme 4 semaines plus tôt et pic de forme.',
  inputs: ['load'],
  fn: (load) => {
    const now = load[load.length - 1];
    const before = load[Math.max(0, load.length - 29)];
    const peak = load.reduce((a, r) => (r.fitness > a.fitness ? r : a));
    return [{
      date: now.date, fitness: now.fitness, fatigue: now.fatigue, form: now.form,
      fitness_4w: before.fitness, fitness_delta: now.fitness - before.fitness,
      peak_fitness: peak.fitness, peak_date: peak.date,
    }];
  },
});

dash.calc('load_weeks', {
  title: 'Charge par semaine',
  description: 'Somme des efforts relatifs Strava par semaine (lundi → dimanche) : course à pied et autres sports.',
  inputs: ['load'],
  fn: (load) => {
    const weeks = new Map();
    load.forEach((d) => {
      const t = new Date(`${d.date}T00:00:00Z`);
      const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      const w = weeks.get(monday) || { week: monday, load: 0, run_load: 0 };
      w.load += d.load;
      w.run_load += d.run_load;
      weeks.set(monday, w);
    });
    return [...weeks.values()].map((w) => ({ ...w, other_load: w.load - w.run_load }));
  },
});

dash.calc('hr_pace', {
  title: 'FC selon l’allure, par année',
  description: 'FC moyenne des points de course sur le plat (pente entre −2 et +2 %), à allure stable (allure à ±8 % au point d’avant et d’après), hors échauffement (4 premiers points sur 40) et tapis, par tranche d’allure de 15 s/km et par année ; tranches d’au moins 15 points.',
  inputs: ['hr_streams', 'runs'],
  fn: (hr_streams, runs) => {
    const yearOf = new Map(runs.filter((r) => r.sport !== 'VirtualRun').map((r) => [r.id, r.year]));
    const byRun = new Map();
    hr_streams.forEach((p) => {
      if (!yearOf.has(p.id)) return;
      if (!byRun.has(p.id)) byRun.set(p.id, []);
      byRun.get(p.id)[p.point] = p;
    });
    const cells = new Map();
    byRun.forEach((pts, id) => {
      pts.forEach((p, i) => {
        const a = pts[i - 1];
        const b = pts[i + 1];
        if (i < 4 || !a || !b || !(p.hr >= 100) || !(p.speed >= 2.5 && p.speed <= 6.5) || !(Math.abs(p.grade) <= 2)) return;
        if (Math.abs(a.speed / p.speed - 1) > 0.08 || Math.abs(b.speed / p.speed - 1) > 0.08) return;
        const lo = Math.floor(1000 / p.speed / 15) * 15;
        const key = `${yearOf.get(id)}|${lo}`;
        const c = cells.get(key) || { year: yearOf.get(id), pace_lo: lo, points: 0, sum: 0 };
        c.points += 1;
        c.sum += p.hr;
        cells.set(key, c);
      });
    });
    return [...cells.values()].filter((c) => c.points >= 15)
      .map((c) => ({ year: c.year, pace_lo: c.pace_lo, pace_hi: c.pace_lo + 15, points: c.points, hr: c.sum / c.points }))
      .sort((a, b) => a.year - b.year || a.pace_lo - b.pace_lo);
  },
});

dash.calc('hr_pace_focus', {
  title: 'Même allure, FC comparée',
  description: 'Sur la tranche d’allure la mieux renseignée à la fois la première année avec au moins 300 points et l’année la plus récente, la FC moyenne de chacune et l’écart.',
  inputs: ['hr_pace'],
  fn: (hr_pace) => {
    const years = [...new Set(hr_pace.map((c) => c.year))].sort((a, b) => a - b);
    const total = (y) => hr_pace.filter((c) => c.year === y).reduce((s, c) => s + c.points, 0);
    const from = years.find((y) => total(y) >= 300);
    const to = years[years.length - 1];
    const pairs = hr_pace.filter((c) => c.year === from)
      .map((a) => [a, hr_pace.find((b) => b.year === to && b.pace_lo === a.pace_lo)])
      .filter(([, b]) => b);
    if (from == null || from === to || !pairs.length) return [];
    const [a, b] = pairs.reduce((best, p) => (Math.min(p[0].points, p[1].points) > Math.min(best[0].points, best[1].points) ? p : best));
    return [{
      pace_lo: a.pace_lo, pace_hi: a.pace_hi, from_year: from, from_hr: a.hr, from_points: a.points,
      to_year: to, to_hr: b.hr, to_points: b.points, delta_bpm: b.hr - a.hr,
    }];
  },
});

dash.calc('easy_runs', {
  title: 'Sorties faciles et régulières',
  description: 'Sorties avec cardio dont la FC moyenne reste en zone 1 ou 2, d’au moins 5 km, à allure régulière (variation de vitesse sous 20 %), hors compétitions et tapis : la base des mesures d’efficacité aérobie.',
  inputs: ['hr_runs', 'hr_zones', 'races'],
  fn: (hr_runs, hr_zones, races) => {
    const z2 = hr_zones.find((z) => z.zone === 2).max_bpm;
    const raceIds = new Set(races.map((r) => String(r.id)));
    return hr_runs.filter((r) => r.hr_avg <= z2 && r.km >= 5 && r.speed_cv < 0.2 && !raceIds.has(r.id) && r.sport !== 'VirtualRun')
      .map((r) => ({ id: r.id, date: r.date, year: r.year, month: r.month, km: r.km, pace_s: r.pace_s, hr_avg: r.hr_avg, m_per_beat: r.m_per_beat }));
  },
});

dash.calc('efficiency', {
  title: 'Efficacité aérobie par mois',
  description: 'Mètres parcourus par battement de cœur (vitesse moyenne ÷ FC moyenne) des sorties faciles et régulières : médiane par mois (mois d’au moins 3 sorties), avec l’allure et la FC médianes.',
  inputs: ['easy_runs'],
  fn: (easy_runs) => [...new Set(easy_runs.map((r) => r.month))].sort().map((month) => {
    const rs = easy_runs.filter((r) => r.month === month);
    const med = (f) => {
      const v = rs.map(f).sort((a, b) => a - b);
      const mid = Math.floor(v.length / 2);
      return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    };
    return { month, runs: rs.length, m_per_beat: med((r) => r.m_per_beat), pace_s: med((r) => r.pace_s), hr_avg: med((r) => r.hr_avg) };
  }).filter((m) => m.runs >= 3),
});

dash.calc('efficiency_years', {
  title: 'Efficacité aérobie par année',
  description: 'Médiane, par année (années d’au moins 5 sorties faciles et régulières), des mètres parcourus par battement, de l’allure et de la FC, et l’écart avec l’année précédente et avec la première année.',
  inputs: ['easy_runs'],
  fn: (easy_runs) => {
    const rows = [...new Set(easy_runs.map((r) => r.year))].sort((a, b) => a - b).map((year) => {
      const rs = easy_runs.filter((r) => r.year === year);
      const med = (f) => {
        const v = rs.map(f).sort((a, b) => a - b);
        const mid = Math.floor(v.length / 2);
        return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
      };
      return { year, runs: rs.length, m_per_beat: med((r) => r.m_per_beat), pace_s: med((r) => r.pace_s), hr_avg: med((r) => r.hr_avg) };
    }).filter((r) => r.runs >= 5);
    return rows.map((r, i) => ({
      ...r, vs_prev: i > 0 ? r.m_per_beat / rows[i - 1].m_per_beat - 1 : null,
      first_year: rows[0].year, vs_first: i > 0 ? r.m_per_beat / rows[0].m_per_beat - 1 : null,
    }));
  },
});

dash.calc('hr_pace_fit', {
  title: 'FC selon l’allure : tendance par année',
  description: 'Droite de régression de la FC moyenne sur l’allure moyenne des sorties d’au moins 3 km avec cardio (hors tapis), pour chaque année d’au moins 30 sorties : pente, ordonnée, et FC attendue à 4′30″/km.',
  inputs: ['hr_runs'],
  fn: (hr_runs) => {
    const pts = hr_runs.filter((r) => r.km >= 3 && r.sport !== 'VirtualRun');
    return [...new Set(pts.map((r) => r.year))].sort((a, b) => a - b).map((year) => {
      const rs = pts.filter((r) => r.year === year);
      const n = rs.length;
      const mx = rs.reduce((s, r) => s + r.pace_s, 0) / n;
      const my = rs.reduce((s, r) => s + r.hr_avg, 0) / n;
      const slope = rs.reduce((s, r) => s + (r.pace_s - mx) * (r.hr_avg - my), 0) / rs.reduce((s, r) => s + (r.pace_s - mx) ** 2, 0);
      const intercept = my - slope * mx;
      return {
        year, runs: n, slope, intercept, hr_at_270: intercept + slope * 270,
        pace_min: Math.min(...rs.map((r) => r.pace_s)), pace_max: Math.max(...rs.map((r) => r.pace_s)),
      };
    }).filter((r) => r.runs >= 30);
  },
});

dash.calc('drift_long', {
  title: 'Dérive cardiaque des sorties longues',
  description: 'Sorties d’au moins 1 h à allure régulière (variation de vitesse sous 15 %), hors tapis : dérive cardiaque = baisse du rapport vitesse/FC entre la 1re et la 2e moitié de la sortie (sous 5 % : endurance bien installée).',
  inputs: ['hr_runs'],
  fn: (hr_runs) => hr_runs
    .filter((r) => r.moving_s >= 3600 && r.speed_cv < 0.15 && r.sport !== 'VirtualRun')
    .map((r) => ({ id: r.id, date: r.date, year: r.year, name: r.name, km: r.km, moving_s: r.moving_s, pace_s: r.pace_s, hr_avg: r.hr_avg, drift: r.drift })),
});

dash.calc('drift_years', {
  title: 'Dérive cardiaque par année',
  description: 'Par année : nombre de sorties longues régulières, dérive médiane et part des sorties restées sous 5 % de dérive.',
  inputs: ['drift_long'],
  fn: (drift_long) => [...new Set(drift_long.map((r) => r.year))].sort((a, b) => a - b).map((year) => {
    const v = drift_long.filter((r) => r.year === year).map((r) => r.drift).sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return { year, runs: v.length, drift_median: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2, under5_share: v.filter((d) => d < 0.05).length / v.length };
  }),
});

dash.calc('grade_effect', {
  title: 'Effet de la pente',
  description: 'Pour chaque point de course (hors échauffement : 4 premiers points sur 40, arrêts et tapis), vitesse et FC comparées à celles de la même sortie sur le plat (pente entre −1 et +1 %, sorties d’au moins 5 points plats) ; moyennes par tranche de pente de 2 % (de −9 à +9 %, tranches d’au moins 30 points), traduites en allure et FC à partir de la moyenne de toutes les sorties sur le plat.',
  inputs: ['hr_streams', 'runs'],
  fn: (hr_streams, runs) => {
    const ok = new Set(runs.filter((r) => r.sport !== 'VirtualRun').map((r) => r.id));
    const byRun = new Map();
    hr_streams.forEach((p) => {
      if (!ok.has(p.id) || p.point < 4 || !(p.hr >= 100) || !(p.speed >= 1.5) || p.grade == null) return;
      if (!byRun.has(p.id)) byRun.set(p.id, []);
      byRun.get(p.id).push(p);
    });
    const cells = new Map();
    let flatSpeed = 0;
    let flatHr = 0;
    let runsUsed = 0;
    byRun.forEach((pts) => {
      const flat = pts.filter((p) => Math.abs(p.grade) < 1);
      if (flat.length < 5) return;
      const v0 = flat.reduce((s, p) => s + p.speed, 0) / flat.length;
      const h0 = flat.reduce((s, p) => s + p.hr, 0) / flat.length;
      flatSpeed += v0;
      flatHr += h0;
      runsUsed += 1;
      pts.forEach((p) => {
        if (Math.abs(p.grade) >= 9) return;
        const lo = Math.floor((p.grade + 1) / 2) * 2 - 1; // tranches centrées sur les pairs : −1 à +1 %, +1 à +3 %…
        const c = cells.get(lo) || { grade_lo: lo, points: 0, ratio: 0, dhr: 0 };
        c.points += 1;
        c.ratio += p.speed / v0;
        c.dhr += p.hr - h0;
        cells.set(lo, c);
      });
    });
    const refPace = 1000 / (flatSpeed / runsUsed);
    const refHr = flatHr / runsUsed;
    return [...cells.values()].filter((c) => c.points >= 30).sort((a, b) => a.grade_lo - b.grade_lo).map((c) => ({
      grade_lo: c.grade_lo, grade_hi: c.grade_lo + 2, grade_mid: c.grade_lo + 1, points: c.points,
      speed_ratio: c.ratio / c.points, pace_change: c.points / c.ratio - 1, hr_change: c.dhr / c.points,
      pace_s: refPace / (c.ratio / c.points), hr: refHr + c.dhr / c.points, runs: runsUsed,
    }));
  },
});

dash.calc('cadence_fit', {
  title: 'Cadence selon l’allure',
  description: 'Droite de régression de la cadence (pas/min) sur l’allure (s/km) des sorties d’au moins 3 km où la montre mesure la cadence, hors tapis : pente, ordonnée, coefficient R² et gain de cadence pour 10 s/km plus vite.',
  inputs: ['runs'],
  fn: (runs) => {
    const pts = runs.filter((r) => r.spm && r.km >= 3 && r.sport !== 'VirtualRun');
    const n = pts.length;
    const mx = pts.reduce((s, r) => s + r.pace_s, 0) / n;
    const my = pts.reduce((s, r) => s + r.spm, 0) / n;
    const sxy = pts.reduce((s, r) => s + (r.pace_s - mx) * (r.spm - my), 0);
    const sxx = pts.reduce((s, r) => s + (r.pace_s - mx) ** 2, 0);
    const syy = pts.reduce((s, r) => s + (r.spm - my) ** 2, 0);
    const slope = sxy / sxx;
    return [{
      runs: n, slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy), per_10s: -slope * 10,
      pace_min: Math.min(...pts.map((r) => r.pace_s)), pace_max: Math.max(...pts.map((r) => r.pace_s)),
    }];
  },
});

dash.calc('race_plus', {
  title: 'VDOT et FC en compétition',
  description: 'Pour chaque compétition : VDOT de Jack Daniels d’après la distance officielle et le chrono (courses sur route de 10 km, 20 km, semi et marathon ; pas les relais, trails, Paris-Versailles ni Marseille-Cassis, trop vallonnés), meilleur VDOT atteint jusque-là, FC moyenne de la course quand la montre l’a enregistrée, et forme (modèle forme/fatigue) la veille au soir.',
  inputs: ['race_results', 'hr_runs', 'load'],
  fn: (race_results, hr_runs, load) => {
    const hr = new Map(hr_runs.map((r) => [r.id, r.hr_avg]));
    const fit = new Map(load.map((d, i) => [d.date, i > 0 ? load[i - 1].fitness : null]));
    const vdot = (m, s) => {
      const t = s / 60;
      const v = m / t;
      return (-4.6 + 0.182258 * v + 0.000104 * v * v) / (0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t));
    };
    let best = null;
    return race_results.map((r) => {
      const v = ['10 km', '20 km', 'Semi', 'Marathon'].includes(r.category) ? vdot(r.km * 1000, r.time_s) : null;
      if (v != null && (best == null || v > best)) best = v;
      return {
        id: r.id, date: r.date, year: r.year, event: r.event, category: r.category, km: r.km, time_s: r.time_s, pr: r.pr,
        vdot: v, vdot_best: best,
        hr_avg: hr.has(r.id) ? hr.get(r.id) : null,
        fitness: fit.has(r.date) ? fit.get(r.date) : null,
      };
    });
  },
});

dash.calc('race_predict', {
  title: 'Équivalences de chrono',
  description: 'Temps équivalents sur 5 km, 10 km, semi et marathon d’après la formule VDOT de Jack Daniels, à partir du meilleur VDOT des 12 mois précédant la dernière compétition, comparés aux records en compétition.',
  inputs: ['race_plus', 'race_best'],
  fn: (race_plus, race_best) => {
    const vdot = (m, s) => {
      const t = s / 60;
      const v = m / t;
      return (-4.6 + 0.182258 * v + 0.000104 * v * v) / (0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t));
    };
    const last = race_plus.reduce((a, r) => (r.date > a ? r.date : a), '');
    const since = `${Number(last.slice(0, 4)) - 1}${last.slice(4)}`;
    const top = race_plus.filter((r) => r.vdot != null && r.date > since).reduce((a, r) => (!a || r.vdot > a.vdot ? r : a), null);
    const solve = (m) => {
      let lo = 60;
      let hi = 8 * 3600;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (vdot(m, mid) > top.vdot) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    return [['5 km', 5, null], ['10 km', 10, '10 km'], ['Semi', 21.0975, 'Semi'], ['Marathon', 42.195, 'Marathon']].map(([distance, km, cat]) => {
      const t = solve(km * 1000);
      const best = cat ? race_best.find((b) => b.category === cat) : null;
      return {
        distance, km, time_s: t, pace_s: t / km, vdot: top.vdot, from_event: top.event, from_date: top.date,
        best_s: best ? best.time_s : null, best_date: best ? best.date : null,
      };
    });
  },
});

dash.calc('elev_by_year', {
  title: 'Dénivelé par année',
  description: 'Par année : dénivelé positif total, mètres de D+ par km et par sortie, sorties vallonnées (au moins 10 m de D+ par km) et sortie au plus fort dénivelé.',
  inputs: ['runs'],
  fn: (runs) => [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b).map((year) => {
    const rs = runs.filter((r) => r.year === year);
    const elev = rs.reduce((s, r) => s + r.elev_m, 0);
    const km = rs.reduce((s, r) => s + r.km, 0);
    const top = rs.reduce((a, r) => (r.elev_m > a.elev_m ? r : a));
    return {
      year, runs: rs.length, elev_m: elev, km, m_per_km: elev / km, m_per_run: elev / rs.length,
      hilly_runs: rs.filter((r) => r.km > 0 && r.elev_m / r.km >= 10).length,
      top_elev_m: top.elev_m, top_name: top.name, top_date: top.date,
    };
  }),
});

dash.calc('terrain', {
  title: 'Sorties par profil',
  description: 'Sorties classées par dénivelé positif par km : plat (moins de 5 m/km), vallonné (5 à 10), accidenté (10 à 20), montagne (20 et plus) ; nombre, km, D+, allure moyenne et FC moyenne (sorties avec cardio).',
  inputs: ['runs', 'hr_runs'],
  fn: (runs, hr_runs) => {
    const hr = new Map(hr_runs.map((r) => [r.id, r]));
    return [['Plat', 0, 5], ['Vallonné', 5, 10], ['Accidenté', 10, 20], ['Montagne', 20, Infinity]].map(([profile, lo, hi], profile_i) => {
      const rs = runs.filter((r) => r.km >= 1 && r.elev_m / r.km >= lo && r.elev_m / r.km < hi);
      const km = rs.reduce((s, r) => s + r.km, 0);
      const withHr = rs.filter((r) => hr.has(r.id));
      const sec = withHr.reduce((s, r) => s + r.moving_s, 0);
      return {
        profile, profile_i, runs: rs.length, km, elev_m: rs.reduce((s, r) => s + r.elev_m, 0),
        pace_s: km ? rs.reduce((s, r) => s + r.moving_s, 0) / km : null,
        hr_avg: sec ? withHr.reduce((s, r) => s + hr.get(r.id).hr_avg * r.moving_s, 0) / sec : null,
      };
    });
  },
});

dash.calc('elev_top', {
  title: 'Plus gros dénivelés',
  description: 'Les 10 sorties avec le plus de dénivelé positif, et leur D+ par km.',
  inputs: ['runs'],
  fn: (runs) => [...runs].sort((a, b) => b.elev_m - a.elev_m).slice(0, 10).map((r) => ({
    id: r.id, date: r.date, name: r.name, km: r.km, elev_m: r.elev_m, m_per_km: r.km > 0 ? r.elev_m / r.km : null, pace_s: r.pace_s,
  })),
});
