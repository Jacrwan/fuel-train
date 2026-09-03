# Fuel / Train

A phone-first PWA with two tabs — **Fuel** (macro-targeted meal plans from UC Berkeley
dining-hall menus, grounded in USDA data) and **Train** (a program + day-based lifting
tracker with an AI coach). Static site, hosted on GitHub Pages. No backend.

```
scraper/scrape_menu.py        daily menu scraper  ->  menu.json
.github/workflows/scrape-menu.yml   runs it twice a day, commits menu.json
index.html + css/ + js/       the app
manifest.json + sw.js         installable / offline app shell
menu.json                     latest scraped menu (committed by the Action)
```

## 1. Menu scraper

Scrapes `https://dining.berkeley.edu/menus/` for **Café 3, Clark Kerr, Crossroads**
(breakfast / lunch / dinner). The page is server-rendered WordPress + the "cal-dining"
plugin, so a plain `requests` + `BeautifulSoup` pass is enough — no headless browser.

- **Primary:** real CSS selectors — `li.location-name > .cafe-title`, `li.preiod-name`
  (yes, the site misspells "period"), `div.cat-name > span`, `li.recip > span`.
- **Fallback:** text heuristics — location = a known name near "Now Open/Closed",
  meal = `Fall - Breakfast`, dishes = short standalone lines. Used automatically if the
  CSS pass returns almost nothing.

Run locally:

```bash
python3 -m venv .venv && .venv/bin/pip install -r scraper/requirements.txt
.venv/bin/python scraper/scrape_menu.py --out menu.json --print
```

Output:

```json
{
  "date": "2026-09-02",
  "generated_at": "2026-09-02T22:00:11Z",
  "source": "css",
  "menu": {
    "Café 3":     { "breakfast": ["Scrambled Eggs", ...], "lunch": [...], "dinner": [...] },
    "Clark Kerr": { ... },
    "Crossroads": { ... }
  }
}
```

The scraper exits non-zero **without** overwriting `menu.json` if it parses zero dishes,
so a broken-selector day doesn't wipe a good menu. Force with `--allow-empty`.

The GitHub Action (`.github/workflows/scrape-menu.yml`) runs at 13:00 and 22:00 UTC
(≈ 6am / 3pm Pacific) plus on demand, and commits `menu.json` back to the repo.

## 2. Fuel tab

- Editable macro targets (default `2000 kcal / 190 P / 175 C / 60 F` — a 180→165 lb
  aggressive cut, high protein).
- Pick a dining hall + meals, hit **Generate meal plan**:
  1. Every unique dish for that selection is looked up in the
     [USDA FoodData Central API](https://fdc.nal.usda.gov/api-key-signup) for real
     per-100 g macros (results cached locally). `DEMO_KEY` works but rate-limits fast —
     add your own free key in **Settings**.
  2. The menu + USDA data + your targets go to the Anthropic API
     (`claude-sonnet-4-6`), which returns specific dishes and portions as JSON.
- Each item is tagged **USDA** (green) or **AI est.** (amber). Totals show the delta
  vs. target.

## 3. Train tab

One JSON blob in `localStorage` (`fueltrain.v1`): `program` (keyed `monday`..`sunday`,
each an array of `{id, name, targetSets, targetReps}`) and `logs`
(`"YYYY-MM-DD" -> { exerciseId: [{weight, reps}] }`).

- Opens on **today**, auto-detected, showing only today's exercises.
- Each exercise shows its **last logged session inline** (`last · Aug 26: 180×8, 180×8, 180×7`).
- Quick `weight + reps` entry with **Add set** — appends and clears, no typing exercise
  names mid-workout. Running `2/4 sets` tally.
- Mon–Sun pills to view / retro-log other days (retro-log targets the most recent past
  date for that weekday).
- Tap an exercise name → last ~10 sessions (date, top set, volume).
- **Edit day** to add / reorder / edit / delete exercises.

## 4. AI actions (Settings → Anthropic API key)

All three use the same request shape (`POST https://api.anthropic.com/v1/messages`,
`anthropic-dangerous-direct-browser-access: true`).

- **Generate / update program** — current program + last ~2 weeks of logs + your
  stats/goal → updated weekly program. Shows a **diff preview**; nothing is overwritten
  until you tap *Replace*.
- **Analyze progress** — last ~5 weeks of logs → a short written assessment.
- **Meal plan** — action #2 above.

> **Key handling:** the USDA and Anthropic keys live only in this browser's
> `localStorage` and are sent directly to those APIs. This is fine for personal
> single-user use; anyone with access to the unlocked phone can read them. There is no
> server to proxy through on GitHub Pages.

## 5. Install

`manifest.json` + `sw.js` (precache app shell, network-first for `menu.json`).
Service workers need HTTPS — they don't register on `file://` or inside sandboxed
previews, but do on GitHub Pages. Verify **Add to Home Screen** in iOS Safari (Share →
Add to Home Screen) and Android Chrome (install prompt / ⋮ menu).

---

## Deploy (one time)

```bash
# from this directory
git init && git add -A && git commit -m "initial: scraper + Fuel/Train PWA"

# create the repo (pick one)
gh repo create fuel-train --public --source=. --push          # needs: brew install gh && gh auth login
#   …or make an empty repo on github.com, then:
# git remote add origin https://github.com/<you>/fuel-train.git && git branch -M main && git push -u origin main
```

Then on GitHub:

1. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main` / `/ (root)`.
2. **Settings → Actions → General →** Workflow permissions: *Read and write* (lets the
   scraper commit `menu.json`).
3. **Actions →** run *Scrape dining menu* once manually to seed a fresh `menu.json`.

App is then at `https://<you>.github.io/fuel-train/`. The app fetches `menu.json`
relatively, so it just works once Pages is live.
