/* Estimated outdoor WBGT (wet-bulb globe temperature).
   Own implementation of the heat-balance equations in Liljegren et al. (2008), checked term by term against
   the published C code (github.com/mdljts/wbgt). No published test values were available to run against.
   Differences: minimum wind 0.5 m/s, and wind is used as forecast at 10 m (see windFactor in config.js). */
window.HUJAN_WBGT = (() => {
  const SB = 5.6696e-8, CP = 1003.5, MA = 28.97, MW = 18.015, RA = 8314.34 / MA, PR = CP / (CP + 1.25 * RA), RATIO = CP * MA / MW;
  const D_G = 0.0508, D_W = 0.007, L_W = 0.0254, EM = 0.95, EM_SFC = 0.999, ALB_SFC = 0.45, ALB_G = 0.05, ALB_W = 0.4;
  const visc = T => 2.6693e-6 * Math.sqrt(MA * T) / (3.617 ** 2 * ((T / 97 - 2.9) / 0.4 * -0.034 + 1.048));
  const cond = T => (CP + 1.25 * RA) * visc(T);
  const diffu = (T, P) => 3.64e-4 * (T / Math.sqrt(132 * 647.3)) ** 2.334 * Math.cbrt(36.4 * 218) * (132 * 647.3) ** (5 / 12) * Math.sqrt(1 / MA + 1 / MW) / (P / 1013.25) * 1e-4;
  const evap = T => (313.15 - T) / 30 * -71100 + 2.4073e6;
  const esat = T => 1.004 * 6.1121 * Math.exp(17.502 * (T - 273.15) / (T - 32.18));
  const dens = (T, P) => P * 100 / (RA * T);
  const hSphere = (T, P, u) => (2 + 0.6 * Math.sqrt(u * dens(T, P) * D_G / visc(T)) * PR ** 0.3333) * cond(T) / D_G;
  const hCyl = (T, P, u) => 0.281 * (u * dens(T, P) * D_W / visc(T)) ** 0.6 * PR ** 0.44 * cond(T) / D_W;
  const solve = (f, x) => { for (let i = 0; i < 800; i++) { const n = f(x); if (Math.abs(n - x) < 0.01) return n; x = 0.9 * x + 0.1 * n; } return null; };

  // tC °C, rh %, P hPa, wind m/s, solar W/m² (hourly mean), fdir 0–1, cza = cosine of the sun's zenith angle
  function estimate(tC, rh, P, wind, solar, fdir, cza) {
    if ([tC, rh, P, wind, solar, fdir, cza].some(v => v == null || Number.isNaN(v))) return null;
    const T = tC + 273.15, r = Math.max(0.05, rh / 100), u = Math.max(wind, 0.5), ea = r * esat(T);
    if (cza < 0.00873 || solar <= 0) { solar = 0; fdir = 0; cza = 1; }
    fdir = Math.min(Math.max(fdir, 0), 0.9);
    const sza = Math.acos(Math.min(1, cza));
    const lw = 0.5 * (0.575 * ea ** 0.143 * T ** 4 + EM_SFC * T ** 4);
    const g = solve(x => (lw - hSphere(0.5 * (x + T), P, u) / (SB * EM) * (x - T) + solar / (2 * SB * EM) * (1 - ALB_G) * (fdir * (1 / (2 * cza) - 1) + 1 + ALB_SFC)) ** 0.25, T);
    const w = solve(x => {
      const tr = 0.5 * (x + T), ew = esat(x), sc = visc(tr) / (dens(tr, P) * diffu(tr, P)), k = 0.25 * D_W / L_W;
      const rad = SB * EM * (lw - x ** 4) + (1 - ALB_W) * solar * ((1 - fdir) * (1 + k) + fdir * (Math.tan(sza) / Math.PI + k) + ALB_SFC);
      return T - evap(tr) / RATIO * (ew - ea) / (P - ew) * (PR / sc) ** 0.56 + rad / hCyl(tr, P, u);
    }, T - 2);
    return g == null || w == null || Number.isNaN(g) || Number.isNaN(w) ? null : 0.1 * tC + 0.2 * (g - 273.15) + 0.7 * (w - 273.15);
  }

  // Cosine of the solar zenith angle at a UTC time in ms.
  function cosZenith(ms, lat, lon) {
    const d = new Date(ms), n = Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5), h = d.getUTCHours() + d.getUTCMinutes() / 60, R = Math.PI / 180;
    const B = 2 * Math.PI * (n - 81) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const dec = 23.45 * R * Math.sin(2 * Math.PI * (284 + n) / 365), ha = 15 * R * (h + lon / 15 + eot / 60 - 12);
    return Math.sin(lat * R) * Math.sin(dec) + Math.cos(lat * R) * Math.cos(dec) * Math.cos(ha);
  }

  // One model's hourly block -> [{ t: start of hour (local string), v }]. Each value covers the hour after t.
  function series(H, lat, lon, parse, windFactor) {
    const avg = (k, i) => H[k]?.[i] == null || H[k]?.[i - 1] == null ? null : (H[k][i] + H[k][i - 1]) / 2;
    return H.time.slice(1).map((t, j) => {
      const i = j + 1, s = H.shortwave_radiation?.[i], dr = H.direct_radiation?.[i], w = avg("wind_speed_10m", i);
      const v = s == null || dr == null || w == null ? null
        : estimate(avg("temperature_2m", i), avg("relative_humidity_2m", i), avg("surface_pressure", i), w / 3.6 * windFactor, s, s > 0 ? dr / s : 0, cosZenith(parse(t).getTime() - 18e5, lat, lon));
      return { t: H.time[i - 1], v };
    });
  }
  return { estimate, cosZenith, series };
})();
