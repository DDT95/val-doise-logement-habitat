#!/usr/bin/env python3
"""Extrait les ventes DVF 2023-2025 en points géolocalisés (prix au m²).

Même filtre de qualité que build_market.py : ventes simples uniquement
(un seul bien par mutation), bornes de plausibilité 300-25000 €/m².
Coordonnées déjà en WGS84 dans DVF géolocalisé, pas de reprojection.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "dvf"
PROCESSED = ROOT / "data" / "processed"


def num(value):
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def main():
    features = []
    for year in (2023, 2024, 2025):
        path = RAW / f"dvf_95_{year}.csv"
        if not path.exists():
            continue
        with open(path, encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            mutation_count = defaultdict(int)
            for r in rows:
                mutation_count[r["id_mutation"]] += 1
            for r in rows:
                if r["nature_mutation"] != "Vente" or r["type_local"] not in ("Maison", "Appartement"):
                    continue
                if mutation_count[r["id_mutation"]] != 1:
                    continue
                valeur = num(r["valeur_fonciere"])
                surface = num(r["surface_reelle_bati"])
                lon, lat = num(r["longitude"]), num(r["latitude"])
                if not valeur or not surface or surface < 9 or not lon or not lat:
                    continue
                prix_m2 = valeur / surface
                if prix_m2 < 300 or prix_m2 > 25000:
                    continue
                features.append({
                    "type": "Feature",
                    "properties": {"p": round(prix_m2), "t": r["type_local"][0], "y": year},
                    "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                })

    out = {"type": "FeatureCollection", "features": features}
    json.dump(out, open(PROCESSED / "dvf_points.geojson", "w"), separators=(",", ":"))
    print(f"{len(features)} ventes géolocalisées 2023-2025.")


if __name__ == "__main__":
    main()
