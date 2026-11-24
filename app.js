/* Hujan: multi-model weather for Malaysia. Plain JS, no build step. */
{
const C = window.HUJAN_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => (v === null || v === undefined || Number.isNaN(v)) ? null : +v;
const r0 = v => v == null ? "–" : Math.round(v);
const r1 = v => v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem("hujan." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("hujan." + k, JSON.stringify(v)); } catch {} }
};

/* ---------- State ---------- */
const S = {
  loc: store.get("loc", null),
  settings: Object.assign({ model: C.defaultModel, waqi: "", proxy: "" }, store.get("settings", {})),
  recent: store.get("recent", []),
  hourMetric: store.get("hourMetric", "temp"),
  modelMetric: "temp",
  data: {},
  view: "forecast"
};
const modelById = id => C.models.find(m => m.id === id) || C.models[0];

/* ---------- Time helpers (all times in Malaysia time) ---------- */
const fmtTime = new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: C.tz });
const fmtHour = new Intl.DateTimeFormat("en-MY", { hour: "numeric", hour12: true, timeZone: C.tz });
const fmtDay = new Intl.DateTimeFormat("en-MY", { weekday: "short", timeZone: C.tz });
const fmtDate = new Intl.DateTimeFormat("en-MY", { weekday: "long", day: "numeric", month: "short", timeZone: C.tz });
// Open-Meteo returns local ISO strings without offset when timezone is set; Malaysia is UTC+8 with no DST.
const parseLocal = s => new Date(s.length <= 10 ? s + "T00:00:00+08:00" : s + ":00+08:00");
const hourLabel = d => fmtHour.format(d).replace(" ", "").toLowerCase();
const timeLabel = d => fmtTime.format(d).replace(" ", "").toLowerCase();

/* ---------- Fetch ---------- */
async function getJSON(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    return await r.json();
  } finally { clearTimeout(t); }
}
const qs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");

const HOURLY = "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,pressure_msl,visibility,cape,is_day";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset,daylight_duration";
const CURRENT = "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,is_day";

function fcUrl(lat, lon, model, extra = {}) {
  return C.endpoints.forecast + "?" + qs(Object.assign({
    latitude: lat, longitude: lon, timezone: C.tz, hourly: HOURLY, daily: DAILY, current: CURRENT,
    forecast_days: 14, wind_speed_unit: "kmh", models: model
  }, extra));
}

// Try a model id, then its alternate names (Open-Meteo has renamed some models).
async function tryModel(m, urlFor) {
  const names = [m.id, ...(m.alt || [])];
  let err;
  for (const n of names) {
    try { return await getJSON(urlFor(n)); } catch (e) { err = e; if (!/^400/.test(e.message)) break; }
  }
  throw err;
}
// Cache wrapper for slow-changing or rate-limited sources (data.gov.my allows 4 requests/minute).
async function cached(key, ms, fn) {
  const c = store.get("c." + key, null);
  if (c && Date.now() - c.t < ms) return c.v;
  try { const v = await fn(); store.set("c." + key, { t: Date.now(), v }); return v; }
  catch (e) { if (c) return c.v; throw e; }
}

async function loadForecast(lat, lon) {
  // A: headline model. B: Open-Meteo best match, used for the 15-minute series and to fill gaps.
  const [a, b] = await Promise.allSettled([
    tryModel(modelById(S.settings.model), n => fcUrl(lat, lon, n)),
    getJSON(fcUrl(lat, lon, undefined, { minutely_15: "precipitation,rain,weather_code", forecast_minutely_15: 12, past_minutely_15: 0 }))
  ]);
  if (a.status !== "fulfilled" && b.status !== "fulfilled") throw a.reason;
  const A = a.status === "fulfilled" ? a.value : null, B = b.status === "fulfilled" ? b.value : null;
  const base = A || B;
  const filled = { hourly: {}, daily: {}, current: {}, filledFrom: new Set() };
  for (const blk of ["hourly", "daily"]) {
    const tA = A?.[blk]?.time || [], tB = B?.[blk]?.time || [];
    const time = tA.length >= tB.length ? tA : tB;
    filled[blk].time = time;
    const idxA = new Map(tA.map((t, i) => [t, i])), idxB = new Map(tB.map((t, i) => [t, i]));
    for (const k of Object.keys(base[blk] || {}).concat(Object.keys(B?.[blk] || {}))) {
      if (k === "time" || filled[blk][k]) continue;
      filled[blk][k] = time.map(t => {
        const va = idxA.has(t) ? A[blk][k]?.[idxA.get(t)] : null;
        if (va != null) return va;
        const vb = idxB.has(t) ? B?.[blk]?.[k]?.[idxB.get(t)] : null;
        if (vb != null && A) filled.filledFrom.add(blk + ":" + k);
        return vb ?? null;
      });
    }
  }
  for (const k of Object.keys(Object.assign({}, B?.current, A?.current))) filled.current[k] = A?.current?.[k] ?? B?.current?.[k];
  filled.minutely = B?.minutely_15 || null;
  filled.headlineOk = !!A;
  return filled;
}

async function loadModels(lat, lon) {
  // One request per model, so a renamed or failing model doesn't break the others.
  const res = await Promise.allSettled(C.models.map(m => tryModel(m, n => C.endpoints.forecast + "?" + qs({
    latitude: lat, longitude: lon, timezone: C.tz, forecast_days: 7, models: n,
    hourly: "temperature_2m,precipitation,relative_humidity_2m,wind_speed_10m,surface_pressure,shortwave_radiation,direct_radiation", daily: "precipitation_sum,temperature_2m_max,temperature_2m_min"
  }))));
  const out = {};
  C.models.forEach((m, i) => { if (res[i].status === "fulfilled") out[m.id] = res[i].value; });
  if (!Object.keys(out).length) throw new Error("no model responded");
  return out;
}

async function loadEnsemble(lat, lon) {
  return tryModel({ id: C.ensembleModel, alt: C.ensembleAlt }, n => C.endpoints.ensemble + "?" + qs({
    latitude: lat, longitude: lon, timezone: C.tz, forecast_days: 14, models: n,
    hourly: "temperature_2m,precipitation"
  }));
}

/* MET Malaysia official text forecast (Malay), with common phrases translated. */
const BM = [
  [/^tiada hujan$/i, "No rain"], [/^berjerebu$/i, "Hazy"], [/^cerah$/i, "Fair"],
  [/^hujan di beberapa tempat$/i, "Rain in a few places"], [/^hujan di satu dua tempat$/i, "Isolated rain"],
  [/^hujan di kebanyakan tempat$/i, "Rain in most places"], [/^hujan menyeluruh$/i, "Widespread rain"],
  [/^ribut petir di beberapa tempat$/i, "Storms in a few places"], [/^ribut petir di satu dua tempat$/i, "Isolated storms"],
  [/^ribut petir di kebanyakan tempat$/i, "Storms in most places"], [/^ribut petir$/i, "Storms"],
  [/^hujan$/i, "Rain"], [/^berangin$/i, "Windy"]
];
const bmToEn = s => { const t = String(s || "").trim(); const hit = BM.find(([re]) => re.test(t)); return hit ? hit[1] : null; };
async function loadMetForecast(loc) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: C.tz });
  const find = async name => {
    const d = await getJSON(C.endpoints.metForecast + "?" + qs({ contains: name + "@location__location_name", limit: 100 }), 10000);
    const arr = (Array.isArray(d) ? d : (d.data || [])).filter(r => r.date >= today);
    if (!arr.length) return null;
    // Prefer an exact name match, then town, district, state.
    const rank = r => (r.location.location_name.toLowerCase() === name.toLowerCase() ? 0 : 10) + ({ Tn: 0, Ds: 1, St: 2 }[r.location.location_id.slice(0, 2)] ?? 3);
    const best = arr.slice().sort((a, b) => rank(a) - rank(b))[0];
    return { place: best.location.location_name, days: arr.filter(r => r.location.location_id === best.location.location_id).sort((a, b) => a.date.localeCompare(b.date)) };
  };
  const names = [...new Set([loc.name, (loc.name || "").split(" ")[0], loc.admin].filter(n => n && n.length > 2))];
  return cached("met." + names.join("|") + "." + today, 60 * 60e3, async () => {
    for (const n of names) { const r = await find(n); if (r) return r; }
    return null;
  });
}

async function loadAir(lat, lon) {
  return getJSON(C.endpoints.air + "?" + qs({
    latitude: lat, longitude: lon, timezone: C.tz, forecast_days: 3,
    current: "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,carbon_monoxide",
    hourly: "pm2_5,us_aqi"
  }));
}

async function loadWarnings() {
  return cached("warn", 10 * 60e3, async () => {
    const d = await getJSON(C.endpoints.warnings + "?" + qs({ limit: 50 }));
    return Array.isArray(d) ? d : (d.data || []);
  });
}

/* ---------- Ensemble statistics (3-hour blocks, per-run totals) ---------- */
const pct = (arr, q) => { const a = arr.filter(v => v != null).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * q; const lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
function ensembleStats(ens) {
  if (!ens?.hourly) return null;
  const h = ens.hourly, time = h.time;
  const memKeys = p => Object.keys(h).filter(k => k === p || k.startsWith(p + "_member"));
  const tK = memKeys("temperature_2m"), pK = memKeys("precipitation");
  const blocks = [];
  for (let i = 0; i < time.length; i += 3) {
    const js = [i, i + 1, i + 2].filter(j => j < time.length);
    const tot = pK.map(k => { const v = js.map(j => h[k][j]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; }).filter(v => v != null);
    const tv = tK.map(k => { const v = js.map(j => h[k][j]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; });
    blocks.push({
      t: parseLocal(time[i]), keys: js.map(j => time[j]),
      prob: tot.length ? tot.filter(v => v >= C.rainBlockMm).length / tot.length : null,
      heavy: tot.length ? tot.filter(v => v >= C.heavyBlockMm).length / tot.length : null,
      tP10: pct(tv, .1), tP50: pct(tv, .5), tP90: pct(tv, .9)
    });
  }
  const byHour = {};
  for (const b of blocks) for (const k of b.keys) byHour[k] = b;
  const byDay = {};
  time.forEach((t, i) => { const d = t.slice(0, 10); (byDay[d] ||= pK.map(() => 0)); pK.forEach((k, m) => byDay[d][m] += h[k][i] || 0); });
  // Rain still to come today, per run. Each hourly value covers the hour ending at its timestamp.
  const now = Date.now(), dayOf = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: C.tz }), today = dayOf(now);
  const restIdx = time.map((t, i) => { const e = parseLocal(t).getTime(); return e > now && dayOf(e - 36e5) === today ? i : -1; }).filter(i => i >= 0);
  const rest = pK.map(k => restIdx.reduce((s, i) => s + (h[k][i] || 0), 0));
  const daily = {};
  for (const [d, arr] of Object.entries(byDay)) daily[d] = { p10: pct(arr, .1), p50: pct(arr, .5), p90: pct(arr, .9), spread: pct(arr, .9) - pct(arr, .1), prob: arr.filter(v => v >= C.rainDayMm).length / arr.length };
  if (daily[today] && rest.length && restIdx.length) daily[today].probRest = rest.filter(v => v >= C.rainDayMm).length / rest.length;
  return { blocks, byHour, daily, members: pK.length };
}

/* ---------- Weather classification ---------- */
function rateClass(mmh) {
  if (mmh == null) return null;
  if (mmh >= 50) return { k: "violent", name: "Violent rain", c: "#1a4fa8" };
  if (mmh >= 7.6) return { k: "heavy", name: "Heavy rain", c: "#1f6fd1" };
  if (mmh >= 2.5) return { k: "mod", name: "Rain", c: "#4aa3ff" };
  if (mmh >= 0.2) return { k: "light", name: "Light rain", c: "#8cc8ff" };
  return null;
}
function condition(code, mmh, cloud, isDay = 1) {
  if (code >= 95) return { k: "storm", name: mmh >= 7.6 ? "Heavy thunderstorm" : "Thunderstorm", c: "#9c7cff", icon: "storm" };
  const rc = rateClass(mmh);
  if (rc) return Object.assign({ icon: rc.k === "light" ? "drizzle" : "rain" }, rc);
  if (code === 45 || code === 48) return { k: "fog", name: "Haze or fog", c: "#727a88", icon: "fog" };
  if (cloud == null) cloud = code <= 1 ? 10 : code === 2 ? 45 : 90;
  if (cloud < 25) return { k: "clear", name: isDay ? "Clear" : "Clear", c: "#d9dee7", icon: isDay ? "sun" : "moon" };
  if (cloud < 60) return { k: "partly", name: "Partly cloudy", c: "#a7afbd", icon: isDay ? "partly" : "partlyNight" };
  if (cloud < 85) return { k: "mostly", name: "Mostly cloudy", c: "#7d8696", icon: "cloud" };
  return { k: "overcast", name: "Overcast", c: "#5a6272", icon: "cloud" };
}
function stormRisk(code, cape, prob) {
  if (code >= 95) return { lvl: 3, name: "Likely" };
  if (cape == null) return { lvl: 0, name: "–" };
  const p = prob ?? 50;
  if (cape >= 2000 && p >= 40) return { lvl: 2, name: "Moderate" };
  if (cape >= 1000 && p >= 30) return { lvl: 1, name: "Low" };
  return { lvl: 0, name: "Minimal" };
}
const compass = d => d == null ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
const uvName = u => u == null ? "" : u < 3 ? "Low" : u < 6 ? "Moderate" : u < 8 ? "High" : u < 11 ? "Very high" : "Extreme";

/* ---------- Icons (original line icons) ---------- */
const IC = (() => {
  const sun = '<circle cx="32" cy="32" r="11" fill="#ffd23f"/><g stroke="#ffd23f" stroke-width="3.5" stroke-linecap="round">' +
    [0, 45, 90, 135, 180, 225, 270, 315].map(a => { const r = a * Math.PI / 180; return `<line x1="${32 + Math.cos(r) * 17}" y1="${32 + Math.sin(r) * 17}" x2="${32 + Math.cos(r) * 23}" y2="${32 + Math.sin(r) * 23}"/>`; }).join("") + "</g>";
  const moon = '<path d="M40 14a18 18 0 1 0 10 30A16 16 0 0 1 40 14z" fill="#cfd6e3"/>';
  const cloud = (x = 0, y = 0, f = "#c3cad6") => `<path transform="translate(${x} ${y})" d="M20 46h26a10 10 0 0 0 1-20 14 14 0 0 0-27-2 11 11 0 0 0 0 22z" fill="${f}"/>`;
  const drops = (n, c = "#4aa3ff") => Array.from({ length: n }, (_, i) => `<line x1="${22 + i * 9}" y1="${50}" x2="${19 + i * 9}" y2="${58}" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`).join("");
  const s = b => `<svg viewBox="0 0 64 64" aria-hidden="true">${b}</svg>`;
  return {
    sun: s(sun), moon: s(moon),
    partly: s(`<g transform="translate(-8 -8) scale(.85)">${sun}</g>` + cloud(2, 4)),
    partlyNight: s(`<g transform="translate(-6 -8) scale(.8)">${moon}</g>` + cloud(2, 4)),
    cloud: s(cloud(0, 0, "#aab2c0")),
    drizzle: s(cloud(0, -6) + drops(3, "#8cc8ff")),
    rain: s(cloud(0, -6, "#9aa3b2") + drops(4)),
    storm: s(cloud(0, -8, "#8b94a3") + '<path d="M34 40l-8 12h7l-4 10 12-15h-7l5-7z" fill="#ffd23f"/>'),
    fog: s(cloud(0, -8, "#9aa3b2") + '<g stroke="#9aa3b2" stroke-width="3.5" stroke-linecap="round"><line x1="14" y1="50" x2="50" y2="50"/><line x1="20" y1="57" x2="44" y2="57"/></g>'),
    sunrise: s('<path d="M14 44a18 18 0 0 1 36 0z" fill="#ffd23f"/><line x1="8" y1="48" x2="56" y2="48" stroke="#9aa3b2" stroke-width="3" stroke-linecap="round"/><path d="M32 8v14m-6-6 6-6 6 6" stroke="#ffd23f" stroke-width="3" fill="none" stroke-linecap="round"/>'),
    sunset: s('<path d="M14 44a18 18 0 0 1 36 0z" fill="#ff8a4c"/><line x1="8" y1="48" x2="56" y2="48" stroke="#9aa3b2" stroke-width="3" stroke-linecap="round"/><path d="M32 22V8m-6 8 6 6 6-6" stroke="#ff8a4c" stroke-width="3" fill="none" stroke-linecap="round"/>'),
    uv: s(sun.replace(/#ffd23f/g, "#ff8a4c"))
  };
})();
function moonIcon(phase) {
  // phase 0..1 (0 new, .5 full). Draw lit part with two arcs.
  const r = 18, cx = 32, cy = 32, k = Math.cos(phase * 2 * Math.PI); // 1 new, -1 full
  const waxing = phase < .5, rx = Math.abs(k) * r;
  const outer = waxing ? 1 : 0, inner = (k > 0) === waxing ? 0 : 1;
  const d = `M${cx} ${cy - r} A${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A${rx} ${r} 0 0 ${inner} ${cx} ${cy - r}z`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a2f3b"/><path d="${d}" fill="#e3e8f0"/></svg>`;
}
function moonInfo(date) {
  const syn = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date - ref) / 864e5) % syn + syn) % syn, phase = age / syn;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return { phase, illum, name: names[Math.round(phase * 8) % 8], age };
}

/* ---------- Text summaries (Dark Sky style) ---------- */
function nextTwoHours(D) {
  const m = D.minutely;
  if (!m?.time) return null;
  const now = Date.now();
  const pts = m.time.map((t, i) => ({ t: parseLocal(t), mmh: (m.precipitation?.[i] ?? 0) * 4 })).filter(p => p.t.getTime() > now - 15 * 60e3).slice(0, 9);
  return pts.length ? pts : null;
}
function summarise(D, pts) {
  const cur = D.current, nowRate = (cur.precipitation ?? 0);
  const wet = p => p.mmh >= 0.2;
  const minsTo = t => Math.max(0, Math.round((t - Date.now()) / 60e3 / 5) * 5);
  if (pts) {
    const rainingNow = nowRate >= 0.1 || wet(pts[0]);
    if (rainingNow) {
      const stop = pts.findIndex(p => !wet(p));
      const kind = (rateClass(Math.max(nowRate, pts[0].mmh)) || { name: "Light rain" }).name;
      if (stop > 0) return `${kind} stopping in about ${minsTo(pts[stop].t)} min.`;
      return `${kind} for at least the next 2 hours.`;
    }
    const start = pts.findIndex(wet);
    if (start >= 0) {
      const peak = Math.max(...pts.slice(start).map(p => p.mmh));
      const kind = (rateClass(peak) || { name: "Light rain" }).name;
      return `${kind} possible in about ${Math.max(5, minsTo(pts[start].t))} min.`;
    }
  }
  // Fall back to the hourly forecast for the rest of today
  const H = D.hourly, now = Date.now();
  for (let i = 0; i < H.time.length; i++) {
    const t = parseLocal(H.time[i]);
    if (t < now - 36e5) continue;
    if (t - now > 12 * 36e5) break;
    const c = condition(H.weather_code[i], H.precipitation[i], H.cloud_cover[i]);
    if (c.k === "storm" || (H.precipitation[i] ?? 0) >= 0.5) {
      return `No rain in the next 2 hours. ${c.k === "storm" ? "Thunderstorms" : (rateClass(H.precipitation[i])?.name || "Rain")} likely from ${hourLabel(t)}.`;
    }
  }
  return "No rain expected in the next 12 hours.";
}
// Daily rain chance with a label that says what it counts. Without ensemble data, Open-Meteo's any-rain figure is used and named as such.
function dayRain(D, i) {
  const e = S.data.ens?.daily?.[D.daily.time[i]];
  if (e?.probRest != null) return { v: e.probRest * 100, label: `${C.rainDayMm} mm+ rest of today` };
  if (e?.prob != null) return { v: e.prob * 100, label: `Chance of ${C.rainDayMm} mm+` };
  return { v: D.daily.precipitation_probability_max?.[i] ?? null, label: "Chance of any rain" };
}
function daySummary(D, i, ens) {
  const d = D.daily, H = D.hourly;
  const dayKey = d.time[i];
  const idx = H.time.map((t, j) => t.startsWith(dayKey) ? j : -1).filter(j => j >= 0);
  if (!idx.length) return "";
  const part = (a, b) => idx.filter(j => { const h = +H.time[j].slice(11, 13); return h >= a && h < b; });
  const describe = js => {
    if (!js.length) return null;
    const storm = js.some(j => H.weather_code[j] >= 95);
    const mm = js.reduce((s, j) => s + (H.precipitation[j] || 0), 0);
    const cloud = js.reduce((s, j) => s + (H.cloud_cover[j] ?? 50), 0) / js.length;
    if (storm) return "thunderstorms";
    if (mm >= 5) return "heavy rain";
    if (mm >= 1) return "rain";
    if (mm >= 0.2) return "light showers";
    return cloud < 30 ? "clear" : cloud < 70 ? "partly cloudy" : "cloudy";
  };
  const m = describe(part(6, 12)), a = describe(part(12, 18)), e = describe(part(18, 24));
  const bits = [];
  if (m) bits.push(m + " in the morning");
  if (a) bits.push(a + " in the afternoon");
  if (e) bits.push(e + " in the evening");
  let s = bits.join(", ");
  s = s.charAt(0).toUpperCase() + s.slice(1) + ".";
  return s;
}

/* ---------- Chart helpers ---------- */
function onSize(svg, draw) {
  const ro = new ResizeObserver(() => draw(svg.clientWidth, svg.clientHeight));
  ro.observe(svg);
  draw(svg.clientWidth, svg.clientHeight);
}
const path = pts => pts.filter(p => p[1] != null).map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");

/* ---------- Render: Forecast ---------- */
function renderNow(D) {
  const c = D.current;
  let cond = condition(c.weather_code, c.precipitation, c.cloud_cover, c.is_day);
  // Radar beats the model for "right now": if radar is dry here, don't show model rain.
  const rNow = (S.data.radarTrace || []).filter(p => !p.nowcast && p.mmh != null).pop();
  if (rNow && rNow.mmh < 0.5 && (cond.k === "storm" || rateClass(c.precipitation))) cond = condition(Math.min(c.weather_code, 3), 0, Math.max(c.cloud_cover ?? 90, 70), c.is_day);
  if (rNow && rNow.mmh >= 0.5 && !rateClass(c.precipitation) && cond.k !== "storm") cond = condition(c.weather_code, rNow.mmh, 100, c.is_day);
  $("#nowIcon").innerHTML = IC[cond.icon];
  $("#nowTemp").textContent = r0(c.temperature_2m) + "°";
  $("#nowCond").textContent = `${cond.name} · Feels like ${r0(c.apparent_temperature)}°`;
  const di = 0, d = D.daily;
  const uvNow = (() => { const H = D.hourly; const i = H.time.findIndex(t => parseLocal(t) > Date.now() - 36e5); return H.uv_index?.[i]; })();
  const cells = [
    [r0(d.temperature_2m_max[di]) + "° / " + r0(d.temperature_2m_min[di]) + "°", "High / low"],
    [r0(c.relative_humidity_2m) + "%", "Humidity"],
    [r0(c.dew_point_2m) + "°", "Dew point"],
    [r0(c.wind_speed_10m) + " " + compass(c.wind_direction_10m), "Wind km/h"],
    [r0(c.wind_gusts_10m), "Gusts km/h"],
    [r0(uvNow) + " " + uvName(uvNow), "UV now"],
    [r0(c.pressure_msl), "Pressure hPa"],
    (({ v, label }) => [v != null ? r0(v) + "%" : "–", label])(dayRain(D, di)),
    [r1(d.precipitation_sum?.[di]) + " mm", "Rain today"]
  ];
  $("#nowGrid").innerHTML = cells.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
}

function renderNext(D) {
  const pts = nextTwoHours(D);
  const svg = $("#nextChart");
  const radar = (S.data.radarTrace || []).filter(p => p.mmh != null && p.t.getTime() > Date.now() - 15 * 60e3);
  let summary = summarise(D, pts);
  if (radar.length) {
    const nowR = radar[0], wet = p => p.mmh >= 0.5;
    const arrive = radar.find(p => p.nowcast && wet(p));
    const dry = radar.find(p => p.nowcast && !wet(p));
    if (wet(nowR)) summary = `${rateClass(nowR.mmh)?.name || "Rain"} at your location now (radar)${dry ? `, easing in about ${Math.max(5, Math.round((dry.t - Date.now()) / 3e5) * 5)} min` : ""}.`;
    else if (arrive) summary = `Rain approaching on radar: about ${Math.max(5, Math.round((arrive.t - Date.now()) / 3e5) * 5)} min away.`;
    else { const later = pts && pts.find(p => p.mmh >= 0.2 && p.t > radar[radar.length - 1].t); summary = "Dry on radar for the next hour." + (later ? ` The model expects rain from around ${timeLabel(later.t)}.` : ""); }
  }
  $("#summary").textContent = summary;
  $("#nextSource").textContent = radar.length ? "Radar nowcast + model" : "15-min model estimate";
  if (!pts) { svg.innerHTML = ""; $("#nextSummary").textContent = "15-minute data isn't available for this location right now."; return; }
  const peak = Math.max(...pts.map(p => p.mmh));
  $("#nextSummary").textContent = (peak < 0.2 ? "Model: no rain expected." : `Model peak ${r1(peak)} mm/h (${rateClass(peak).name.toLowerCase()}).`) + (radar.length ? " Dotted line: radar nowcast at your location (approximate intensity)." : " Blue area is a model estimate; check Radar for what's falling now.");
  onSize(svg, (W, H) => {
    if (!W) return;
    const pad = { l: 46, r: 8, t: 8, b: 22 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const levels = [[0.2, "Light"], [2.5, "Mod"], [7.6, "Heavy"]];
    // log-ish scale so light rain is visible
    const y = v => pad.t + h - clamp(Math.log10(1 + v * 2) / Math.log10(1 + 30 * 2), 0, 1) * h;
    const t0 = pts[0].t.getTime(), t1 = pts[pts.length - 1].t.getTime();
    const x = t => pad.l + (t - t0) / (t1 - t0 || 1) * w;
    let g = levels.map(([v, n]) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${n}</text>`).join("");
    const line = pts.map(p => [x(p.t.getTime()), y(p.mmh)]);
    const area = path(line) + `L${x(t1)} ${pad.t + h}L${x(t0)} ${pad.t + h}z`;
    g += `<defs><linearGradient id="rg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4aa3ff" stop-opacity=".75"/><stop offset="1" stop-color="#4aa3ff" stop-opacity=".08"/></linearGradient></defs>`;
    g += `<path d="${area}" fill="url(#rg)"/><path d="${path(line)}" fill="none" stroke="#4aa3ff" stroke-width="2.5"/>`;
    if (radar.length) {
      const rp = radar.filter(p => p.t.getTime() <= t1).map(p => [clamp(x(p.t.getTime()), pad.l, W - pad.r), y(p.mmh)]);
      g += `<path d="${path(rp)}" fill="none" stroke="#e3e8f0" stroke-width="2" stroke-dasharray="2 5" stroke-linecap="round"/>` + rp.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#e3e8f0"/>`).join("");
    }
    const ticks = W < 420 ? [0, 60, 120] : [0, 30, 60, 90, 120];
    g += ticks.map(m => { const tx = x(t0 + m * 60e3); return tx <= W - pad.r + 1 ? `<text class="axis" x="${tx}" y="${H - 4}" text-anchor="${m === 0 ? "start" : m === 120 ? "end" : "middle"}">${m === 0 ? "Now" : m + "m"}</text>` : ""; }).join("");
    svg.innerHTML = g;
  });
}

const HOUR_METRICS = {
  temp: { name: "Temp", get: (H, i) => H.temperature_2m[i], fmt: v => r0(v) + "°", color: v => tempColor(v), scale: "range" },
  feels: { name: "Feels like", get: (H, i) => H.apparent_temperature[i], fmt: v => r0(v) + "°", color: v => tempColor(v), scale: "range" },
  wbgt: { name: "WBGT (est.)", get: (H, i) => S.data.wbgt?.byHour?.[H.time[i]]?.mid, fmt: (v, H, i) => wbgtRange(S.data.wbgt.byHour[H.time[i]]), color: v => v >= 33 ? "#ff5a5a" : v >= 31 ? "#ff8a4c" : "#3ccf8e", scale: [22, 36] },
  prob: { name: "Rain chance", get: (H, i) => { const b = S.data.ens?.byHour?.[H.time[i]]; return b?.prob != null ? b.prob * 100 : H.precipitation_probability?.[i]; }, fmt: v => r0(v) + "%", color: () => "#4aa3ff", scale: [0, 100] },
  rain: { name: "Rain mm", get: (H, i) => H.precipitation[i], fmt: v => r1(v), color: () => "#4aa3ff", scale: [0, 10] },
  storm: { name: "Storm risk", get: (H, i) => H.cape?.[i], fmt: (v, H, i) => stormRisk(H.weather_code[i], v, H.precipitation_probability?.[i]).name, color: () => "#9c7cff", scale: [0, 3000] },
  wind: { name: "Wind", get: (H, i) => H.wind_speed_10m[i], fmt: (v, H, i) => r0(v) + " " + compass(H.wind_direction_10m[i]), color: () => "#9aa3b2", scale: [0, 40] },
  gust: { name: "Gusts", get: (H, i) => H.wind_gusts_10m[i], fmt: v => r0(v) + " km/h", color: () => "#c3cad6", scale: [0, 70] },
  hum: { name: "Humidity", get: (H, i) => H.relative_humidity_2m[i], fmt: v => r0(v) + "%", color: () => "#6fb7ff", scale: [40, 100] },
  dew: { name: "Dew point", get: (H, i) => H.dew_point_2m[i], fmt: v => r0(v) + "°", color: () => "#6fb7ff", scale: [18, 28] },
  uv: { name: "UV", get: (H, i) => H.uv_index[i], fmt: v => r0(v), color: v => v >= 8 ? "#ff5a5a" : v >= 6 ? "#ff8a4c" : v >= 3 ? "#ffd23f" : "#3ccf8e", scale: [0, 12] },
  cloud: { name: "Cloud", get: (H, i) => H.cloud_cover[i], fmt: v => r0(v) + "%", color: () => "#9aa3b2", scale: [0, 100] },
  press: { name: "Pressure", get: (H, i) => H.pressure_msl[i], fmt: v => r0(v), color: () => "#9aa3b2", scale: [1004, 1014] }
};
function tempColor(v) {
  if (v == null) return "#9aa3b2";
  const t = clamp((v - 22) / 12, 0, 1);
  const a = [111, 183, 255], b = [255, 138, 76];
  return `rgb(${a.map((c, i) => Math.round(c + (b[i] - c) * t)).join(",")})`;
}
/* ---------- Estimated WBGT: range across models ---------- */
function wbgtStats(models, loc) {
  if (!models || !window.HUJAN_WBGT) return null;
  const W = C.wbgt, per = {};
  for (const id of W.models) if (models[id]?.hourly) {
    per[id] = new Map(window.HUJAN_WBGT.series(models[id].hourly, loc.lat, loc.lon, parseLocal, W.windFactor).filter(p => p.v != null).map(p => [p.t, p.v]));
  }
  const times = [...new Set(Object.values(per).flatMap(m => [...m.keys()]))].sort();
  const byHour = {};
  for (const t of times) {
    const v = Object.values(per).map(m => m.get(t)).filter(x => x != null);
    if (v.length >= W.minModels) byHour[t] = { lo: Math.min(...v), hi: Math.max(...v), mid: pct(v, .5), n: v.length };
  }
  // Highest hour of a day, over the same hours in every model (7am to 7pm; today: from the current hour).
  const peak = (day, from = 0) => {
    const hrs = []; for (let h = 7; h < 19; h++) { const t = day + "T" + String(h).padStart(2, "0") + ":00"; if (parseLocal(t).getTime() + 36e5 > from) hrs.push(t); }
    if (!hrs.length) return null;
    const pk = Object.values(per).filter(m => hrs.every(t => m.has(t))).map(m => Math.max(...hrs.map(t => m.get(t))));
    return pk.length >= W.minModels ? { lo: Math.min(...pk), hi: Math.max(...pk), n: pk.length } : null;
  };
  return { byHour, peak };
}
const wbgtRange = r => r == null ? "–" : r0(r.lo) === r0(r.hi) ? r0(r.lo) + "°" : r0(r.lo) + "–" + r0(r.hi) + "°";
// Band from the rounded ends shown, so the label always matches the numbers on screen.
const wbgtBand = r => { const b = v => C.wbgt.bands.find(x => Math.round(v) < x[1])[0], a = b(r.lo), z = b(r.hi); return a === z ? a : a + " to " + z; };
function renderWbgt() {
  const box = $("#wbgtCard"), E = S.data.wbgt, G = C.wbgt.guide;
  const now = Date.now(), dayOf = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: C.tz });
  const nowKey = E && Object.keys(E.byHour).find(t => parseLocal(t).getTime() <= now && parseLocal(t).getTime() + 36e5 > now);
  const cur = nowKey && E.byHour[nowKey];
  const rest = E && E.peak(dayOf(now), now), tmr = E && E.peak(dayOf(now + 864e5));
  const any = cur || rest || tmr;
  const cell = (r, label) => `<div><b>${esc(wbgtRange(r))}</b><span>${esc(label)}${r ? `<br>${esc(wbgtBand(r))}` : ""}</span></div>`;
  // Guidance follows the top of the range, so it errs towards caution.
  const upper = [cur, rest].filter(Boolean).sort((a, b) => b.hi - a.hi)[0];
  const lv = upper && G.levels[C.wbgt.bands.findIndex(x => Math.round(upper.hi) < x[1])];
  const list = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const open = new Set($$("details[open]", box).map(d => d.dataset.k));
  const fold = (k, title, html) => `<details data-k="${k}"${open.has(k) ? " open" : ""}><summary>${esc(title)}</summary>${html}</details>`;
  box.hidden = false;
  box.innerHTML = `<div class="card-head"><h2>Heat stress (WBGT)</h2><span class="tag">Estimate</span></div>
    ${any ? `<div class="kv">${cell(cur, "This hour")}${cell(rest, "Peak, rest of today")}${cell(tmr, "Peak tomorrow")}</div>` : `<p class="sub">The estimate isn't available right now. The guidance below still applies.</p>`}
    <h3 class="guide-h">Risks and guidelines</h3>
    ${lv ? `<p class="guide-now"><b>Rest of today, top of the range: ${esc(lv.name)}</b><br>${esc(lv.risk)}</p>${list(lv.act)}` : ""}
    <p class="guide-urgent"><b>${esc(G.urgent)}</b> can mean heat stroke. Call <b>999</b> and cool the person while you wait.</p>
    ${fold("levels", "What to do at each level", G.levels.map(l => `<p><b>${esc(l.name)}, ${esc(l.range)}</b><br>${esc(l.risk)}</p>${list(l.act)}`).join(""))}
    ${fold("groups", "Who is at higher risk", list(G.groups))}
    ${fold("signs", "Warning signs and first aid", `<p><b>Early signs</b></p>${list(G.early)}<p><b>Urgent: call 999</b></p>${list([G.urgent])}<p><b>First aid</b></p>${list(G.firstAid)}`)}
    ${fold("habits", "Everyday precautions", list(G.habits))}
    ${fold("work", "Heavy outdoor work", list(G.work) + `<p>${esc(G.workNote)}</p>`)}
    ${fold("about", "About this estimate and sources", `<p>Outdoors in the open, in °C.${any ? ` Range across ${any.n} models; differences in forecast sunshine matter a lot.` : ""} Calculated (Liljegren method), not measured: in a 10-day check against Singapore's sensors, the ECMWF-based figure averaged about 1.6° too hot around midday. The range can still be wrong, so don't rely on it as a safety alert. Levels are Singapore's, for long periods outdoors, not Malaysian limits. General information, not medical advice.</p><ul>${G.sources.map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a></li>`).join("")}</ul>`)}`;
}
let hourLimit = 24;
function renderHourly(D) {
  const H = D.hourly;
  const chips = $("#hourMetric");
  chips.innerHTML = Object.entries(HOUR_METRICS).map(([k, m]) => `<button role="radio" aria-checked="${k === S.hourMetric}" data-k="${k}">${m.name}</button>`).join("");
  const M = HOUR_METRICS[S.hourMetric] || HOUR_METRICS.temp;
  const now = Date.now();
  const start = Math.max(0, H.time.findIndex(t => parseLocal(t).getTime() > now - 36e5));
  const idx = []; for (let i = start; i < Math.min(H.time.length, start + 48); i++) idx.push(i);
  const vals = idx.map(i => num(M.get(H, i)));
  let lo, hi;
  if (M.scale === "range") { const v = vals.filter(x => x != null); lo = Math.min(...v) - 1; hi = Math.max(...v) + 1; } else [lo, hi] = M.scale;
  let prevK = null;
  const shown = idx.slice(0, hourLimit);
  const rows = shown.map((i, n) => {
    const t = parseLocal(H.time[i]);
    const cond = condition(H.weather_code[i], H.precipitation[i], H.cloud_cover[i], H.is_day?.[i]);
    const label = cond.k !== prevK ? cond.name : "";
    prevK = cond.k;
    const v = vals[n];
    const isMidnight = H.time[i].slice(11, 13) === "00";
    const tl = n === 0 ? "Now" : isMidnight ? fmtDay.format(t) : hourLabel(t);
    const w = v == null ? 0 : clamp((v - lo) / (hi - lo || 1), 0.03, 1) * 100;
    const fv = v == null ? "–" : M.fmt(v, H, i);
    const cls = ["hr", n === 0 ? "first" : "", n === shown.length - 1 ? "last" : ""].join(" ");
    return `<div class="${cls}"><span class="t${isMidnight || n === 0 ? " day" : ""}">${esc(tl)}</span><span class="bar" style="background:${cond.c}"></span><span class="lbl${cond.k === "storm" ? " storm" : ""}">${esc(label)}</span><span class="val"><span class="pill"><i style="width:${w}%;background:${M.color(v)}"></i></span><b>${esc(fv)}</b></span></div>`;
  }).join("");
  const more = idx.length > hourLimit ? `<button class="btn wide more" id="moreHours" style="background:var(--card2)">Show 48 hours</button>` : "";
  const note = `<p class="sub small" style="margin:10px 0 0">Models tend to bring afternoon storms a few hours early here; treat exact hours as approximate.${S.hourMetric === "prob" ? " Rain chance = share of the 51 ECMWF ensemble runs with at least 0.5 mm in that 3-hour block." : ""}${S.hourMetric === "wbgt" ? " WBGT = estimated range across models for the hour starting at each time, outdoors in the open; the bar shows the middle value." : ""}${S.hourMetric === "storm" ? " Storm risk combines the model's thunderstorm code with atmospheric instability (CAPE). Lightning forecasts aren't available for Malaysia." : ""}</p>`;
  $("#timeline").innerHTML = rows + more + note;
  $("#hourSource").textContent = modelById(S.settings.model).name;
}

function renderDays(D) {
  const d = D.daily, E = S.data.ens?.daily;
  const all = d.temperature_2m_min.concat(d.temperature_2m_max).filter(v => v != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  $("#days").innerHTML = d.time.map((t, i) => {
    const dt = parseLocal(t);
    const cond = condition(d.weather_code[i], (d.precipitation_sum[i] || 0) / Math.max(1, d.precipitation_hours?.[i] || 6), null, 1);
    const { v: prob, label: probLabel } = dayRain(D, i);
    const mn = d.temperature_2m_min[i], mx = d.temperature_2m_max[i];
    const L = ((mn - lo) / (hi - lo || 1)) * 100, R = ((mx - lo) / (hi - lo || 1)) * 100;
    const name = i === 0 ? "Today" : fmtDay.format(dt);
    const sr = d.sunrise?.[i] ? timeLabel(parseLocal(d.sunrise[i])) : "–", ss = d.sunset?.[i] ? timeLabel(parseLocal(d.sunset[i])) : "–";
    const ens = E?.[t];
    const conf = ens ? confidenceBadge(ens.spread) : "";
    const kv = [
      [r1(d.precipitation_sum[i]) + " mm", "Rain total"],
      [d.precipitation_hours?.[i] != null ? r0(d.precipitation_hours[i]) + " h" : "–", "Hours of rain"],
      [prob != null ? r0(prob) + "%" : "–", probLabel],
      [r0(d.apparent_temperature_max?.[i]) + "°", "Feels like max"],
      [r0(d.wind_speed_10m_max[i]) + " / " + r0(d.wind_gusts_10m_max[i]), "Wind / gust km/h"],
      [r0(d.uv_index_max?.[i]) + " " + uvName(d.uv_index_max?.[i]), "UV max"],
      [sr, "Sunrise"], [ss, "Sunset"],
      [ens ? `${r1(ens.p10)}–${r1(ens.p90)} mm` : "–", "Rain range (ENS 10–90%)"]
    ];
    return `<div class="day"><button aria-expanded="false"><span class="dn">${esc(name)}</span><span class="ic">${IC[cond.icon]}</span><span class="rp">${prob != null ? r0(prob) + "%" : ""}</span><span class="rng"><span>${r0(mn)}°</span><span class="track"><i style="left:${L}%;right:${100 - R}%"></i></span><span>${r0(mx)}°</span></span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      <div class="detail"><p class="daytext">${esc(fmtDate.format(dt))}. ${esc(daySummary(D, i))} ${conf}</p><div class="kv">${kv.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("")}</div></div></div>`;
  }).join("");
  $("#daySource").textContent = modelById(S.settings.model).name;
  $("#dayNote").textContent = E ? `% = share of the ${S.data.ens.members} ECMWF ensemble runs with at least ${C.rainDayMm} mm in the day (today: hours still to come). Not calibrated against local gauges.` : "% = Open-Meteo's chance of any rain; the ensemble didn't load.";
}
function confidenceBadge(spread) {
  if (spread == null) return "";
  const [cls, txt] = spread < 4 ? ["b-high", "High confidence"] : spread < 12 ? ["b-med", "Medium confidence"] : ["b-low", "Low confidence"];
  return `<span class="badge ${cls}">${txt}</span>`;
}

function renderSunMoon(D) {
  const d = D.daily, H = D.hourly;
  const today = d.time[0];
  const uvIdx = H.time.map((t, i) => t.startsWith(today) ? i : -1).filter(i => i >= 0);
  let peak = null; for (const i of uvIdx) if (H.uv_index[i] != null && (peak == null || H.uv_index[i] > H.uv_index[peak])) peak = i;
  const mi = moonInfo(new Date());
  const dl = d.daylight_duration?.[0];
  $("#sunmoon").innerHTML = [
    [IC.sunrise, d.sunrise?.[0] ? timeLabel(parseLocal(d.sunrise[0])) : "–", "Sunrise"],
    [IC.sunset, d.sunset?.[0] ? timeLabel(parseLocal(d.sunset[0])) : "–", "Sunset" + (dl ? ` · ${Math.floor(dl / 3600)}h ${Math.round(dl % 3600 / 60)}m light` : "")],
    [IC.uv, peak != null ? `${r0(H.uv_index[peak])} at ${hourLabel(parseLocal(H.time[peak]))}` : "–", "UV peak today"],
    [moonIcon(mi.phase), Math.round(mi.illum * 100) + "%", mi.name]
  ].map(([i, b, s]) => `<div>${i}<b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
}

/* ---------- Warnings (MET Malaysia via data.gov.my) ---------- */
const myTime = s => s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "+08:00") : null; // data.gov.my times are Malaysian time without offset
const normState = s => String(s || "").toLowerCase().replace(/federal territory of|wilayah persekutuan|w\.p\.|state/g, "").trim();
const KLANG = ["kuala lumpur", "selangor", "putrajaya"];
function renderWarnings(list) {
  const box = $("#warnings");
  box.innerHTML = "";
  if (!list) return;
  const now = Date.now();
  const st = normState(S.loc?.admin) || normState(S.loc?.name);
  const areas = KLANG.some(k => st.includes(k)) ? KLANG : [st].filter(Boolean);
  const active = list.filter(w => {
    const to = myTime(w.valid_to);
    if (to && to.getTime() < now) return false;
    const title = (w.warning_issue?.title_en || w.heading_en || "").toLowerCase();
    if (/sea|marine|waters/.test(title)) return false; // marine warnings are for boats, not land
    const text = ((w.text_en || "") + " " + (w.heading_en || "")).toLowerCase();
    return areas.some(a => text.includes(a));
  }).slice(0, 3);
  for (const w of active) {
    const div = document.createElement("div");
    div.className = "warn";
    const b = document.createElement("b"); b.textContent = w.warning_issue?.title_en || w.heading_en || "MET Malaysia warning";
    const p = document.createElement("p"); p.textContent = w.text_en || "";
    const sm = document.createElement("small");
    const f = myTime(w.valid_from), t = myTime(w.valid_to);
    sm.textContent = "MET Malaysia" + (f && t ? ` · valid ${timeLabel(f)} to ${timeLabel(t)}${t - f > 864e5 ? ", " + fmtDay.format(t) : ""}` : "");
    div.append(b, p, sm);
    box.append(div);
  }
}

/* ---------- Models view ---------- */
const MODEL_METRICS = { temp: "Temperature", rain: "Rain per hour", cum: "Cumulative rain", hum: "Humidity" };
function renderModels() {
  const M = S.data.models;
  const box = $("#modelChart");
  $("#modelMetric").innerHTML = Object.entries(MODEL_METRICS).map(([k, n]) => `<button role="radio" aria-checked="${k === S.modelMetric}" data-k="${k}">${n}</button>`).join("");
  const ref = M && (M[S.settings.model] || Object.values(M)[0]);
  if (!ref?.hourly) { box.innerHTML = ""; $("#agreeText").textContent = "Model data didn't load. Try refresh."; return; }
  const H = ref.hourly, now = Date.now();
  const start = Math.max(0, H.time.findIndex(t => parseLocal(t).getTime() > now - 36e5));
  const end = Math.min(H.time.length, start + 72);
  const key = { temp: "temperature_2m", rain: "precipitation", cum: "precipitation", hum: "relative_humidity_2m" }[S.modelMetric];
  const missing = C.models.filter(m => !M[m.id]).map(m => m.name);
  const series = C.models.map(m => {
    const src = M[m.id]?.hourly;
    if (!src?.[key]) return null;
    const pos = new Map(src.time.map((t, i) => [t, i]));
    let arr = H.time.slice(start, end).map(t => pos.has(t) ? src[key][pos.get(t)] : null);
    if (S.modelMetric === "cum") { let s = 0; arr = arr.map(v => v == null ? null : (s += v)); }
    return { m, arr };
  }).filter(s => s && s.arr.some(v => v != null));
  const times = H.time.slice(start, end).map(parseLocal);
  const main = S.settings.model;
  $("#modelLegend").innerHTML = series.map(s => `<span class="${s.m.id === main ? "main" : ""}"><i style="background:${s.m.color}"></i>${esc(s.m.name)}</span>`).join("");
  onSize(box, (W, Hh) => {
    if (!W || !series.length) return;
    const pad = { l: 36, r: 8, t: 10, b: 24 }, w = W - pad.l - pad.r, h = Hh - pad.t - pad.b;
    const all = series.flatMap(s => s.arr).filter(v => v != null);
    let lo = Math.min(...all), hi = Math.max(...all);
    if (S.modelMetric !== "temp" && S.modelMetric !== "hum") lo = 0;
    if (hi - lo < 1) hi = lo + 1;
    const x = i => pad.l + i / (times.length - 1) * w, y = v => pad.t + h - (v - lo) / (hi - lo) * h;
    const ticks = 4;
    let g = Array.from({ length: ticks + 1 }, (_, k) => { const v = lo + (hi - lo) * k / ticks; return `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${hi - lo < 5 ? v.toFixed(1) : Math.round(v)}</text>`; }).join("");
    times.forEach((t, i) => { if (H.time[start + i].slice(11, 13) === "00") { g += `<line class="grid-line" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + h}" stroke-dasharray="3 4"/><text class="axis" x="${x(i) + 4}" y="${Hh - 6}">${fmtDay.format(t)}</text>`; } });
    const order = series.slice().sort((a, b) => (a.m.id === main) - (b.m.id === main));
    for (const s of order) {
      const isMain = s.m.id === main;
      if (S.modelMetric === "rain") {
        g += `<path d="${path(s.arr.map((v, i) => [x(i), v == null ? null : y(v)]))}" fill="none" stroke="${s.m.color}" stroke-width="${isMain ? 2.5 : 1.4}" opacity="${isMain ? 1 : .75}" stroke-linejoin="round"/>`;
      } else {
        g += `<path d="${path(s.arr.map((v, i) => [x(i), v == null ? null : y(v)]))}" fill="none" stroke="${s.m.color}" stroke-width="${isMain ? 3 : 1.5}" opacity="${isMain ? 1 : .8}" stroke-linejoin="round"/>`;
      }
    }
    box.innerHTML = g;
  });

  // Agreement on daily rain and max temp
  const days = ref.daily.time.slice(0, 7);
  const dayVals = (m, k) => { const src = M[m.id]?.daily; if (!src?.[k]) return null; const pos = new Map(src.time.map((t, i) => [t, i])); return days.map(t => pos.has(t) ? src[k][pos.get(t)] : null); };
  const rainBy = C.models.map(m => ({ m, v: dayVals(m, "precipitation_sum") })).filter(r => r.v && r.v.some(x => x != null));
  const tmaxBy = C.models.map(m => dayVals(m, "temperature_2m_max")).filter(Boolean);
  const sd = a => { const v = a.filter(x => x != null); if (v.length < 2) return null; const mu = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - mu) ** 2, 0) / v.length); };
  const rainSd = days.slice(0, 3).map((_, i) => sd(rainBy.map(r => r.v[i]))).filter(x => x != null);
  const avgRainSd = rainSd.length ? rainSd.reduce((s, x) => s + x, 0) / rainSd.length : null;
  const tSd = days.slice(0, 3).map((_, i) => sd(tmaxBy.map(a => a[i]))).filter(x => x != null);
  const avgTSd = tSd.length ? tSd.reduce((s, x) => s + x, 0) / tSd.length : null;
  const lvl = avgRainSd == null ? null : avgRainSd < 3 ? "High" : avgRainSd < 8 ? "Medium" : "Low";
  $("#agreeTag").innerHTML = lvl ? `<span class="badge ${lvl === "High" ? "b-high" : lvl === "Medium" ? "b-med" : "b-low"}">${lvl} agreement</span>` : "";
  $("#agreeText").textContent = (lvl ? `Over the next 3 days, the models differ by about ${r1(avgRainSd)} mm of daily rain and ${r1(avgTSd)}° in daytime highs (one standard deviation). ${lvl === "Low" ? "Treat rain timing and totals with caution." : lvl === "Medium" ? "The broad picture is consistent; timing may vary." : "The models broadly agree."}` : "") + (missing.length ? ` Not available right now: ${missing.join(", ")}.` : "");

  // Table
  const head = `<thead><tr><th>Model</th>${days.map(t => `<th>${esc(fmtDay.format(parseLocal(t)))}</th>`).join("")}</tr></thead>`;
  const body = rainBy.map(r => `<tr><td${r.m.id === main ? ' style="font-weight:600;color:var(--ink)"' : ""}><span style="color:${r.m.color}">●</span> ${esc(r.m.name)}</td>${days.map((_, i) => { const v = r.v[i]; const a = v == null ? 0 : clamp(v / 30, 0, 1); return `<td><span class="cell" style="background:rgba(74,163,255,${(a * .7).toFixed(2)})">${v == null ? "–" : r1(v)}</span></td>`; }).join("")}</tr>`).join("");
  $("#modelTable").innerHTML = head + "<tbody>" + body + "</tbody>";
}

function renderEnsemble() {
  const E = S.data.ens, svg = $("#ensChart");
  $("#ensTag").textContent = C.ensembleName;
  if (!E) { $("#ensText").textContent = "Ensemble data didn't load. Try refresh."; svg.innerHTML = ""; return; }
  const now = Date.now();
  const blocks = E.blocks.filter(b => b.t.getTime() > now - 3 * 36e5 && b.prob != null).slice(0, 24);
  if (!blocks.length) { svg.innerHTML = ""; $("#ensText").textContent = "No ensemble data for the coming days."; return; }
  const next12 = blocks.slice(0, 4), maxP = Math.max(...next12.map(b => b.prob ?? 0));
  $("#ensText").textContent = `${E.members} runs of the model, each started from slightly different conditions. Bars: share of runs with at least ${C.rainBlockMm} mm in each 3-hour block; darker part: ${C.heavyBlockMm} mm or more (heavy). Orange band: temperature range across the middle 80% of runs. Next 12 hours: up to ${Math.round(maxP * 100)}% of runs show rain.`;
  onSize(svg, (W, H) => {
    if (!W) return;
    const pad = { l: 44, r: 34, t: 10, b: 24 }, w = W - pad.l - pad.r, h = H - pad.t - pad.b;
    const bw = w / blocks.length;
    const ys = v => pad.t + h - v * h;
    const tv = blocks.flatMap(b => [b.tP10, b.tP90]).filter(v => v != null);
    const tlo = Math.floor(Math.min(...tv)) - 1, thi = Math.ceil(Math.max(...tv)) + 1;
    const yt = v => pad.t + h - (v - tlo) / (thi - tlo) * h;
    let g = [0, .5, 1].map(v => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${ys(v)}" y2="${ys(v)}"/><text class="axis" x="${pad.l - 6}" y="${ys(v) + 4}" text-anchor="end">${v * 100}%</text>`).join("");
    g += [tlo, thi].map(v => `<text class="axis" x="${W - pad.r + 4}" y="${yt(v) + 4}">${v}°</text>`).join("");
    blocks.forEach((b, i) => {
      const x = pad.l + i * bw + 1, bwi = Math.max(1, bw - 2);
      g += `<rect x="${x}" y="${ys(b.prob)}" width="${bwi}" height="${b.prob * h}" fill="#4aa3ff" opacity=".55" rx="2"/>`;
      if (b.heavy > 0) g += `<rect x="${x}" y="${ys(b.heavy)}" width="${bwi}" height="${b.heavy * h}" fill="#1f6fd1" rx="2"/>`;
      if (b.keys[0].slice(11, 13) === "00") g += `<text class="axis" x="${x}" y="${H - 6}">${fmtDay.format(b.t)}</text>`;
    });
    const cx = i => pad.l + (i + .5) * bw;
    const up = blocks.map((b, i) => [cx(i), yt(b.tP90)]), dn = blocks.map((b, i) => [cx(i), yt(b.tP10)]).reverse();
    g += `<path d="${path(up)}${path(dn).replace("M", "L")}z" fill="#ff8a4c" opacity=".18"/>`;
    g += `<path d="${path(blocks.map((b, i) => [cx(i), yt(b.tP50)]))}" fill="none" stroke="#ff8a4c" stroke-width="2"/>`;
    svg.innerHTML = g;
  });
}

function renderAbout() {
  const box = $("#modelAbout");
  const items = C.about || [];
  box.innerHTML = `<div class="card-head"><h2>Why these models</h2></div>` + (items.length ? items.map(a => `<h3>${esc(a.title)}</h3><p>${esc(a.text)}</p>`).join("") : `<p class="sub">Model notes not configured.</p>`);
}

/* ---------- Radar ---------- */
let map, radarLayers = [], radarFrames = [], radarIdx = 0, radarTimer = null, meMarker;
function initMap() {
  if (map || !window.L) return;
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([S.loc.lat, S.loc.lon], 9);
  L.tileLayer(C.endpoints.basemap, { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', className: "base-tiles", maxZoom: 18 }).addTo(map);
  // Radar sits in its own pane, blended so place names on the basemap stay readable underneath.
  map.createPane("radar"); Object.assign(map.getPane("radar").style, { zIndex: 300, pointerEvents: "none", mixBlendMode: "screen" });
  meMarker = L.marker([S.loc.lat, S.loc.lon], { icon: L.divIcon({ className: "", html: '<div class="dot-me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(map);
  loadRadar();
}
// Fetch the frame list (used by the map and by the at-your-location radar trace).
async function loadRadarIndex() {
  let errs = [];
  for (const s of C.radar) {
    try { const d = await getJSON(s.url, 10000); if (d?.radar?.past?.length) { S.radar = { src: s, d }; meNowcast(s, d.host || "", d.radar.past, d.radar.nowcast || []); return; } errs.push(s.name + ": empty"); }
    catch (e) { errs.push(s.name + ": " + e.message); }
  }
  S.radar = { err: errs.join("; ") };
}
async function loadRadar() {
  if (!S.radar || S.radar.err) await loadRadarIndex();
  if (!map) return;
  if (S.radar.err) { $("#footRadar").textContent = "Radar couldn't load (" + S.radar.err + "). Use MET Malaysia's radar below."; return; }
  const { src, d } = S.radar;
  const host = d.host || "";
  const past = d.radar.past, cast = d.radar.nowcast || [];
  radarFrames = [...past, ...cast].map((f, i) => ({ ...f, nowcast: i >= past.length }));
  radarLayers.forEach(l => map.removeLayer(l));
  radarLayers = radarFrames.map(f => L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { pane: "radar", opacity: 0, maxNativeZoom: src.maxZoom, maxZoom: 18, attribution: src.credit }).addTo(map));
  $("#radarSlider").max = radarFrames.length - 1;
  showFrame(past.length - 1);
  const mins = Math.round((past[past.length - 1].time - past[0].time) / 60);
  $("#footRadar").textContent = `Radar: ${src.name}, last ${mins} minutes${cast.length ? ` plus a ${Math.round((cast[cast.length - 1].time - past[past.length - 1].time) / 60)}-minute nowcast (extrapolated movement, not a forecast model)` : ""}. Sharp to zoom ${src.maxZoom}. Radar shows rain already falling; gaps appear when MET Malaysia's feed is down.`;
}
/* Read the radar pixel at your location across frames: a radar-based rain trace for the past hour and nowcast. */
async function meNowcast(src, host, past, cast) {
  if (src.name !== "LibreWXR") return; // exact colour scale known only for this source
  const z = Math.min(src.maxZoom, 10), lat = S.loc.lat, lon = S.loc.lon;
  const n = 2 ** z, xt = (lon + 180) / 360 * n, yr = lat * Math.PI / 180, yt = (1 - Math.log(Math.tan(yr) + 1 / Math.cos(yr)) / Math.PI) / 2 * n;
  const tx = Math.floor(xt), ty = Math.floor(yt), px = Math.floor((xt - tx) * 256), py = Math.floor((yt - ty) * 256);
  const frames = [...past.slice(-6), ...cast];
  const read = f => new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { try { const c = document.createElement("canvas"); c.width = c.height = 5; const g = c.getContext("2d"); g.drawImage(img, px - 2, py - 2, 5, 5, 0, 0, 5, 5); const p = g.getImageData(0, 0, 5, 5).data; let mx = 0; for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 40) mx = Math.max(mx, intensityFromColor(p[i], p[i + 1], p[i + 2])); res(mx); } catch { res(null); } };
    img.onerror = () => res(null);
    img.src = `${host}${f.path}/256/${z}/${tx}/${ty}/2/0_0.png`;
  });
  const vals = await Promise.all(frames.map(read));
  if (vals.every(v => v == null)) return;
  S.data.radarTrace = frames.map((f, i) => ({ t: new Date(f.time * 1000), mmh: vals[i], nowcast: i >= Math.min(6, past.length) }));
  if (S.data.fc) { renderNow(S.data.fc); renderNext(S.data.fc); }
}
// LibreWXR's colour scale, lightest to heaviest. Rates use the standard Marshall–Palmer radar relation
// on the scale's approximate reflectivity steps, so treat them as rough categories, not measurements.
const RADAR_SCALE = [[136, 221, 238, 0.5], [0, 153, 204, 0.7], [0, 119, 170, 1.3], [0, 85, 136, 2.7], [255, 238, 0, 5.6], [255, 170, 0, 11.5], [255, 119, 0, 24], [238, 0, 0, 49], [153, 0, 0, 100]];
function intensityFromColor(r, g, b) {
  let best = null, bd = 1e9;
  for (const c of RADAR_SCALE) { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = c; } }
  return bd < 3000 ? best[3] : 0;
}
function showFrame(i) {
  if (!radarLayers.length) return;
  radarIdx = (i + radarLayers.length) % radarLayers.length;
  radarLayers.forEach((l, k) => l.setOpacity(k === radarIdx ? .75 : 0));
  const f = radarFrames[radarIdx];
  $("#radarSlider").value = radarIdx;
  $("#radarTime").textContent = timeLabel(new Date(f.time * 1000)) + (f.nowcast ? " · forecast" : "");
}
function toggleRadar() {
  if (radarTimer) { clearInterval(radarTimer); radarTimer = null; $("#playPath").setAttribute("d", "M8 5v14l11-7z"); return; }
  $("#playPath").setAttribute("d", "M7 5h4v14H7zm6 0h4v14h-4z");
  radarTimer = setInterval(() => showFrame(radarIdx + 1), 600);
}
function renderMetRadar() {
  $("#metRadar").innerHTML = `<a class="btn wide" style="display:grid;place-items:center;text-decoration:none" href="${esc(C.endpoints.metRadarPage)}" target="_blank" rel="noopener">Open MET Malaysia radar</a>`;
}
function renderMetForecast(m) {
  const box = $("#metFc");
  if (!m?.days?.length) { box.hidden = true; return; }
  box.hidden = false;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: C.tz });
  const rows = m.days.filter(d => d.date >= today).slice(0, 4);
  const per = (lbl, v) => { const en = bmToEn(v); return `<div><span class="per">${lbl}</span><b>${esc(en || v || "–")}</b>${en ? `<small>${esc(v)}</small>` : ""}</div>`; };
  box.innerHTML = `<div class="card-head"><h2>MET Malaysia forecast</h2><span class="tag">${esc(m.place || "")}</span></div>
    ${rows.map(d => `<div class="metday"><div class="metd"><b>${esc(fmtDay.format(parseLocal(d.date)))}</b><span>${esc(r0(d.min_temp))}–${esc(r0(d.max_temp))}°</span></div><div class="metp">${per("Morning", d.morning_forecast)}${per("Afternoon", d.afternoon_forecast)}${per("Night", d.night_forecast)}</div></div>`).join("")}
    <p class="sub small" style="margin:8px 0 0">The official forecaster's view for this area, issued daily. Malay originals shown under translations.</p>`;
}

/* ---------- Air ---------- */
const API_BANDS = [[50, "Good", "#3ccf8e"], [100, "Moderate", "#ffd23f"], [200, "Unhealthy", "#ff8a4c"], [300, "Very unhealthy", "#e8213a"], [1e9, "Hazardous", "#8f1d3a"]];
const AQI_BANDS = [[50, "Good", "#3ccf8e"], [100, "Moderate", "#ffd23f"], [150, "Unhealthy for sensitive groups", "#ff8a4c"], [200, "Unhealthy", "#e8213a"], [300, "Very unhealthy", "#a33bd6"], [1e9, "Hazardous", "#8f1d3a"]];
const band = (v, B) => B.find(b => v <= b[0]);
function scaleBar(v, B, max) {
  return `<div class="aq-scale">${B.map((b, i) => { const lo = i ? B[i - 1][0] : 0, hi = Math.min(b[0], max); return hi > lo ? `<i style="background:${b[2]};flex:${hi - lo}"></i>` : ""; }).join("")}</div><div class="aq-mark"><b style="left:calc(${clamp(v / max, 0, 1) * 100}% - 1px)"></b></div>`;
}
function bigNumber(v, B, label, meta, max) {
  const b = band(v, B);
  return `<div class="aq-big"><div class="aq-num" style="color:${b[2]}">${r0(v)}</div><div><div class="aq-cat">${esc(b[1])}</div><div class="aq-meta">${esc(label)}</div><div class="aq-meta">${esc(meta)}</div></div></div>${scaleBar(v, B, max)}`;
}
function renderDOE(doe) {
  const box = $("#doeBox");
  if (doe && doe.value != null) {
    box.innerHTML = bigNumber(doe.value, API_BANDS, `${doe.station} · ${doe.km} km away`, `${doe.pollutant ? "Main pollutant " + doe.pollutant + " · " : ""}${doe.time || ""}`, 300);
    return;
  }
  const portal = esc(C.endpoints.doePortal);
  box.innerHTML = `<p class="sub">${doe?.error ? esc(doe.error) + " " : ""}The Department of Environment doesn't publish a public data feed a web app can read directly. Check the official reading here:</p>
    <a class="btn wide" style="display:grid;place-items:center;text-decoration:none" href="${portal}" target="_blank" rel="noopener">Open DOE MyEQMS (official API)</a>
    <p class="sub small" style="margin-top:10px">Also in the MyJAS EQMS app. Add a data proxy in Settings to show it here.</p>`;
}
function renderAir(A, W) {
  const box = $("#aqiBox");
  let html = "";
  if (W && W.aqi != null) {
    html += bigNumber(W.aqi, AQI_BANDS, `${W.station}`, `US AQI from DOE station data via WAQI · ${W.time || ""}`, 300);
  }
  if (A?.current) {
    const c = A.current;
    html += `<div class="kv">${[
      [r0(c.pm2_5) + " µg/m³", "PM2.5 (model)"], [r0(c.pm10) + " µg/m³", "PM10 (model)"], [r0(c.us_aqi), "US AQI (model)"],
      [r0(c.ozone) + " µg/m³", "Ozone"], [r0(c.nitrogen_dioxide) + " µg/m³", "NO₂"], [r0(c.carbon_monoxide) + " µg/m³", "CO"]
    ].map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("")}</div>`;
    $("#aqiTag").textContent = W ? "WAQI + CAMS model" : "CAMS model";
  }
  box.innerHTML = html || `<p class="sub">Air data didn't load.</p>`;
  const svg = $("#aqiChart");
  if (!A?.hourly) { svg.innerHTML = ""; return; }
  const now = Date.now(), H = A.hourly;
  const st = Math.max(0, H.time.findIndex(t => parseLocal(t).getTime() > now - 36e5));
  const pts = H.time.slice(st, st + 48).map((t, i) => ({ t: parseLocal(t), v: H.pm2_5[st + i] }));
  onSize(svg, (W2, Hh) => {
    if (!W2) return;
    const pad = { l: 34, r: 8, t: 10, b: 22 }, w = W2 - pad.l - pad.r, h = Hh - pad.t - pad.b;
    const hi = Math.max(50, ...pts.map(p => p.v ?? 0)) * 1.1;
    const x = i => pad.l + i / (pts.length - 1) * w, y = v => pad.t + h - v / hi * h;
    let g = [0, 15, 35].filter(v => v < hi).map(v => `<line class="grid-line" x1="${pad.l}" x2="${W2 - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
    g += `<path d="${path(pts.map((p, i) => [x(i), p.v == null ? null : y(p.v)]))}" fill="none" stroke="#ff8a4c" stroke-width="2.5"/>`;
    g += `<text class="axis" x="${pad.l}" y="${Hh - 4}">Now</text><text class="axis" x="${W2 - pad.r}" y="${Hh - 4}" text-anchor="end">+48h</text><text class="axis" x="${W2 - pad.r}" y="${pad.t + 10}" text-anchor="end">PM2.5 µg/m³ forecast</text>`;
    svg.innerHTML = g;
  });
  $("#footAir").textContent = "Modelled values come from the Copernicus CAMS global model, which is coarse (about 40 km) and can miss local haze peaks. The DOE station reading is the official reference.";
}
async function loadWAQI(lat, lon) {
  if (!S.settings.waqi) return null;
  const d = await getJSON(`${C.endpoints.waqi}${lat};${lon}/?token=${encodeURIComponent(S.settings.waqi)}`);
  if (d.status !== "ok") throw new Error(typeof d.data === "string" ? d.data : "WAQI error");
  return { aqi: num(d.data.aqi), station: d.data.city?.name || "Nearest station", time: d.data.time?.s ? d.data.time.s.slice(0, 16) : "" };
}
async function loadDOE(lat, lon) {
  if (!S.settings.proxy) return null;
  // Proxy contract: GET {proxy}/doe -> [{station, state, lat, lon, api, pollutant, time}]
  const list = await getJSON(S.settings.proxy.replace(/\/$/, "") + "/doe");
  const dist = (a, b, c, d) => { const R = 6371, dLa = (c - a) * Math.PI / 180, dLo = (d - b) * Math.PI / 180; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const best = list.filter(s => s.api != null && s.lat != null).map(s => ({ ...s, km: dist(lat, lon, s.lat, s.lon) })).sort((a, b) => a.km - b.km)[0];
  return best ? { value: best.api, station: best.station, km: Math.round(best.km), pollutant: best.pollutant, time: best.time } : null;
}

/* ---------- Location ---------- */
async function reverseName(lat, lon) {
  try {
    const d = await getJSON(C.endpoints.reverse + "?" + qs({ latitude: lat, longitude: lon, localityLanguage: "en" }), 8000);
    return { name: d.locality || d.city || "Current location", admin: d.principalSubdivision || "" };
  } catch { return { name: "Current location", admin: "" }; }
}
function useGPS(auto = false) {
  if (!navigator.geolocation) { if (!auto) toast("Location isn't available in this browser."); return; }
  $("#gpsBtn").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(async p => {
    const lat = +p.coords.latitude.toFixed(4), lon = +p.coords.longitude.toFixed(4);
    const n = await reverseName(lat, lon);
    setLocation({ lat, lon, name: n.name, admin: n.admin, gps: true });
    $("#gpsBtn").textContent = "Use my current location";
    closeSheets();
  }, err => {
    $("#gpsBtn").textContent = "Use my current location";
    if (!auto) toast(err.code === 1 ? "Location permission was refused. Search for a place instead." : "Couldn't get your location.");
    if (!S.loc) setLocation(C.defaultLocation);
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}
function setLocation(loc) {
  S.loc = loc; store.set("loc", loc);
  if (!loc.gps) { S.recent = [loc, ...S.recent.filter(r => r.name !== loc.name || r.admin !== loc.admin)].slice(0, 6); store.set("recent", S.recent); }
  if (map) { map.setView([loc.lat, loc.lon], 9); meMarker.setLatLng([loc.lat, loc.lon]); }
  refresh();
}
let searchTimer;
async function search(q) {
  const ul = $("#results");
  if (q.trim().length < 2) { ul.innerHTML = ""; return; }
  try {
    const d = await getJSON(C.endpoints.geocode + "?" + qs({ name: q, count: 10, language: "en", format: "json", countryCode: "MY" }), 8000);
    const res = d.results || [];
    ul.innerHTML = "";
    if (!res.length) { ul.innerHTML = '<li class="sub" style="padding:10px 4px">No matches in Malaysia.</li>'; return; }
    for (const r of res) {
      const li = document.createElement("li"), b = document.createElement("button"), sm = document.createElement("small");
      b.textContent = r.name; sm.textContent = [r.admin2, r.admin1].filter(Boolean).join(", ");
      b.append(sm);
      b.addEventListener("click", () => { setLocation({ lat: r.latitude, lon: r.longitude, name: r.name, admin: r.admin1 || "" }); closeSheets(); });
      li.append(b); ul.append(li);
    }
  } catch (e) { ul.innerHTML = `<li class="sub" style="padding:10px 4px">Search failed: ${esc(e.message)}</li>`; }
}
function renderRecent() {
  const ul = $("#recent"); ul.innerHTML = "";
  if (!S.recent.length) { ul.innerHTML = '<li class="sub small" style="padding:8px 4px">Places you search for appear here.</li>'; return; }
  for (const r of S.recent) {
    const li = document.createElement("li"), b = document.createElement("button"), sm = document.createElement("small");
    b.textContent = r.name; sm.textContent = r.admin || ""; b.append(sm);
    b.addEventListener("click", () => { setLocation(r); closeSheets(); });
    li.append(b); ul.append(li);
  }
}

/* ---------- UI plumbing ---------- */
function toast(msg) { const b = $("#banner"); b.textContent = msg; b.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => b.hidden = true, 6000); }
function openSheet(id) { $(id).hidden = false; const f = $(id).querySelector("input,button"); f && setTimeout(() => f.focus(), 50); }
function closeSheets() { $$(".sheet").forEach(s => s.hidden = true); }
function setView(v) {
  S.view = v;
  $$(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  $$(".view").forEach(s => s.hidden = s.id !== "view-" + v);
  if (v === "radar") { initMap(); setTimeout(() => map && map.invalidateSize(), 50); }
  if (v === "models") { renderModels(); renderEnsemble(); }
  if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
}

async function refresh() {
  const loc = S.loc || C.defaultLocation;
  $("#locName").textContent = loc.name + (loc.admin && loc.admin !== loc.name ? ", " + loc.admin : "");
  $("#refreshBtn").classList.add("spin");
  const tasks = {
    fc: loadForecast(loc.lat, loc.lon),
    models: loadModels(loc.lat, loc.lon),
    ens: loadEnsemble(loc.lat, loc.lon),
    air: loadAir(loc.lat, loc.lon),
    warn: loadWarnings(),
    waqi: loadWAQI(loc.lat, loc.lon),
    doe: loadDOE(loc.lat, loc.lon),
    met: loadMetForecast(loc)
  };
  S.radar = null; S.data.radarTrace = null;
  loadRadarIndex().then(() => { if (map) loadRadar(); });
  const keys = Object.keys(tasks);
  const out = await Promise.allSettled(Object.values(tasks));
  const R = {}; keys.forEach((k, i) => R[k] = out[i]);
  $("#refreshBtn").classList.remove("spin");

  S.data.ens = R.ens.status === "fulfilled" ? ensembleStats(R.ens.value) : null;
  S.data.models = R.models.status === "fulfilled" ? R.models.value : null;
  S.data.wbgt = null;
  try { S.data.wbgt = wbgtStats(S.data.models, loc); } catch (e) { console.error(e); }

  if (R.fc.status === "fulfilled") {
    const D = R.fc.value; S.data.fc = D;
    store.set("cache", { loc, t: Date.now(), fc: { ...D, filledFrom: [...D.filledFrom] } });
    renderAll(D);
    $("#updated").textContent = "Updated " + timeLabel(new Date());
    if (!D.headlineOk) toast(`${modelById(S.settings.model).name} didn't respond, so the forecast uses Open-Meteo's best-match blend.`);
  } else {
    const cache = store.get("cache", null);
    if (cache?.fc && cache.loc?.lat === loc.lat) {
      renderAll(cache.fc);
      $("#updated").textContent = "Offline · " + timeLabel(new Date(cache.t));
    }
    try { renderWbgt(); } catch (e) { console.error(e); } // heat guidance shows even with no forecast
    toast("Couldn't load the forecast: " + R.fc.reason?.message + ". Showing what's saved, if anything.");
  }
  renderWarnings(R.warn.status === "fulfilled" ? R.warn.value : null);
  renderMetForecast(R.met.status === "fulfilled" ? R.met.value : null);
  if (S.view === "models") { renderModels(); renderEnsemble(); }
  renderAir(R.air.status === "fulfilled" ? R.air.value : null, R.waqi.status === "fulfilled" ? R.waqi.value : null);
  if (R.waqi.status === "rejected") $("#aqiTag").textContent = "WAQI: " + R.waqi.reason.message;
  renderDOE(R.doe.status === "fulfilled" ? R.doe.value : { error: "The data proxy didn't respond (" + R.doe.reason?.message + ")." });
  renderMetRadar();
}
function renderAll(D) {
  try { renderNow(D); } catch (e) { console.error(e); }
  try { renderNext(D); } catch (e) { console.error(e); }
  try { renderHourly(D); } catch (e) { console.error(e); }
  try { renderWbgt(); } catch (e) { console.error(e); }
  try { renderDays(D); } catch (e) { console.error(e); }
  try { renderSunMoon(D); } catch (e) { console.error(e); }
  const m = modelById(S.settings.model);
  $("#footForecast").innerHTML = `Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (${esc(m.name)}, ${esc(m.res)}; gaps filled from Open-Meteo's best-match). Rain chance and confidence: ${esc(C.ensembleName)}. Warnings and official forecast: MET Malaysia via data.gov.my. 2-hour graph: model estimate, with the radar nowcast at your location overlaid when available.`;
}

/* ---------- Events ---------- */
$$(".tabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
$("#locBtn").addEventListener("click", () => { renderRecent(); openSheet("#locSheet"); });
$("#settingsBtn").addEventListener("click", () => {
  $("#setModel").innerHTML = C.models.map(m => `<option value="${esc(m.id)}"${m.id === S.settings.model ? " selected" : ""}>${esc(m.name)} (${esc(m.res)})</option>`).join("");
  $("#setWaqi").value = S.settings.waqi; $("#setProxy").value = S.settings.proxy;
  openSheet("#setSheet");
});
$("#saveSettings").addEventListener("click", () => {
  S.settings = { model: $("#setModel").value, waqi: $("#setWaqi").value.trim(), proxy: $("#setProxy").value.trim() };
  store.set("settings", S.settings); closeSheets(); refresh();
});
$("#refreshBtn").addEventListener("click", () => refresh());
$("#gpsBtn").addEventListener("click", () => useGPS(false));
$("#searchInput").addEventListener("input", e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(e.target.value), 300); });
$("#searchForm").addEventListener("submit", e => { e.preventDefault(); search($("#searchInput").value); });
$$(".sheet").forEach(s => s.addEventListener("click", e => { if (e.target === s || e.target.closest("[data-close]")) closeSheets(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
$("#hourMetric").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.hourMetric = b.dataset.k; store.set("hourMetric", S.hourMetric); renderHourly(S.data.fc); });
$("#timeline").addEventListener("click", e => { if (e.target.id === "moreHours") { hourLimit = 48; renderHourly(S.data.fc); } });
$("#days").addEventListener("click", e => { const b = e.target.closest(".day>button"); if (!b) return; const d = b.parentElement; d.classList.toggle("open"); b.setAttribute("aria-expanded", d.classList.contains("open")); });
$("#modelMetric").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.modelMetric = b.dataset.k; renderModels(); });
$("#radarPlay").addEventListener("click", toggleRadar);
$("#radarSlider").addEventListener("input", e => { if (radarTimer) toggleRadar(); showFrame(+e.target.value); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.data.fc && Date.now() - (refresh.last || 0) > 10 * 60e3) refresh(); });

/* ---------- Start ---------- */
renderAbout();
const startView = (location.hash || "#forecast").slice(1);
setView(["forecast", "radar", "models", "air"].includes(startView) ? startView : "forecast");
const saved = store.get("cache", null);
if (saved?.fc && S.loc && saved.loc?.lat === S.loc.lat) { try { renderAll(saved.fc); $("#updated").textContent = "Saved " + timeLabel(new Date(saved.t)); } catch {} }
if (!S.loc || S.loc.gps) { if (!S.loc) S.loc = C.defaultLocation; useGPS(true); }
refresh(); refresh.last = Date.now();
setInterval(() => { if (!document.hidden) { refresh(); refresh.last = Date.now(); } }, 15 * 60e3);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
