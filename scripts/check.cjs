// Vérifie un dossier de données : chaque calcul du site doit tourner sans erreur.
//   node scripts/check.cjs [dossier]   (par défaut docs/data)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'docs', 'data'));
const read = (f, dflt) => {
  const p = path.join(dir, f);
  if (dflt !== undefined && !fs.existsSync(p)) return dflt;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const problems = [];

const data = {
  activities: read('activities.json'),
  races: read('races.json'),
  hr_streams: read('hr_streams.json'),
  hr_zones: read('hr_zones.json'),
  meta: read('meta.json'),
  routes: read('routes.json', []),
  laps: read('laps.json', []),
  efforts: read('efforts.json', []),
  goal: read('goal.json', []),
};

// ----- cohérence des fichiers -----
const ids = new Set();
for (const a of data.activities) {
  if (!a.id || ids.has(a.id)) problems.push(`activité en double ou sans id : ${a.id}`);
  ids.add(a.id);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(String(a.start_local))) problems.push(`date invalide : ${a.id}`);
}
const raceIds = new Set();
for (const r of data.races) {
  if (!ids.has(String(r.id))) problems.push(`compétition sans activité : ${r.id}`);
  if (raceIds.has(r.id)) problems.push(`compétition en double : ${r.id}`);
  raceIds.add(r.id);
}
for (const r of data.hr_streams) {
  if (!ids.has(r.id)) { problems.push(`flux cardio sans activité : ${r.id}`); break; }
}
if (data.hr_zones.length !== 5) problems.push('il faut 5 zones cardio');
for (const k of ['routes', 'laps', 'efforts']) {
  const bad = data[k].find((r) => !ids.has(r.id));
  if (bad) problems.push(`${k} : activité inconnue ${bad.id}`);
}
if (data.routes.some((r) => typeof r.p !== 'string' || !r.p)) problems.push('routes : tracé vide');
if (data.laps.some((r) => !(r.d >= 0) || !(r.mt >= 0))) problems.push('laps : tour sans distance ou sans durée');
if (data.efforts.some((r) => !r.e || !(r.s > 0))) problems.push('efforts : effort invalide');

// ----- calculs du site -----
const defs = new Map();
global.dash = { calc: (id, def) => defs.set(id, { inputs: [], ...def }), colors: [] };
for (const f of fs.readdirSync(path.join(root, 'docs', 'assets')).filter((n) => /^calcs.*\.js$/.test(n)).sort()) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'docs', 'assets', f), 'utf8'), { filename: f });
}
const cache = {};
const get = (id) => {
  if (id in data) return structuredClone(data[id]);
  if (!(id in cache)) {
    const d = defs.get(id);
    if (!d) throw new Error(`source inconnue : ${id}`);
    cache[id] = d.fn(...d.inputs.map(get));
    JSON.stringify(cache[id]);
  }
  return structuredClone(cache[id]);
};
const t0 = Date.now();
for (const id of defs.keys()) {
  try {
    get(id);
  } catch (err) {
    problems.push(`calcul « ${id} » : ${err.message}`);
  }
}

if (problems.length) {
  console.error('✗ ' + problems.slice(0, 20).join('\n✗ '));
  process.exit(1);
}
const t = cache.totals[0];
const last = cache.race_results[cache.race_results.length - 1];
const fmt = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? `${h}h${String(m).padStart(2, '0')}` : `${m}`) + `'${String(x).padStart(2, '0')}"`; };
console.log(`✓ ${defs.size} calculs en ${Date.now() - t0} ms · ${t.runs} sorties · ${Math.round(t.km)} km · ${t.races} compétitions · ` +
  `${new Set(data.hr_streams.map((r) => r.id)).size} sorties avec cardio · dernière compétition : ${last ? `${last.date} ${last.event} en ${fmt(last.time_s)}` : '—'}`);
