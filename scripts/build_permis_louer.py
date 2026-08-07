#!/usr/bin/env python3
"""Reprojette et documente les zones "permis de louer" en Lambert-93 vers WGS84.

Couverture connue à ce jour : uniquement les zones publiées en open data par la
CA Plaine Vallée (Andilly, Groslay, Montmagny, Saint-Gratien et alentours).
D'autres communes ou EPCI du Val-d'Oise peuvent avoir instauré un permis de
louer par arrêté sans avoir publié de zonage géographique ouvert — ne pas
présenter cette couche comme exhaustive.
"""
import json
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "permis_louer"
PROCESSED = ROOT / "data" / "processed"

transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def reproject_coords(coords):
    if isinstance(coords[0], (int, float)):
        lon, lat = transformer.transform(coords[0], coords[1])
        return [lon, lat]
    return [reproject_coords(c) for c in coords]


def main():
    communes = json.load(open(PROCESSED / "communes95.json"))
    name_by_code = {c["code"]: c["name"] for c in communes}

    src = json.load(open(RAW / "permis_louer_plainevallee.geojson"))
    features = []
    for f in src["features"]:
        code = f["properties"].get("CODE_INSEE")
        features.append({
            "type": "Feature",
            "properties": {
                "code_commune": code,
                "nom_commune": name_by_code.get(code, code),
                "date_deliberation": f["properties"].get("DATE_DELIB"),
                "source": "CA Plaine Vallée, open data",
            },
            "geometry": {
                "type": f["geometry"]["type"],
                "coordinates": reproject_coords(f["geometry"]["coordinates"]),
            },
        })

    out = {"type": "FeatureCollection", "features": features}
    json.dump(out, open(PROCESSED / "permis_louer.geojson", "w"), ensure_ascii=False)
    communes_couvertes = sorted({f["properties"]["nom_commune"] for f in features})
    print(f"{len(features)} zones, communes couvertes : {', '.join(communes_couvertes)}")


if __name__ == "__main__":
    main()
