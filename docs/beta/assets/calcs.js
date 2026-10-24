/* Calculs du tableau de bord. Chaque formule est lisible dans Sources. */

dash.calc('runs', {
  title: 'Sorties de course à pied',
  description: 'Les sorties de course à pied (route, trail et tapis) de mon historique, avec km, allure, semaine, jour et lieu calculés.',
  inputs: ['activities'],
  fn: (activities) => {
    const pays = { France: 'France', Italy: 'Italie', Spain: 'Espagne', Croatia: 'Croatie', Romania: 'Roumanie' };
    return activities
      .filter((a) => ['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type))
      .map((a) => {
        const date = String(a.start_local).slice(0, 10);
        const [y, m, d] = date.split('-').map(Number);
        const day = Date.UTC(y, m - 1, d) / 864e5; // jours depuis le 1er janvier 1970
        const dow = (new Date(day * 864e5).getUTCDay() + 6) % 7; // 0 = lundi
        const place = String(a.location_summary || '').split(', ').filter(Boolean);
        const km = Number(a.distance) / 1000;
        const moving = Number(a.moving_time);
        return {
          id: String(a.id), name: a.name, sport: a.sport_type, start: String(a.start_local), date, year: y, month: date.slice(0, 7),
          week: new Date((day - dow) * 864e5).toISOString().slice(0, 10),
          day, doy: day - Date.UTC(y, 0, 1) / 864e5 + 1, dow, hour: Number(String(a.start_local).slice(11, 13)),
          km, moving_s: moving, elapsed_s: Number(a.elapsed_time), pace_s: km > 0 ? moving / km : null,
          elev_m: Number(a.elevation_gain) || 0,
          spm: a.avg_cadence ? Number(a.avg_cadence) * 2 : null,
          effort: a.relative_effort == null ? null : Number(a.relative_effort),
          kudos: Number(a.kudos_count) || 0, prs: Number(a.pr_count) || 0,
          city: place.length > 1 ? place[0] : null,
          country: place.length ? pays[place[place.length - 1]] || place[place.length - 1] : null,
        };
      })
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  },
});

dash.calc('totals', {
  title: 'Totaux depuis le début',
  description: 'Somme de toutes les sorties : distance, temps en mouvement, dénivelé, jours actifs, lieux, compétitions et équivalences (tour de la Terre : 40 075 km ; Everest : 8 849 m).',
  inputs: ['runs', 'races'],
  fn: (runs, races) => {
    const km = runs.reduce((s, r) => s + r.km, 0);
    const hours = runs.reduce((s, r) => s + r.moving_s, 0) / 3600;
    const elev = runs.reduce((s, r) => s + r.elev_m, 0);
    const dates = runs.map((r) => r.date).sort();
    return [{
      runs: runs.length, km, hours, elev_m: elev,
      active_days: new Set(dates).size,
      first_date: dates[0], last_date: dates[dates.length - 1], first_year: Number(dates[0].slice(0, 4)),
      countries: new Set(runs.map((r) => r.country).filter(Boolean)).size,
      cities: new Set(runs.filter((r) => r.city).map((r) => `${r.city}, ${r.country}`)).size,
      races: races.length,
      marathons: races.filter((r) => r.category === 'Marathon').length,
      semis: races.filter((r) => r.category === 'Semi').length,
      tens: races.filter((r) => r.category === '10 km').length,
      kudos: runs.reduce((s, r) => s + r.kudos, 0),
      earth_pct: (km / 40075) * 100,
      everests: elev / 8849,
      days_nonstop: hours / 24,
      longest_km: Math.max(...runs.map((r) => r.km)),
    }];
  },
});

dash.calc('by_year', {
  title: 'Bilan par année',
  description: 'Par année : sorties, km, heures, dénivelé, allure moyenne (temps en mouvement ÷ distance), plus longue sortie, meilleure semaine, régularité, compétitions et cadence moyenne.',
  inputs: ['runs', 'races'],
  fn: (runs, races) => {
    const raceIds = new Set(races.map((r) => String(r.id)));
    const lastDay = Math.max(...runs.map((r) => r.day));
    const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
    return years.map((year) => {
      const rs = runs.filter((r) => r.year === year);
      const km = rs.reduce((s, r) => s + r.km, 0);
      const moving = rs.reduce((s, r) => s + r.moving_s, 0);
      const weeks = new Map();
      rs.forEach((r) => weeks.set(r.week, (weeks.get(r.week) || 0) + r.km));
      const cad = rs.filter((r) => r.spm);
      const cadTime = cad.reduce((s, r) => s + r.moving_s, 0);
      const start = Date.UTC(year, 0, 1) / 864e5;
      const span = Math.min(Date.UTC(year + 1, 0, 1) / 864e5, lastDay + 1) - start; // jours écoulés de l’année
      return {
        year, runs: rs.length, km, hours: moving / 3600, elev_m: rs.reduce((s, r) => s + r.elev_m, 0),
        km_per_run: km / rs.length, longest_km: Math.max(...rs.map((r) => r.km)), pace_s: moving / km,
        active_days: new Set(rs.map((r) => r.date)).size, runs_per_week: rs.length / (span / 7),
        best_week_km: Math.max(...weeks.values()),
        races: rs.filter((r) => raceIds.has(r.id)).length,
        kudos: rs.reduce((s, r) => s + r.kudos, 0),
        spm: cadTime ? cad.reduce((s, r) => s + r.spm * r.moving_s, 0) / cadTime : null,
      };
    });
  },
});

dash.calc('ytd', {
  title: 'Cumul à date, année par année',
  description: 'Km et sorties de chaque année du 1er janvier jusqu’au même jour et mois que la dernière sortie, et l’écart avec l’année précédente.',
  inputs: ['runs'],
  fn: (runs) => {
    const last = runs.reduce((a, r) => (r.date > a.date ? r : a));
    const cut = last.date.slice(5); // "MM-JJ"
    const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
    const rows = years.map((year) => {
      const rs = runs.filter((r) => r.year === year && r.date.slice(5) <= cut);
      return { year, as_of: `${year}-${cut}`, km: rs.reduce((s, r) => s + r.km, 0), runs: rs.length };
    });
    return rows.map((r) => {
      const prev = rows.find((p) => p.year === r.year - 1);
      return { ...r, vs_prev: prev && prev.km > 0 ? r.km / prev.km - 1 : null };
    });
  },
});

dash.calc('by_month', {
  title: 'Volume par mois',
  description: 'Km, sorties et heures pour chaque mois de chaque année ; les mois sans sortie valent zéro, les mois à venir sont marqués.',
  inputs: ['runs'],
  fn: (runs) => {
    const lastMonth = runs.reduce((a, r) => (r.month > a ? r.month : a), '');
    const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
    return years.flatMap((year) => Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const rs = runs.filter((r) => r.month === month);
      return {
        month, year, m: i + 1, km: rs.reduce((s, r) => s + r.km, 0), runs: rs.length,
        hours: rs.reduce((s, r) => s + r.moving_s, 0) / 3600, future: month > lastMonth,
      };
    }));
  },
});

dash.calc('by_week', {
  title: 'Volume par semaine',
  description: 'Km, heures et sorties par semaine (lundi → dimanche) depuis la reprise régulière (première sortie suivie d’une autre dans l’année), avec la moyenne glissante sur 4 semaines.',
  inputs: ['runs'],
  fn: (runs) => {
    const start = runs.find((r, i) => runs[i + 1] && runs[i + 1].day - r.day < 365);
    const last = runs[runs.length - 1];
    const weeks = [];
    for (let d = start.day - start.dow; d <= last.day - last.dow; d += 7) {
      const rs = runs.filter((r) => r.day - r.dow === d);
      weeks.push({
        week: new Date(d * 864e5).toISOString().slice(0, 10), km: rs.reduce((s, r) => s + r.km, 0),
        hours: rs.reduce((s, r) => s + r.moving_s, 0) / 3600, runs: rs.length,
      });
    }
    return weeks.map((w, i) => {
      const win = weeks.slice(Math.max(0, i - 3), i + 1);
      const avg = (k) => win.reduce((s, x) => s + x[k], 0) / win.length;
      return { ...w, km_avg4: avg('km'), hours_avg4: avg('hours'), runs_avg4: avg('runs') };
    });
  },
});

dash.calc('by_day', {
  title: 'Volume par jour',
  description: 'Km, temps et nombre de sorties pour chaque jour couru.',
  inputs: ['runs'],
  fn: (runs) => {
    const days = new Map();
    runs.forEach((r) => {
      const d = days.get(r.date) || { date: r.date, year: r.year, day: r.day, dow: r.dow, km: 0, moving_s: 0, runs: 0 };
      d.km += r.km; d.moving_s += r.moving_s; d.runs += 1;
      days.set(r.date, d);
    });
    return [...days.values()];
  },
});

dash.calc('cumul', {
  title: 'Cumul annuel jour par jour',
  description: 'Km cumulés depuis le 1er janvier de chaque année, à chaque sortie, jusqu’au 31 décembre ou à la dernière sortie de l’année en cours.',
  inputs: ['runs'],
  fn: (runs) => {
    const last = runs[runs.length - 1];
    const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
    return years.flatMap((year) => {
      let km = 0;
      const pts = [{ year, doy: 0, km: 0 }];
      runs.filter((r) => r.year === year).forEach((r) => { km += r.km; pts.push({ year, doy: r.doy, km }); });
      const end = year === last.year ? last.doy : (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5;
      if (pts[pts.length - 1].doy < end) pts.push({ year, doy: end, km });
      return pts;
    });
  },
});

dash.calc('bands', {
  title: 'Tranches de distance par année',
  description: 'Par année et par tranche (moins de 5 km, 5–10, 10–15, 15–20, 20–25, 25 km et plus) : sorties, km, part des km et des sorties de l’année, allure moyenne.',
  inputs: ['runs'],
  fn: (runs) => {
    const bands = [['< 5 km', 0, 5], ['5–10 km', 5, 10], ['10–15 km', 10, 15], ['15–20 km', 15, 20], ['20–25 km', 20, 25], ['25 km et +', 25, Infinity]];
    const years = [...new Set(runs.map((r) => r.year))].sort((a, b) => a - b);
    return years.flatMap((year) => {
      const all = runs.filter((r) => r.year === year);
      const yearKm = all.reduce((s, r) => s + r.km, 0);
      return bands.map(([band, lo, hi], band_i) => {
        const rs = all.filter((r) => r.km >= lo && r.km < hi);
        const km = rs.reduce((s, r) => s + r.km, 0);
        return {
          year, band, band_i, runs: rs.length, km, share_km: km / yearKm, share_runs: rs.length / all.length,
          pace_s: km > 0 ? rs.reduce((s, r) => s + r.moving_s, 0) / km : null,
        };
      });
    });
  },
});

dash.calc('band_summary', {
  title: 'Tranches de distance, au total',
  description: 'Pour chaque tranche de distance, toutes années confondues : sorties, km, part du volume, allure et distance moyennes.',
  inputs: ['runs'],
  fn: (runs) => {
    const bands = [['< 5 km', 0, 5], ['5–10 km', 5, 10], ['10–15 km', 10, 15], ['15–20 km', 15, 20], ['20–25 km', 20, 25], ['25 km et +', 25, Infinity]];
    const total = runs.reduce((s, r) => s + r.km, 0);
    return bands.map(([band, lo, hi], band_i) => {
      const rs = runs.filter((r) => r.km >= lo && r.km < hi);
      const km = rs.reduce((s, r) => s + r.km, 0);
      return {
        band, band_i, runs: rs.length, km, share_km: km / total,
        pace_s: km > 0 ? rs.reduce((s, r) => s + r.moving_s, 0) / km : null, avg_km: rs.length ? km / rs.length : null,
      };
    });
  },
});

dash.calc('dist_hist', {
  title: 'Répartition des distances',
  description: 'Nombre de sorties par tranche de 1 km (0–1 km, 1–2 km, …).',
  inputs: ['runs'],
  fn: (runs) => {
    const max = Math.floor(Math.max(...runs.map((r) => r.km)));
    return Array.from({ length: max + 1 }, (_, k) => ({
      from_km: k, to_km: k + 1, runs: runs.filter((r) => Math.floor(r.km) === k).length,
    }));
  },
});

dash.calc('longest', {
  title: 'Plus longues sorties',
  description: 'Les 10 sorties les plus longues en distance.',
  inputs: ['runs'],
  fn: (runs) => [...runs].sort((a, b) => b.km - a.km).slice(0, 10).map((r) => ({
    id: r.id, date: r.date, name: r.name, km: r.km, moving_s: r.moving_s, pace_s: r.pace_s, elev_m: r.elev_m,
  })),
});

dash.calc('race_results', {
  title: 'Résultats en compétition',
  description: 'Chaque compétition avec son chrono (officiel s’il est connu, sinon temps écoulé), sa distance officielle (10 km, 20 km, semi, marathon, 16,2 km pour Paris-Versailles, ou celle notée pour l’épreuve ; à défaut la distance GPS), son allure réelle (chrono ÷ distance officielle) et si c’était un record dans sa catégorie à ce moment-là.',
  inputs: ['races', 'runs'],
  fn: (races, runs) => {
    const OFFICIAL = { '10 km': 10, Semi: 21.0975, '20 km': 20, Marathon: 42.195, 'Paris-Versailles': 16.2 };
    const byId = new Map(runs.map((r) => [r.id, r]));
    const best = new Map();
    return races
      .filter((race) => byId.has(String(race.id)))
      .map((race) => {
        const run = byId.get(String(race.id));
        const time = race.official_s == null ? run.elapsed_s : Number(race.official_s);
        const set = race.distance_km != null ? Number(race.distance_km) : OFFICIAL[race.category];
        const km = set > 0 ? set : run.km;
        return {
          id: run.id, date: run.date, year: run.year, day: run.day, event: race.event, category: race.category,
          km, gps_km: run.km, official_km: set > 0, time_s: time, official: race.official_s != null, pace_s: time / km,
          place: race.place || null, elev_m: run.elev_m, spm: run.spm, kudos: run.kudos,
        };
      })
      .sort((a, b) => a.day - b.day)
      .map((r) => {
        const prev = best.get(r.category);
        const pr = !['Relais', 'Autre'].includes(r.category) && (prev == null || r.time_s < prev);
        if (pr) best.set(r.category, r.time_s);
        return { ...r, pr };
      });
  },
});

dash.calc('race_best', {
  title: 'Records en compétition',
  description: 'Meilleur chrono par catégorie de course, nombre de participations et gain depuis la première participation.',
  inputs: ['race_results'],
  fn: (race_results) => ['10 km', 'Semi', '20 km', 'Marathon', 'Paris-Versailles', 'Trail']
    .map((category) => race_results.filter((r) => r.category === category))
    .filter((rs) => rs.length > 0)
    .map((rs) => {
      const best = rs.reduce((a, r) => (r.time_s < a.time_s ? r : a));
      return {
        category: best.category, time_s: best.time_s, pace_s: best.pace_s, event: best.event, date: best.date,
        id: best.id, starts: rs.length, first_time_s: rs[0].time_s, gain_s: rs[0].time_s - best.time_s,
      };
    }),
});

dash.calc('race_years', {
  title: 'Compétitions par année',
  description: 'Pour chaque année depuis la première compétition : nombre de compétitions, kilomètres courus en compétition (distance officielle), records personnels battus, et compétitions courues avant le même jour de l’année que la dernière sortie enregistrée (pour comparer l’année en cours aux précédentes).',
  inputs: ['race_results', 'runs'],
  fn: (race_results, runs) => {
    if (!race_results.length) return [];
    const asOf = runs.reduce((a, r) => (r.date > a ? r.date : a), race_results[race_results.length - 1].date);
    const md = asOf.slice(5);
    const first = Math.min(...race_results.map((r) => r.year));
    const last = Math.max(Number(asOf.slice(0, 4)), ...race_results.map((r) => r.year));
    const out = [];
    for (let year = first; year <= last; year += 1) {
      const rs = race_results.filter((r) => r.year === year);
      out.push({
        year,
        races: rs.length,
        km: rs.reduce((s, r) => s + r.km, 0),
        prs: rs.filter((r) => r.pr).length,
        ytd_races: rs.filter((r) => r.date.slice(5) <= md).length,
        as_of: asOf,
      });
    }
    return out;
  },
});

dash.calc('race_mix', {
  title: 'Compétitions par année et par distance',
  description: 'Nombre de compétitions, part de l’année, kilomètres et records personnels pour chaque année et chaque distance ; relais et courses hors catégorie regroupés dans « Relais et autres ».',
  inputs: ['race_results'],
  fn: (race_results) => {
    const order = ['10 km', 'Semi', '20 km', 'Marathon', 'Paris-Versailles', 'Trail', 'Relais et autres'];
    const groupOf = (c) => (order.includes(c) ? c : 'Relais et autres');
    const years = [...new Set(race_results.map((r) => r.year))].sort((a, b) => a - b);
    const out = [];
    years.forEach((year) => {
      const ry = race_results.filter((r) => r.year === year);
      order.forEach((category, cat_i) => {
        const rs = ry.filter((r) => groupOf(r.category) === category);
        if (!rs.length) return;
        out.push({
          year, category, cat_i, races: rs.length, share: rs.length / ry.length,
          km: rs.reduce((s, r) => s + r.km, 0), prs: rs.filter((r) => r.pr).length,
        });
      });
    });
    return out;
  },
});

dash.calc('race_cats', {
  title: 'Compétitions par distance',
  description: 'Une ligne par distance : nombre de compétitions chaque année (colonnes yAAAA), au total et part du total ; relais et courses hors catégorie regroupés dans « Relais et autres ».',
  inputs: ['race_results'],
  fn: (race_results) => {
    if (!race_results.length) return [];
    const order = ['10 km', 'Semi', '20 km', 'Marathon', 'Paris-Versailles', 'Trail', 'Relais et autres'];
    const groupOf = (c) => (order.includes(c) ? c : 'Relais et autres');
    const first = Math.min(...race_results.map((r) => r.year));
    const last = Math.max(...race_results.map((r) => r.year));
    return order.map((category, cat_i) => {
      const rs = race_results.filter((r) => groupOf(r.category) === category);
      const row = { category, cat_i };
      for (let year = first; year <= last; year += 1) row[`y${year}`] = rs.filter((r) => r.year === year).length;
      row.races = rs.length;
      row.share = rs.length / race_results.length;
      return row;
    }).filter((r) => r.races > 0);
  },
});

dash.calc('race_summary', {
  title: 'Compétitions en bref',
  description: 'Nombre total de compétitions et de records personnels, année la plus chargée, année en cours comparée à la précédente au même jour de l’année, et distance la plus courue.',
  inputs: ['race_years', 'race_cats'],
  fn: (race_years, race_cats) => {
    const done = race_years.filter((r) => r.races > 0);
    if (!done.length || !race_cats.length) return [];
    const busiest = done.reduce((a, r) => (r.races >= a.races ? r : a));
    const cur = race_years[race_years.length - 1];
    const prev = race_years.find((r) => r.year === cur.year - 1) || null;
    const top = race_cats.reduce((a, r) => (r.races > a.races ? r : a));
    return [{
      races: race_years.reduce((s, r) => s + r.races, 0),
      prs: race_years.reduce((s, r) => s + r.prs, 0),
      first_year: done[0].year,
      busiest_year: busiest.year,
      busiest_races: busiest.races,
      cur_year: cur.year,
      cur_races: cur.races,
      as_of: cur.as_of,
      prev_year: prev ? prev.year : null,
      prev_ytd_races: prev ? prev.ytd_races : null,
      top_category: top.category,
      top_races: top.races,
      top_share: top.share,
    }];
  },
});

dash.calc('hours', {
  title: 'Heure de départ',
  description: 'Sorties et km selon l’heure de départ (heure locale de la sortie).',
  inputs: ['runs'],
  fn: (runs) => Array.from({ length: 24 }, (_, hour) => {
    const rs = runs.filter((r) => r.hour === hour);
    return { hour, runs: rs.length, km: rs.reduce((s, r) => s + r.km, 0) };
  }),
});

dash.calc('weekdays', {
  title: 'Jour de la semaine',
  description: 'Sorties et km selon le jour de la semaine.',
  inputs: ['runs'],
  fn: (runs) => ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map((day, dow) => {
    const rs = runs.filter((r) => r.dow === dow);
    return { dow, day, runs: rs.length, km: rs.reduce((s, r) => s + r.km, 0), share_runs: rs.length / runs.length };
  }),
});

dash.calc('cadence', {
  title: 'Cadence par mois',
  description: 'Cadence moyenne en pas par minute (moyenne pondérée par le temps en mouvement) des sorties où la montre l’a mesurée.',
  inputs: ['runs'],
  fn: (runs) => {
    const rs = runs.filter((r) => r.spm);
    return [...new Set(rs.map((r) => r.month))].sort().map((month) => {
      const m = rs.filter((r) => r.month === month);
      const t = m.reduce((s, r) => s + r.moving_s, 0);
      return { month, spm: m.reduce((s, r) => s + r.spm * r.moving_s, 0) / t, runs: m.length };
    });
  },
});

dash.calc('countries', {
  title: 'Pays',
  description: 'Sorties et km par pays (d’après le lieu de départ de chaque sortie).',
  inputs: ['runs'],
  fn: (runs) => [...new Set(runs.map((r) => r.country).filter(Boolean))].map((country) => {
    const rs = runs.filter((r) => r.country === country);
    return { country, runs: rs.length, km: rs.reduce((s, r) => s + r.km, 0) };
  }).sort((a, b) => b.runs - a.runs),
});

dash.calc('cities', {
  title: 'Villes les plus courues',
  description: 'Les 10 villes avec le plus de sorties (d’après le lieu de départ de chaque sortie).',
  inputs: ['runs'],
  fn: (runs) => [...new Set(runs.filter((r) => r.city).map((r) => `${r.city}|${r.country}`))].map((key) => {
    const [city, country] = key.split('|');
    const rs = runs.filter((r) => r.city === city && r.country === country);
    return { city, country, runs: rs.length, km: rs.reduce((s, r) => s + r.km, 0) };
  }).sort((a, b) => b.runs - a.runs || b.km - a.km).slice(0, 10),
});

dash.calc('streaks', {
  title: 'Séries et coupures',
  description: 'Plus longue série de jours consécutifs avec au moins une sortie, et plus longue période sans courir depuis le 1er janvier 2024 (début de l’entraînement structuré).',
  inputs: ['runs'],
  fn: (runs) => {
    const days = [...new Set(runs.map((r) => r.day))].sort((a, b) => a - b);
    const since = Date.UTC(2024, 0, 1) / 864e5;
    let best = { len: 1, from: days[0], to: days[0] };
    let cur = { len: 1, from: days[0] };
    let gap = { len: 0, from: null, to: null };
    for (let i = 1; i < days.length; i++) {
      const step = days[i] - days[i - 1];
      cur = step === 1 ? { len: cur.len + 1, from: cur.from } : { len: 1, from: days[i] };
      if (cur.len > best.len) best = { len: cur.len, from: cur.from, to: days[i] };
      if (days[i - 1] >= since && step - 1 > gap.len) gap = { len: step - 1, from: days[i - 1] + 1, to: days[i] - 1 };
    }
    const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
    return [
      { kind: 'serie', days: best.len, from: iso(best.from), to: iso(best.to) },
      { kind: 'coupure', days: gap.len, from: iso(gap.from), to: iso(gap.to) },
    ];
  },
});

dash.calc('cross', {
  title: 'Autres sports',
  description: 'Heures et séances par année pour les activités hors course à pied (musculation, tennis et padel, ski, natation et marche).',
  inputs: ['activities'],
  fn: (activities) => {
    const label = { WeightTraining: 'Musculation', Tennis: 'Tennis & padel', AlpineSki: 'Ski', Swim: 'Natation & marche', Walk: 'Natation & marche' };
    const rows = new Map();
    activities.filter((a) => label[a.sport_type]).forEach((a) => {
      const year = Number(String(a.start_local).slice(0, 4));
      const key = `${year}|${label[a.sport_type]}`;
      const r = rows.get(key) || { year, sport: label[a.sport_type], sessions: 0, hours: 0 };
      r.sessions += 1;
      r.hours += Number(a.moving_time) / 3600;
      rows.set(key, r);
    });
    return [...rows.values()].sort((a, b) => a.year - b.year || (a.sport < b.sport ? -1 : 1));
  },
});

dash.calc('kudos_top', {
  title: 'Sorties les plus appréciées',
  description: 'Les 5 sorties qui ont reçu le plus de kudos.',
  inputs: ['runs'],
  fn: (runs) => [...runs].sort((a, b) => b.kudos - a.kudos || b.km - a.km).slice(0, 5)
    .map((r) => ({ id: r.id, date: r.date, name: r.name, km: r.km, kudos: r.kudos })),
});

dash.calc('highlights', {
  title: 'Faits marquants',
  description: 'Meilleure année, meilleur mois et meilleure semaine en km, année en cours comparée à la précédente à date, et dernière compétition.',
  inputs: ['by_year', 'by_month', 'by_week', 'ytd', 'race_results'],
  fn: (by_year, by_month, by_week, ytd, race_results) => {
    const top = (rows) => rows.reduce((a, r) => (r.km > a.km ? r : a));
    const year = top(by_year);
    const month = top(by_month);
    const week = top(by_week);
    const now = ytd[ytd.length - 1];
    const prev = ytd.find((r) => r.year === now.year - 1);
    const race = race_results[race_results.length - 1];
    return [{
      best_year: year.year, best_year_km: year.km, best_month: month.month, best_month_km: month.km,
      best_week: week.week, best_week_km: week.km,
      ytd_year: now.year, ytd_as_of: now.as_of, ytd_km: now.km, ytd_prev_year: prev ? prev.year : null,
      ytd_prev_km: prev ? prev.km : null, ytd_delta: now.vs_prev,
      last_race_event: race.event, last_race_date: race.date, last_race_time_s: race.time_s,
      last_race_category: race.category, last_race_pr: race.pr,
    }];
  },
});
