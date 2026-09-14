#!/usr/bin/env python3
"""Assemble spark-generated copy JSON into src/data/*.json with validation."""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
COPY = pathlib.Path("/tmp/copy")

OSCEOLA = ["kissimmee", "st-cloud", "poinciana", "celebration", "championsgate",
           "intercession-city", "campbell"]
ORANGE = ["orlando", "winter-park", "apopka", "ocoee", "winter-garden",
          "windermere", "maitland", "lake-buena-vista"]

# --- Research keyword map (research/market-research.md §2) -----------------
# Primary money keyword per city x service -> page title + H1.
CITY_KW = {
    "kissimmee": "Kissimmee", "st-cloud": "St Cloud", "poinciana": "Poinciana",
    "celebration": "Celebration", "championsgate": "ChampionsGate",
    "intercession-city": "Intercession City", "campbell": "Campbell",
    "orlando": "Orlando", "winter-park": "Winter Park", "apopka": "Apopka",
    "ocoee": "Ocoee", "winter-garden": "Winter Garden", "windermere": "Windermere",
    "maitland": "Maitland", "lake-buena-vista": "Lake Buena Vista",
}
SERVICE_HEAD = {
    "general-pest-control": "Pest Control",
    "termite-control": "Termite Control",
    "mosquito-control": "Mosquito Control",
    "rodent-control": "Rodent Control",
    "bed-bug-treatment": "Bed Bug Treatment",
    "wildlife-removal": "Wildlife Removal",
}
# Exact-primary exceptions from the research tables.
KW_EXCEPTIONS = {
    ("kissimmee", "termite-control"): "Termite Treatment Kissimmee FL",
    ("campbell", "general-pest-control"): "Exterminator in Campbell FL",
}
BED_BUG_EXTERMINATOR_CITIES = {"kissimmee", "poinciana", "intercession-city", "ocoee"}

def money_keyword(city_slug: str, service_slug: str) -> str:
    if (city_slug, service_slug) in KW_EXCEPTIONS:
        return KW_EXCEPTIONS[(city_slug, service_slug)]
    head = SERVICE_HEAD[service_slug]
    if service_slug == "bed-bug-treatment" and city_slug in BED_BUG_EXTERMINATOR_CITIES:
        head = "Bed Bug Exterminator"
    return f"{head} {CITY_KW[city_slug]} FL"

def combo_meta(kw: str, city_name: str) -> str:
    meta = (f"{kw} — local, licensed & insured pros serving {city_name}. "
            f"Free inspections, up-front pricing, same-day service.")
    return meta[:160]

PHONE_RE = re.compile(r"\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}")

def load(name):
    p = COPY / name
    raw = p.read_text()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # try to salvage: strip markdown fences if the model added them
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        return json.loads(cleaned)

def check_no_phones(obj, where):
    bad = []
    def walk(o, path):
        if isinstance(o, str):
            if PHONE_RE.search(o):
                bad.append(f"{path}: {o[:60]}")
        elif isinstance(o, dict):
            for k, v in o.items(): walk(v, f"{path}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o): walk(v, f"{path}[{i}]")
    walk(obj, where)
    return bad

def main():
    DATA.mkdir(parents=True, exist_ok=True)
    errors = []

    services = {"services": (
        load("services-a.json")["services"]
        + [load("svc-rodent.json")["services"][0]]
        + [load("svc-bedbug.json")["services"][0]]
        + [load("svc-wildlife.json")["services"][0]]
    )}
    assert len(services["services"]) == 6, f"expected 6 services, got {len(services['services'])}"
    for s in services["services"]:
        for key in ("slug", "name", "title", "metaDescription", "h1", "intro", "pests", "sections", "process", "faqs"):
            assert key in s, f"service {s.get('slug')} missing {key}"
    errors += check_no_phones(services, "services")
    (DATA / "services.json").write_text(json.dumps(services, indent=2, ensure_ascii=False))

    osc = load("cities.json")
    org = load("cities-orange.json")
    cities = osc["cities"] + org["cities"]
    assert len(cities) == 15, f"expected 15 cities, got {len(cities)}"
    for c in cities:
        for key in ("slug", "name", "title", "metaDescription", "h1", "intro",
                    "localPressure", "localPests", "areasServed", "sections", "faqs"):
            assert key in c, f"city {c.get('slug')} missing {key}"
        c["county"] = "Osceola County" if c["slug"] in OSCEOLA else "Orange County"
    errors += check_no_phones({"cities": cities}, "cities")
    # Campbell hub page: research says match the "Exterminator in Campbell FL" title.
    for c in cities:
        if c["slug"] == "campbell":
            c["title"] = "Exterminator in Campbell, FL | Osceola Pest Pros"
            c["h1"] = "Exterminator in Campbell, FL"
    (DATA / "cities.json").write_text(json.dumps({"cities": cities}, indent=2, ensure_ascii=False))

    # City x service money-keyword map -> titles, H1s, metas for the combo pages.
    services_by_slug = {s["slug"]: s for s in services["services"]}
    cities_by_slug = {c["slug"]: c for c in cities}
    keywords = {}
    for cslug, c in cities_by_slug.items():
        for sslug in services_by_slug:
            kw = money_keyword(cslug, sslug)
            keywords[f"{cslug}/{sslug}"] = {
                "title": f"{kw} | Osceola Pest Pros",
                "h1": kw,
                "meta": combo_meta(kw, c["name"]),
            }
    (DATA / "keywords.json").write_text(json.dumps(keywords, indent=2, ensure_ascii=False))
    print(f"keywords.json: {len(keywords)} city x service entries")

    home = load("home.json")
    assert "home" in home and "globalFaqs" in home and "reviews" in home
    # Correction: brand covers Osceola AND Orange counties.
    home["home"]["title"] = "Pest Control in Osceola & Orange Counties, FL | Osceola Pest Pros"
    home["home"]["metaDescription"] = ("Pest control in Osceola & Orange Counties, FL — roaches, ants, termites, "
        "rodents & more. Licensed & insured, free quotes, same-day service.")
    if "Osceola County" in home["home"].get("heroSub", "") and "Orange" not in home["home"]["heroSub"]:
        home["home"]["heroSub"] = home["home"]["heroSub"].replace(
            "Osceola County", "Osceola and Orange Counties")
    errors += check_no_phones(home, "home")
    (DATA / "home.json").write_text(json.dumps(home, indent=2, ensure_ascii=False))

    # word counts for a quick "not thin" sanity check
    wc = {}
    for s in services["services"]:
        text = " ".join(s["intro"] + [p for sec in s["sections"] for p in sec["body"]])
        wc[f"service:{s['slug']}"] = len(text.split())
    for c in cities:
        text = " ".join(c["intro"] + c["localPressure"]["body"] + [p for sec in c["sections"] for p in sec["body"]])
        wc[f"city:{c['slug']}"] = len(text.split())
    thin = {k: v for k, v in wc.items() if v < 250}
    print(json.dumps({"pages": len(wc), "thin_pages": thin}, indent=2))
    if errors:
        print("PHONE-LIKE STRINGS FOUND (review):", file=sys.stderr)
        for e in errors: print(" ", e, file=sys.stderr)
    print("ASSEMBLE OK")

if __name__ == "__main__":
    main()
