# Hujan — Malaysia weather

A static web app (no server, no build step) for multi-model weather, rain radar and air quality, tuned for the Klang Valley. Works on iPhone, Android and desktop; add it to your home screen to use it like an app.

## Put it on GitHub Pages

1. Sign in at github.com and create a new **public** repository called `hujan` (free GitHub Pages needs a public repo; the code contains no keys or personal data).
2. In the new repo, choose **Add file → Upload files**, drag in everything from this folder (including the `icons` folder), and commit.
3. Go to **Settings → Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**, then Save.
4. After a minute or two, open `https://YOUR-USERNAME.github.io/hujan/`.
5. Add to home screen: on iPhone, Safari → Share → Add to Home Screen. On Pixel, Chrome → ⋮ → Add to home screen / Install app.

Allow location when asked, or search a place.

## Data sources

| What | Source | Notes |
|---|---|---|
| Headline forecast | ECMWF IFS 9 km via Open-Meteo | Gaps (e.g. UV) filled from Open-Meteo's best match |
| Model comparison | ECMWF AIFS, NOAA GFS, UK Met Office, DWD ICON, CMA GRAPES | Each fetched separately |
| Rain chance, confidence | ECMWF ensemble (51 runs) | Hourly: ≥0.5 mm per 3 h (heavy: ≥10 mm). Daily: ≥5 mm, with today counting only hours still to come |
| Heat stress (WBGT) | Calculated from five models' temperature, humidity, wind and sunshine (Liljegren et al. 2008) | Estimate shown as a range, not measured; Singapore's bands; no alerts |
| Radar | LibreWXR (MET Malaysia radars, zoom 12, 60-min nowcast); RainViewer as fallback | Radar trace at your location read from LibreWXR tiles |
| Warnings, official forecast | MET Malaysia via api.data.gov.my | Cached to respect the 4-requests-a-minute limit |
| Air quality | Copernicus CAMS via Open-Meteo; optional WAQI token for DOE station data in US AQI | Official DOE API needs a proxy (not included) |

Weather data by Open-Meteo.com (CC BY 4.0). Air quality: CAMS / Open-Meteo. Radar © MET Malaysia via LibreWXR / RainViewer. Map © OpenStreetMap contributors.

Open-Meteo's free tier is for non-commercial use.

## Settings (gear icon)

- **Headline model:** switch the main forecast to another model.
- **WAQI token:** free from aqicn.org/data-platform/token; shows the nearest DOE station's reading converted to US AQI.
- **Data proxy URL:** for a future proxy that serves official DOE API readings (`GET {proxy}/doe` → `[{station, lat, lon, api, pollutant, time}]`).

## Change things

Model list, colours, radar sources and rain thresholds live in `config.js`.
