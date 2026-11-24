/* Hujan configuration: data sources and model choices.
   Edit here, not in app.js. */
window.HUJAN_CONFIG = {
  tz: "Asia/Kuala_Lumpur",
  defaultLocation: { name: "Kuala Lumpur", admin: "Kuala Lumpur", lat: 3.1478, lon: 101.6953 },

  endpoints: {
    forecast: "https://api.open-meteo.com/v1/forecast",
    ensemble: "https://ensemble-api.open-meteo.com/v1/ensemble",
    air: "https://air-quality-api.open-meteo.com/v1/air-quality",
    geocode: "https://geocoding-api.open-meteo.com/v1/search",
    reverse: "https://api.bigdatacloud.net/data/reverse-geocode-client",
    warnings: "https://api.data.gov.my/weather/warning",
    metForecast: "https://api.data.gov.my/weather/forecast",
    waqi: "https://api.waqi.info/feed/geo:",
    basemap: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", // no key needed; darkened in styles.css
    metRadarPage: "https://www.met.gov.my/pencerapan/radar-semenanjung/",
    doePortal: "https://eqms.doe.gov.my/APIMS/main"
  },

  /* Radar sources, tried in order. Both use the RainViewer-style frame list. */
  radar: [
    { name: "LibreWXR", url: "https://api.librewxr.net/public/weather-maps.json", maxZoom: 12,
      credit: 'Radar © <a href="https://www.met.gov.my/">MET Malaysia</a> via <a href="https://librewxr.pages.dev/">LibreWXR</a>' },
    { name: "RainViewer", url: "https://api.rainviewer.com/public/weather-maps.json", maxZoom: 7,
      credit: 'Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>' }
  ],

  defaultModel: "ecmwf_ifs",

  /* id = Open-Meteo `models=` value; alt = older/newer names tried if the first is rejected. */
  models: [
    { id: "ecmwf_ifs", alt: ["ecmwf_ifs025"], name: "ECMWF IFS", color: "#4aa3ff", res: "9 km, hourly", maker: "European Centre (ECMWF)" },
    { id: "ecmwf_aifs025_single", alt: ["ecmwf_aifs025"], name: "ECMWF AIFS", color: "#3ccf8e", res: "25 km, 6-hourly", maker: "ECMWF, AI model" },
    { id: "gfs_seamless", alt: ["ncep_gfs_seamless", "gfs_global"], name: "NOAA GFS", color: "#b48cff", res: "13 km, hourly", maker: "US NOAA" },
    { id: "ukmo_global_deterministic_10km", alt: ["ukmo_seamless"], name: "UK Met Office", color: "#ffb020", res: "10 km, hourly", maker: "UK Met Office" },
    { id: "icon_global", alt: ["dwd_icon_global", "icon_seamless"], name: "DWD ICON", color: "#ff7a9c", res: "13 km, hourly", maker: "German Weather Service" },
    { id: "cma_grapes_global", alt: [], name: "CMA GRAPES", color: "#7fd6d0", res: "15 km, 3-hourly", maker: "China Meteorological Administration" }
  ],

  ensembleModel: "ecmwf_ifs025",
  ensembleAlt: ["ecmwf_ifs025_ensemble"],
  ensembleName: "ECMWF ENS, 51 runs",

  /* Rain thresholds. Models rain too lightly and too often in the tropics, so "rain" uses a higher cut-off. */
  rainBlockMm: 0.5,   // per 3 hours, per ensemble run
  heavyBlockMm: 10,   // per 3 hours
  rainDayMm: 1,       // per day

  about: [
    { title: "Headline: ECMWF IFS (9 km)", text: "The highest-resolution global model with hourly steps, updated every 6 hours. ECMWF's own 2025 verification gives it the smallest tropical wind error of any centre. It's a physics model, so it keeps the intensity of heavy showers that AI models tend to flatten. No published study ranks global models for Malaysia specifically, so this choice is a judgement from the general evidence (medium confidence)." },
    { title: "ECMWF AIFS (AI model)", text: "Scores about 10% better than IFS on daily rainfall globally, including the tropics, but under-predicts rain above about 10 mm and only has 6-hourly steps. Best for multi-day totals, not for timing a storm." },
    { title: "NOAA GFS", text: "A 2018 study found GFS times the early-afternoon rain peak over tropical land better than IFS, though it exaggerates the day–night swing." },
    { title: "UK Met Office, DWD ICON, CMA GRAPES", text: "Independent physics models at 10–15 km. Useful mainly as a check: when they disagree with ECMWF, confidence is lower." },
    { title: "Timing caveat", text: "Global models bring Peninsular Malaysia's afternoon thunderstorms a few hours too early, and rain too lightly and too often. Treat hourly rain timing as approximate (\"this afternoon\"), and use the radar for the next hour." },
    { title: "Confidence: ECMWF ensemble", text: "51 runs of the ECMWF model with slightly different starting conditions. The share of runs showing rain is a fair rain-chance figure; raw ensembles in tropical Asia tend to be overconfident, so a wide spread is a stronger signal than a narrow one." },
    { title: "Dropped", text: "JMA (too coarse at 55 km), KMA (discontinued March 2026) and Australia's ACCESS-G (no updates since mid-2025)." }
  ]
};
