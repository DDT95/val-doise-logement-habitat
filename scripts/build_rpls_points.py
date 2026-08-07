#!/usr/bin/env python3
"""Extrait les bâtiments de logements sociaux RPLS en points géolocalisés.

Dédoublonne au niveau bâtiment (même X/Y) plutôt qu'au niveau logement
individuel : RPLS livre des coordonnées par bâtiment, un immeuble collectif
compte souvent des dizaines de logements sur le même point. Coordonnées
fournies en Lambert-93 (EPSG:2154) par RPLS, reprojetées en WGS84.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def main():
    path = RAW / "rpls_95.csv"
    buildings = defaultdict(lambda: {"count": 0, "commune": None})
    with open(path, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        for row in reader:
            x, y = row[idx["X"]], row[idx["Y"]]
            if not x or not y:
                continue
            key = (x, y)
            buildings[key]["count"] += 1
            buildings[key]["commune"] = row[idx["DEPCOM"]]

    features = []
    for (x, y), b in buildings.items():
        lon, lat = transformer.transform(float(x), float(y))
        features.append({
            "type": "Feature",
            "properties": {"n": b["count"], "c": b["commune"]},
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        })

    out = {"type": "FeatureCollection", "features": features}
    json.dump(out, open(PROCESSED / "rpls_points.geojson", "w"), separators=(",", ":"))
    print(f"{len(features)} bâtiments RPLS géolocalisés (sur {sum(b['count'] for b in buildings.values())} logements).")


if __name__ == "__main__":
    main()
