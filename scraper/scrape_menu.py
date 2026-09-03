#!/usr/bin/env python3
"""Scrape the UC Berkeley dining menus for Cafe 3, Clark Kerr and Crossroads.

The menu page (https://dining.berkeley.edu/menus/) is a WordPress site running a
custom "cal-dining" plugin. The menu markup is server-rendered into the initial
HTML response (verified by fetching the raw page with no JS), so a plain
requests + BeautifulSoup pass is enough -- no headless browser required.

DOM shape the CSS pass targets (real structure, inspected live):

    div.cal-dining-wrap
      div.cafe-wrap
        ul.cafe-location
          li.location-name <name tokens> <YYYYMMDD>
            div.location-title
              span.cafe-title            -> "Cafe 3" / "Clark Kerr" / "Crossroads"
              span.status "Now Open"      -> class is "status Now Open" / "status Now Closed"
            div.status-period-wrap
              div.cafe-status
                span.serve-date "Wed, Sep 2"
              ul.meal-period
                li.preiod-name <meal>     -> first <span> text is e.g. "Fall - Breakfast"
                  div.recipes-main-wrap
                    div.cat-name
                      span                -> station name, e.g. "Center Plate"
                      ul.recipe-name
                        li.recip          -> first <span> child is the dish name
                          span            -> "Scrambled Eggs"
                          span.icons-wrap -> allergen icons (ignored)

If the CSS selectors ever stop matching, a text-heuristic fallback re-parses the
visible text of the same page:
  * location headers are a known name followed by "Now Open" / "Now Closed"
  * meal headers look like "Fall - Breakfast"
  * dish lines are short standalone strings

Output (menu.json):
    {
      "date": "2026-09-02",
      "generated_at": "2026-09-02T14:03:11Z",
      "source": "css",              # or "heuristic"
      "menu": {
        "Cafe 3":     {"breakfast": [...], "lunch": [...], "dinner": [...]},
        "Clark Kerr": {"breakfast": [...], "lunch": [...], "dinner": [...]},
        "Crossroads": {"breakfast": [...], "lunch": [...], "dinner": [...]}
      }
    }
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup

MENU_URL = "https://dining.berkeley.edu/menus/"

# Canonical output names keyed by a normalised (lowercased, de-accented) match.
TARGET_LOCATIONS: Dict[str, str] = {
    "cafe 3": "Café 3",
    "cafe3": "Café 3",
    "clark kerr": "Clark Kerr",
    "clark kerr campus": "Clark Kerr",
    "crossroads": "Crossroads",
    "foothill": "Foothill",
}

# Output order for menu.json / the app's hall pills.
OUTPUT_LOCATIONS = ("Café 3", "Clark Kerr", "Crossroads", "Foothill")

MEALS = ("breakfast", "lunch", "dinner")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 fuel-train-scraper/1.0"
)

# Lines that are nav chrome, allergen-icon tooltips or carbon-footprint labels --
# not real dishes. Only used by the heuristic fallback to cut down on noise.
_HEURISTIC_STOPWORDS = {
    "location", "meal", "date", "filters", "yesterday", "today", "tomorrow",
    "home", "menus", "now open", "now closed", "include", "exclude", "reset",
    # allergen / diet icon tooltips rendered as text
    "egg", "milk", "wheat", "gluten", "soy", "soybeans", "fish", "shellfish",
    "peanuts", "tree nuts", "tree-nuts", "sesame", "pork", "beef", "alcohol",
    "halal", "kosher", "vegetarian", "vegetarian option", "vegan", "vegan option",
    "vegetarian-option", "vegan-option",
    # carbon footprint badges
    "low carbon footprint", "medium carbon footprint", "high carbon footprint",
    "co2",
}


def _norm(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("é", "e").replace("è", "e").replace("ç", "c")
    s = re.sub(r"\s+", " ", s)
    return s


def _canonical_location(raw: str) -> Optional[str]:
    return TARGET_LOCATIONS.get(_norm(raw))


def _meal_bucket(label: str) -> Optional[str]:
    low = label.lower()
    if "breakfast" in low:
        return "breakfast"
    if "lunch" in low or "brunch" in low:
        return "lunch"
    if "dinner" in low:
        return "dinner"
    return None  # "Fall - All Day" and anything else is skipped


def _looks_like_dish(text: str) -> bool:
    if not text:
        return False
    if len(text) < 2 or len(text) > 90:
        return False
    if _norm(text) in _HEURISTIC_STOPWORDS:
        return False
    # Marketing blurbs for the corner stores are full sentences.
    if text.count(". ") >= 1 or text.endswith("."):
        return False
    if re.search(r"\b(a\.m\.|p\.m\.)\b", text.lower()):
        return False
    if re.match(r"^\d{1,2}:\d{2}", text):
        return False
    return True


def _empty_menu() -> Dict[str, Dict[str, List[str]]]:
    return {loc: {m: [] for m in MEALS} for loc in OUTPUT_LOCATIONS}


def _dedupe(seq: List[str]) -> List[str]:
    seen = set()
    out = []
    for item in seq:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


# --------------------------------------------------------------------------- #
# Primary strategy: real CSS selectors
# --------------------------------------------------------------------------- #
def parse_css(soup: BeautifulSoup) -> tuple[Dict[str, Dict[str, List[str]]], Optional[str]]:
    menu = _empty_menu()
    page_date: Optional[str] = None

    for loc_li in soup.select("li.location-name"):
        title_el = loc_li.select_one(".location-title .cafe-title") or loc_li.select_one(".cafe-title")
        if not title_el:
            continue
        canonical = _canonical_location(title_el.get_text(strip=True))
        if canonical is None:
            continue

        # The 8-digit token in the <li> class list is the served date (YYYYMMDD).
        for token in loc_li.get("class", []):
            if re.fullmatch(r"\d{8}", token):
                page_date = f"{token[0:4]}-{token[4:6]}-{token[6:8]}"
                break

        for period in loc_li.select("ul.meal-period > li.preiod-name"):
            label = _period_label(period)
            bucket = _meal_bucket(label)
            if bucket is None:
                continue
            dishes: List[str] = []
            for recip in period.select("div.cat-name ul.recipe-name > li.recip"):
                name_span = recip.find("span", recursive=False)
                text = (name_span.get_text(" ", strip=True) if name_span
                        else recip.get_text(" ", strip=True))
                text = re.sub(r"\s+", " ", text).strip()
                if text and _looks_like_dish(text):
                    dishes.append(text)
            menu[canonical][bucket].extend(dishes)

    for loc in menu:
        for m in MEALS:
            menu[loc][m] = _dedupe(menu[loc][m])
    return menu, page_date


def _period_label(period) -> str:
    span = period.find("span", recursive=False)
    if span:
        # first text node only -- skips the nested .accordion-icon span
        txt = span.find(string=True, recursive=False)
        if txt and txt.strip():
            return txt.strip()
        got = span.get_text(" ", strip=True)
        if got:
            return got
    # fall back to the class list: "preiod-name Fall - Breakfast"
    classes = [c for c in period.get("class", []) if c != "preiod-name"]
    return " ".join(classes).strip()


# --------------------------------------------------------------------------- #
# Fallback strategy: text heuristics
# --------------------------------------------------------------------------- #
def parse_heuristic(soup: BeautifulSoup) -> Dict[str, Dict[str, List[str]]]:
    menu = _empty_menu()
    text = soup.get_text("\n")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]

    current_loc: Optional[str] = None
    current_meal: Optional[str] = None
    all_target_names = {_norm(k) for k in TARGET_LOCATIONS}

    for i, ln in enumerate(lines):
        n = _norm(ln)

        # Location header: a known name, usually followed by an open/closed status.
        if n in all_target_names:
            nxt = _norm(lines[i + 1]) if i + 1 < len(lines) else ""
            if nxt.startswith("now open") or nxt.startswith("now closed") or True:
                current_loc = _canonical_location(ln)
                current_meal = None
                continue

        # Meal header like "Fall - Breakfast".
        if re.match(r"^(fall|spring|summer|winter)\s*-\s*", n) or n in {
            "breakfast", "lunch", "dinner", "brunch",
        }:
            current_meal = _meal_bucket(ln)
            continue

        if n in ("now open", "now closed"):
            continue

        if current_loc and current_meal and _looks_like_dish(ln):
            menu[current_loc][current_meal].append(ln)

    for loc in menu:
        for m in MEALS:
            menu[loc][m] = _dedupe(menu[loc][m])
    return menu


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #
def _total_dishes(menu: Dict[str, Dict[str, List[str]]]) -> int:
    return sum(len(v) for loc in menu.values() for v in loc.values())


def scrape(url: str = MENU_URL, html: Optional[str] = None) -> dict:
    if html is None:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        resp.raise_for_status()
        html = resp.text

    soup = BeautifulSoup(html, "html.parser")

    menu, page_date = parse_css(soup)
    source = "css"

    # If the CSS pass came back thin, retry with the text heuristic and keep
    # whichever produced more dishes.
    if _total_dishes(menu) < 15:
        heur = parse_heuristic(soup)
        if _total_dishes(heur) > _total_dishes(menu):
            menu, source = heur, "heuristic"

    date_str = page_date or dt.date.today().isoformat()
    return {
        "date": date_str,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source,
        "menu": menu,
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="menu.json", help="output path (default: menu.json)")
    ap.add_argument("--url", default=MENU_URL, help="menu page URL")
    ap.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    ap.add_argument("--print", action="store_true", dest="do_print", help="print JSON to stdout")
    ap.add_argument(
        "--allow-empty",
        action="store_true",
        help="write output even if no dishes were found (default: fail without writing)",
    )
    args = ap.parse_args(argv)

    html = None
    if args.from_file:
        with open(args.from_file, "r", encoding="utf-8") as fh:
            html = fh.read()

    try:
        result = scrape(args.url, html=html)
    except Exception as exc:  # noqa: BLE001 -- surface any failure to the Action log
        print(f"ERROR: scrape failed: {exc}", file=sys.stderr)
        return 2

    total = _total_dishes(result["menu"])
    per_loc = {
        loc: {m: len(result["menu"][loc][m]) for m in MEALS} for loc in result["menu"]
    }
    print(
        f"scraped {total} dishes  date={result['date']}  source={result['source']}",
        file=sys.stderr,
    )
    print(json.dumps(per_loc, indent=2, ensure_ascii=False), file=sys.stderr)

    if total == 0 and not args.allow_empty:
        print(
            "ERROR: zero dishes parsed -- refusing to overwrite menu.json "
            "(selectors may have broken). Re-run with --allow-empty to force.",
            file=sys.stderr,
        )
        return 1

    if args.do_print:
        print(json.dumps(result, indent=2, ensure_ascii=False))

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
