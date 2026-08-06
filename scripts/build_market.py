#!/usr/bin/env python3
"""Construit market_profiles.json : prix au m², loyers, dynamique du marché.

Méthodologie DVF : on ne garde que les ventes simples (un seul lot, un seul
bien Maison ou Appartement par mutation) pour éviter qu'une mutation
multi-biens ne fausse le prix au m². Médiane (pas moyenne) par commune,
sur les trois dernières années disponibles regroupées pour limiter les
petits effectifs. Les communes avec moins de 5 ventes exploitables ne
reçoivent aucune valeur (pas d'extrapolation trompeuse).
"""
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

MIN_SALES_FOR_MEDIAN = 5


def num(value):
    if value is None:
        return None
    s = str(value).strip()
    if s in ("", "NA", "-"):
        return None
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def load_dvf_year(year):
    path = RAW / "dvf" / f"dvf_95_{year}.csv"
    if not path.exists():
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        mutation_local_count = defaultdict(int)
        raw_rows = list(reader)
        for r in raw_rows:
            mutation_local_count[r["id_mutation"]] += 1
        for r in raw_rows:
            if r["nature_mutation"] != "Vente":
                continue
            if r["type_local"] not in ("Maison", "Appartement"):
                continue
            if mutation_local_count[r["id_mutation"]] != 1:
                continue  # mutation multi-lots : prix non attribuable à ce seul bien
            valeur = num(r["valeur_fonciere"])
            surface = num(r["surface_reelle_bati"])
            if not valeur or not surface or surface < 9:
                continue
            prix_m2 = valeur / surface
            if prix_m2 < 300 or prix_m2 > 25000:
                continue  # bornes de plausibilité, hors DVF (erreurs de saisie connues)
            rows.append({
                "code_commune": r["code_commune"],
                "type_local": r["type_local"],
                "prix_m2": prix_m2,
                "year": year,
            })
    return rows


def summarize(rows, years, label_year="2023-2025"):
    recent_years = {2023, 2024, 2025}
    recent = [r for r in rows if r["year"] in recent_years]
    prix_m2_vals = [r["prix_m2"] for r in recent]
    maison_vals = [r["prix_m2"] for r in recent if r["type_local"] == "Maison"]
    appart_vals = [r["prix_m2"] for r in recent if r["type_local"] == "Appartement"]
    volumes_by_year = defaultdict(int)
    for r in rows:
        volumes_by_year[r["year"]] += 1
    return {
        "prix_m2_median": {
            "value": statistics.median(prix_m2_vals) if len(prix_m2_vals) >= MIN_SALES_FOR_MEDIAN else None,
            "unit": "€/m²", "year": label_year, "source": "dvf",
            "denominator": len(prix_m2_vals),
            "quality_flag": "ok" if len(prix_m2_vals) >= MIN_SALES_FOR_MEDIAN else "missing",
        },
        "prix_m2_maison_median": {
            "value": statistics.median(maison_vals) if len(maison_vals) >= MIN_SALES_FOR_MEDIAN else None,
            "unit": "€/m²", "year": label_year, "source": "dvf",
            "denominator": len(maison_vals),
            "quality_flag": "ok" if len(maison_vals) >= MIN_SALES_FOR_MEDIAN else "missing",
        },
        "prix_m2_appartement_median": {
            "value": statistics.median(appart_vals) if len(appart_vals) >= MIN_SALES_FOR_MEDIAN else None,
            "unit": "€/m²", "year": label_year, "source": "dvf",
            "denominator": len(appart_vals),
            "quality_flag": "ok" if len(appart_vals) >= MIN_SALES_FOR_MEDIAN else "missing",
        },
        "ventes_par_an": {str(y): volumes_by_year.get(y, 0) for y in years},
    }


def build_dvf_profiles():
    years = [2021, 2022, 2023, 2024, 2025]
    all_rows = []
    for y in years:
        all_rows.extend(load_dvf_year(y))

    by_commune = defaultdict(list)
    for r in all_rows:
        by_commune[r["code_commune"]].append(r)

    profiles = {code: summarize(rows, years) for code, rows in by_commune.items()}
    return profiles, all_rows, years


def load_loyers(filename):
    path = RAW / "loyers" / filename
    data = {}
    with open(path, encoding="latin-1") as f:
        reader = csv.DictReader(f, delimiter=";")
        for r in reader:
            code = r["INSEE_C"]
            data[code] = {
                "loyer_m2": num(r["loypredm2"]),
                "loyer_m2_min": num(r["lwr.IPm2"]),
                "loyer_m2_max": num(r["upr.IPm2"]),
                "type_prediction": r["TYPPRED"],
                "nb_observations_commune": int(num(r["nbobs_com"]) or 0),
                "r2_ajuste": num(r["R2_adj"]),
            }
    return data


EMPTY_DVF = {
    "prix_m2_median": {"value": None, "unit": "€/m²", "year": "2023-2025", "source": "dvf", "denominator": 0, "quality_flag": "missing"},
    "prix_m2_maison_median": {"value": None, "unit": "€/m²", "year": "2023-2025", "source": "dvf", "denominator": 0, "quality_flag": "missing"},
    "prix_m2_appartement_median": {"value": None, "unit": "€/m²", "year": "2023-2025", "source": "dvf", "denominator": 0, "quality_flag": "missing"},
    "ventes_par_an": {},
}


def loyer_node(l):
    if not l or l["loyer_m2"] is None:
        return {"value": None, "unit": "€/m²/mois", "year": 2025, "source": "carte_des_loyers", "denominator": None, "quality_flag": "missing"}
    flag = "ok" if l["nb_observations_commune"] >= 30 else "secret"
    return {
        "value": l["loyer_m2"], "unit": "€/m²/mois", "year": 2025, "source": "carte_des_loyers",
        "denominator": l["nb_observations_commune"],
        "quality_flag": flag,
        "type_prediction": l["type_prediction"],
        "intervalle": [l["loyer_m2_min"], l["loyer_m2_max"]],
    }


def weighted_loyer(loyer_dict, member_codes):
    total_w = 0.0
    total_wv = 0.0
    for code in member_codes:
        l = loyer_dict.get(code)
        if l and l["loyer_m2"] is not None and l["nb_observations_commune"]:
            total_w += l["nb_observations_commune"]
            total_wv += l["loyer_m2"] * l["nb_observations_commune"]
    if not total_w:
        return {"value": None, "unit": "€/m²/mois", "year": 2025, "source": "carte_des_loyers", "denominator": 0, "quality_flag": "missing"}
    return {"value": total_wv / total_w, "unit": "€/m²/mois", "year": 2025, "source": "carte_des_loyers", "denominator": int(total_w), "quality_flag": "ok"}


def build_market_profiles():
    dvf, all_rows, years = build_dvf_profiles()
    loyers_app = load_loyers("loyers_app_95.csv")
    loyers_maison = load_loyers("loyers_maison_95.csv")

    communes = json.load(open(PROCESSED / "communes95.json"))
    codes = [c["code"] for c in communes]
    epcis = json.load(open(PROCESSED / "epcis95.json"))

    commune_profiles = {}
    for code in codes:
        d = dvf.get(code, EMPTY_DVF)
        commune_profiles[code] = {
            "prix_m2_median": d["prix_m2_median"],
            "prix_m2_maison_median": d["prix_m2_maison_median"],
            "prix_m2_appartement_median": d["prix_m2_appartement_median"],
            "ventes_par_an": d["ventes_par_an"],
            "loyer_m2_appartement": loyer_node(loyers_app.get(code)),
            "loyer_m2_maison": loyer_node(loyers_maison.get(code)),
        }

    epci_profiles = {}
    for epci_code, e in epcis.items():
        members_95 = [m for m in e["members"] if m.startswith("95")]
        rows = [r for r in all_rows if r["code_commune"] in members_95]
        summary = summarize(rows, years)
        epci_profiles[epci_code] = {
            **summary,
            "loyer_m2_appartement": weighted_loyer(loyers_app, members_95),
            "loyer_m2_maison": weighted_loyer(loyers_maison, members_95),
        }

    dept_summary = summarize(all_rows, years)
    dept_profile = {
        **dept_summary,
        "loyer_m2_appartement": weighted_loyer(loyers_app, codes),
        "loyer_m2_maison": weighted_loyer(loyers_maison, codes),
    }

    return commune_profiles, epci_profiles, dept_profile


if __name__ == "__main__":
    commune_profiles, epci_profiles, dept_profile = build_market_profiles()
    json.dump(commune_profiles, open(PROCESSED / "market_profiles.json", "w"), ensure_ascii=False, indent=1)
    json.dump(epci_profiles, open(PROCESSED / "market_epci_profiles.json", "w"), ensure_ascii=False, indent=1)
    json.dump(dept_profile, open(PROCESSED / "market_departement_profile.json", "w"), ensure_ascii=False, indent=1)
    with_price = sum(1 for p in commune_profiles.values() if p["prix_m2_median"]["value"] is not None)
    print(f"{len(commune_profiles)} communes, {len(epci_profiles)} EPCI, 1 synthèse départementale. Prix m² disponible pour {with_price} communes.")
