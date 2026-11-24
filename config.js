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
  rainDayMm: 5,       // per day; the model reaches 1 mm on most days here, so 1 mm says little

  /* Estimated WBGT. Bands are Singapore's (Low below 31, Moderate 31 to below 33, High 33+), read from data.gov.sg's labelled readings.
     AIFS is left out because its 6-hourly steps can't time the sun. windFactor 1 = 10 m wind as forecast; reducing it to 2 m ran hotter against
     Singapore's measurements (Nov 2026, 30 stations, 10 days: mean error 1.5 °C and 1.0 °C too hot by day with factor 1). */
  wbgt: {
    models: ["ecmwf_ifs", "gfs_seamless", "ukmo_global_deterministic_10km", "icon_global", "cma_grapes_global"],
    minModels: 3, windFactor: 1, bands: [["Low", 31], ["Moderate", 33], ["High", Infinity]],
    /* Guidance is paraphrased from the sources listed, read 2026-11-24. Check them before changing any wording. */
    guide: {
      levels: [
        { name: "Low", range: "below 31°", risk: "Lower risk for most people, but heat illness is still possible, especially with hard effort or if you're in a higher-risk group.", act: ["Carry on as normal", "Drink as usual"] },
        { name: "Moderate", range: "31° to below 33°", risk: "Higher risk of heat cramps, heat exhaustion and heat stroke.", act: ["Cut back on time outdoors", "Rest regularly in shade or indoors", "Drink more", "Watch for the warning signs below", "Skip extra layers; use a hat or umbrella"] },
        { name: "High", range: "33° or more", risk: "Highest band. The same illnesses are more likely.", act: ["Keep outdoor activity to a minimum and stay in shade where you can", "Take longer or more frequent breaks", "Drink more and watch for the warning signs below", "Cool down in breaks, such as water on arms and legs", "Wear thin, light-coloured clothing with a hat or umbrella"] }
      ],
      groups: ["Older people", "Babies and children, especially under 5", "Pregnant or breastfeeding women", "Anyone ill, recently recovered or with a long-term condition", "People newly arrived from a cooler climate", "Outdoor workers and people exercising in the heat"],
      early: ["Headache", "Tiredness", "Trouble concentrating", "Dizziness", "Muscle weakness or cramps", "Nausea"],
      urgent: "Confusion, slurred speech, fainting or a seizure",
      firstAid: ["Heat stroke: call 999, stay with the person, move them to a cool shaded place, remove outer clothing, and cool them fast with cold water, ice or wet cloths and moving air", "Heat exhaustion: move out of the heat, remove extra clothing, cool the head, face and neck, take frequent sips of cool water, and get medical care"],
      habits: ["Avoid the 11am to 4pm peak", "Limit strenuous activity", "Never leave children in a parked vehicle"],
      /* DOSH Malaysia, Guidelines on Heat Stress Management at Workplace 2016, Tables 6 to 9 (screening values DOSH takes from ACGIH 2015).
         Each row: share of the hour spent working, then [action limit, limit] for light, moderate, heavy and very heavy work; null = no value given. */
      dosh: {
        loads: [["Light", "sitting or standing with some arm work"], ["Moderate", "normal walking, moderate lifting"], ["Heavy", "shovelling, carrying, fast walking"], ["Very heavy", "intense work at a fast pace"]],
        rows: [
          ["75–100%", [28, 31], [25, 28], null, null],
          ["50–75%", [28.5, 31], [26, 29], [24, 27.5], null],
          ["25–50%", [29.5, 32], [27, 30], [25.5, 29], [24.5, 28]],
          ["0–25%", [30, 32.5], [29, 31.5], [28, 30.5], [27, 30]]
        ],
        actions: [
          ["Low (below the action limit)", ["Carry on working and keep monitoring"]],
          ["Medium (action limit up to the limit)", ["Regular drinking water", "Training and information", "Work in pairs or groups", "First aid and an emergency plan", "Health screening", "A cool place to rest"]],
          ["High (above the limit)", ["All of the above, plus a work-rest routine", "Cut the physical load, for example with mechanical aids", "Shade, ventilation or cooling", "Supervision and building up to the heat"]]
        ],
        acclimatise: "Getting used to the heat generally takes 7 to 14 days. DOSH advises about half the normal workload on a new worker's first day.",
        note: "DOSH's limits are for measured WBGT, adjusted for clothing (0 for normal work clothes), and assume healthy, well-hydrated workers used to the heat. This app's figure is an estimate, so don't use it to show compliance. A dash means DOSH gives no screening value."
      },
      workSg: "Singapore, for comparison: at least 10 minutes' rest an hour for heavy physical work from 32°, and at least 15 from 33°.",
      sources: [
        ["Levels and higher-risk groups: NEA Singapore, Jan 2026", "https://www.weather.gov.sg/wp-content/uploads/2026/04/Manage-HeatStress-Eng-2026.pdf"],
        ["Work limits and heat stroke first aid: DOSH Malaysia, 2016", "https://dosh.gov.my/wp-content/uploads/2026/03/ve_gl_heat-stress-management-at-wplace-2016.pdf"],
        ["Higher-risk groups: Malaysia's Ministry of Health heatwave guide", "https://infosihat.moh.gov.my/images/media_sihat/garis_panduan/pdf/Buku%20Gelombang%20Haba.pdf"],
        ["Singapore outdoor work: MOM", "https://www.mom.gov.sg/heat-stress-measures-for-outdoor-work"],
        ["Early signs and daily advice: Malaysia's Ministry of Health, via Malay Mail, 25 Mar 2026", "https://www.malaymail.com/news/malaysia/2026/03/25/moh-tells-public-to-take-precautions-as-malaysia-records-more-heatrelated-illnesses-amid-prolonged-hot-weather/213801"],
        ["Urgent signs and first aid: NIOSH (US)", "https://www.cdc.gov/niosh/heat-stress/about/illnesses.html"],
        ["Outdoor workers and parked vehicles: WHO", "https://www.who.int/news-room/fact-sheets/detail/climate-change-heat-and-health"],
        ["Emergency number: MERS 999", "https://999.gov.my/"]
      ]
    }
  },

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
