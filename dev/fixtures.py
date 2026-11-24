"""Generate realistic Open-Meteo / data.gov.my / RainViewer-shaped sample responses for offline UI testing."""
import json, math, random, datetime as dt, os, sys
random.seed(7)
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
MY = dt.timezone(dt.timedelta(hours=8))
now = dt.datetime.now(MY)
d0 = now.replace(hour=0, minute=0, second=0, microsecond=0)
DAYS = 14
hours = [d0 + dt.timedelta(hours=i) for i in range(24 * DAYS)]
fmt = lambda t: t.strftime("%Y-%m-%dT%H:%M")

def diurnal(h, day, model_shift=0):
    # Klang Valley: 24-25 at dawn, 32-34 mid-afternoon, afternoon storms
    temp = 28.5 + 4.5 * math.sin((h - 9) / 24 * 2 * math.pi) + random.uniform(-.4, .4) + (0.4 if day % 3 == 0 else 0)
    stormy = day in (0, 1, 3, 4, 6, 9, 11, 12)
    rain = 0.0
    if stormy and 14 + model_shift <= h <= 18 + model_shift:
        peak = 16 + model_shift + (day % 2)
        rain = max(0, 12 * math.exp(-((h - peak) ** 2) / 1.5) + random.uniform(-.5, .5))
    if day == 2 and 2 <= h <= 5: rain = 1.2
    return temp, rain

def hourly_block(shift=0, scale=1.0, prob=True):
    H = {k: [] for k in ["time", "temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m", "precipitation",
                          "precipitation_probability", "weather_code", "cloud_cover", "wind_speed_10m", "wind_gusts_10m",
                          "wind_direction_10m", "uv_index", "pressure_msl", "visibility", "cape", "is_day"]}
    for t in hours:
        day = (t - d0).days; h = t.hour
        temp, rain = diurnal(h, day, shift); rain *= scale
        rh = max(55, min(98, 95 - (temp - 24) * 4 + random.uniform(-3, 3)))
        dew = temp - (100 - rh) / 5
        cloud = 95 if rain > 0.2 else (20 + 50 * (1 if 12 <= h <= 19 else 0) + random.uniform(0, 25))
        code = 95 if rain > 6 else 63 if rain > 2.5 else 61 if rain > 0.2 else 3 if cloud > 85 else 2 if cloud > 45 else 1
        H["time"].append(fmt(t)); H["temperature_2m"].append(round(temp, 1)); H["apparent_temperature"].append(round(temp + (rh - 60) / 8, 1))
        H["relative_humidity_2m"].append(round(rh)); H["dew_point_2m"].append(round(dew, 1)); H["precipitation"].append(round(rain, 1))
        H["precipitation_probability"].append(None if not prob else min(100, round(rain * 12 + (35 if 13 <= h <= 19 else 5))))
        H["weather_code"].append(code); H["cloud_cover"].append(round(min(100, cloud)))
        H["wind_speed_10m"].append(round(4 + 6 * (12 <= h <= 18) + random.uniform(0, 3), 1)); H["wind_gusts_10m"].append(round(12 + 25 * (rain > 3) + random.uniform(0, 8), 1))
        H["wind_direction_10m"].append(random.choice([200, 220, 240, 260])); H["uv_index"].append(round(max(0, 11 * math.sin((h - 7) / 12 * math.pi)) * (0.5 if cloud > 80 else 1), 1) if 7 <= h <= 19 else 0)
        H["pressure_msl"].append(round(1009 + 1.5 * math.cos((h - 10) / 12 * 2 * math.pi), 1)); H["visibility"].append(24000)
        H["cape"].append(round(max(0, 2200 * math.sin((h - 8) / 14 * math.pi)) if 8 <= h <= 22 else 300)); H["is_day"].append(1 if 7 <= h <= 19 else 0)
    return H

def daily_from(H):
    D = {k: [] for k in ["time", "weather_code", "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max", "precipitation_sum",
                          "precipitation_hours", "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max", "uv_index_max",
                          "sunrise", "sunset", "daylight_duration"]}
    for d in range(DAYS):
        s = slice(d * 24, d * 24 + 24); day = d0 + dt.timedelta(days=d)
        D["time"].append(day.strftime("%Y-%m-%d")); D["weather_code"].append(max(H["weather_code"][s]))
        D["temperature_2m_max"].append(max(H["temperature_2m"][s])); D["temperature_2m_min"].append(min(H["temperature_2m"][s]))
        D["apparent_temperature_max"].append(max(H["apparent_temperature"][s])); D["precipitation_sum"].append(round(sum(H["precipitation"][s]), 1))
        D["precipitation_hours"].append(sum(1 for v in H["precipitation"][s] if v >= 0.1)); D["precipitation_probability_max"].append(None)
        D["wind_speed_10m_max"].append(max(H["wind_speed_10m"][s])); D["wind_gusts_10m_max"].append(max(H["wind_gusts_10m"][s]))
        D["uv_index_max"].append(max(H["uv_index"][s])); D["sunrise"].append(day.strftime("%Y-%m-%dT07:03")); D["sunset"].append(day.strftime("%Y-%m-%dT19:08"))
        D["daylight_duration"].append(43500)
    return D

def forecast(shift=0, scale=1.0, minutely=False, prob=True):
    H = hourly_block(shift, scale, prob); D = daily_from(H)
    i = now.hour
    cur = {"time": fmt(now.replace(minute=0)), "temperature_2m": H["temperature_2m"][i], "apparent_temperature": H["apparent_temperature"][i],
           "relative_humidity_2m": H["relative_humidity_2m"][i], "dew_point_2m": H["dew_point_2m"][i], "precipitation": H["precipitation"][i],
           "weather_code": H["weather_code"][i], "cloud_cover": H["cloud_cover"][i], "wind_speed_10m": H["wind_speed_10m"][i],
           "wind_gusts_10m": H["wind_gusts_10m"][i], "wind_direction_10m": H["wind_direction_10m"][i], "pressure_msl": H["pressure_msl"][i], "is_day": H["is_day"][i]}
    out = {"latitude": 3.15, "longitude": 101.7, "timezone": "Asia/Kuala_Lumpur", "hourly": H, "daily": D, "current": cur}
    if minutely:
        start = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
        ts = [start + dt.timedelta(minutes=15 * k) for k in range(12)]
        # rain arriving ~40 min from now, peaking then easing
        pr = [0, 0, 0, 0.3, 1.1, 2.4, 1.6, 0.6, 0.2, 0, 0, 0]
        out["minutely_15"] = {"time": [fmt(t) for t in ts], "precipitation": pr, "rain": pr, "weather_code": [3, 3, 3, 61, 63, 95, 63, 61, 61, 3, 3, 3]}
    return out

def models_fx():
    specs = {"ecmwf_ifs": (0, 1.0), "ecmwf_aifs025_single": (0, .6), "gfs_seamless": (1, 1.4), "ukmo_global_deterministic_10km": (-1, .9),
             "icon_global": (0, 1.2), "cma_grapes_global": (2, .7)}
    out = {}
    for m, (sh, sc) in specs.items():
        f = forecast(sh, sc)
        H = {k: f["hourly"][k][:168] for k in ["time", "temperature_2m", "precipitation", "relative_humidity_2m"]}
        H["temperature_2m"] = [round(v + sh * .3, 1) for v in H["temperature_2m"]]
        D = {k: f["daily"][k][:7] for k in ["time", "precipitation_sum", "temperature_2m_max", "temperature_2m_min"]}
        out[m] = {"hourly": H, "daily": D}
    return out

def ensemble():
    H = {"time": [fmt(t) for t in hours]}
    for m in range(51):
        sh = random.choice([-1, 0, 0, 1, 2]); sc = random.uniform(0, 1.6)
        f = hourly_block(sh, sc)
        k = "" if m == 0 else f"_member{m:02d}"
        H["temperature_2m" + k] = [round(v + random.uniform(-.6, .6), 1) for v in f["temperature_2m"]]
        H["precipitation" + k] = f["precipitation"]
    return {"hourly": H}

def air():
    ts = [d0 + dt.timedelta(hours=i) for i in range(72)]
    pm = [round(28 + 18 * math.sin(i / 9) + random.uniform(-3, 3), 1) for i in range(72)]
    return {"current": {"us_aqi": 84, "pm2_5": 31.4, "pm10": 44.0, "ozone": 52, "nitrogen_dioxide": 18, "carbon_monoxide": 310},
            "hourly": {"time": [fmt(t) for t in ts], "pm2_5": pm, "us_aqi": [round(p * 2.4) for p in pm]}}

def warnings():
    vf = now - dt.timedelta(hours=1); vt = now + dt.timedelta(hours=4)
    return [{"warning_issue": {"issued": vf.isoformat(), "title_bm": "Amaran Ribut Petir", "title_en": "Thunderstorm Warning"},
             "valid_from": vf.isoformat(), "valid_to": vt.isoformat(), "heading_en": "Thunderstorms, heavy rain and strong winds",
             "text_en": "Thunderstorms, heavy rain and strong winds are expected in Kuala Lumpur, Putrajaya and Selangor (Petaling, Hulu Langat, Gombak) until 6pm.",
             "instruction_en": None}]

def met():
    rows = []
    fc = [("Ribut petir di beberapa tempat", "Ribut petir di beberapa tempat", "Tiada hujan"), ("Tiada hujan", "Hujan di beberapa tempat", "Tiada hujan"),
          ("Tiada hujan", "Ribut petir di satu dua tempat", "Tiada hujan"), ("Berjerebu", "Ribut petir di kebanyakan tempat", "Hujan di satu dua tempat")]
    for i, (m, a, n) in enumerate(fc):
        day = (d0 + dt.timedelta(days=i)).strftime("%Y-%m-%d")
        rows.append({"location": {"location_id": "Ds020", "location_name": "Kuala Lumpur"}, "date": day, "morning_forecast": m,
                     "afternoon_forecast": a, "night_forecast": n, "summary_forecast": a, "summary_when": "Petang", "min_temp": 24, "max_temp": 33})
    return rows

def radar():
    base = int(now.timestamp()) // 600 * 600
    past = [{"time": base - 600 * k, "path": f"/v2/radar/{base - 600 * k}"} for k in range(12, -1, -1)]
    cast = [{"time": base + 600 * k, "path": f"/v2/radar/nowcast_{base + 600 * k}"} for k in range(1, 7)]
    return {"version": "2.0", "generated": base, "host": "https://tiles.example.test", "radar": {"past": past, "nowcast": cast}}

files = {"forecast_model.json": forecast(prob=False), "forecast_best.json": forecast(minutely=True), "models.json": models_fx(),
         "ensemble.json": ensemble(), "air.json": air(), "warnings.json": warnings(), "met.json": met(), "radar.json": radar(),
         "geocode.json": {"results": [{"name": "Petaling Jaya", "latitude": 3.107, "longitude": 101.606, "admin1": "Selangor", "admin2": "Petaling"},
                                      {"name": "Putrajaya", "latitude": 2.926, "longitude": 101.696, "admin1": "Putrajaya"}]}}
for n, v in files.items():
    json.dump(v, open(os.path.join(OUT, n), "w"))
print("ok", list(files))
