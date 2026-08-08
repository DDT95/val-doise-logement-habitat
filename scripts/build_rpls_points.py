#!/usr/bin/env python3
"""Extrait les bâtiments de logements sociaux RPLS en points géolocalisés.

Dédoublonne au niveau bâtiment (même X/Y) plutôt qu'au niveau logement
individuel : RPLS livre des coordonnées par bâtiment, un immeuble collectif
compte souvent des dizaines de logements sur le même point. Coordonnées
fournies en Lambert-93 (EPSG:2154) par RPLS, reprojetées en WGS84.

RPLS ne diffuse pas l'identité du bailleur propriétaire : ce champ reste
absent, jamais inventé, plutôt que masqué silencieusement côté front.
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

FINANCEMENT_BUCKETS = {
    "ts": {"PLA d’intégration/LLTS dans les DOM", "PLA Loyer Minoré / PLA Très Social / PLA Insertion"},
    "s": {"HLM/O", "PLA ordinaire", "PLUS/LLS dans les DOM", "HBM"},
    "i": {"PLS/PPLS/PCLS/PLA CFF", "PLI", "ILN", "ILM"},
}


def financement_bucket(libelle):
    for bucket, labels in FINANCEMENT_BUCKETS.items():
        if libelle in labels:
            return bucket
    return "a" if libelle else None


def main():
    communes = json.load(open(PROCESSED / "communes95.json"))
    name_by_code = {c["code"]: c["name"] for c in communes}

    path = RAW / "rpls_95.csv"
    buildings = defaultdict(lambda: {
        "count": 0, "commune": None, "adresse": None, "type": defaultdict(int),
        "dpe": defaultdict(int), "fin": defaultdict(int), "annees": [],
    })
    with open(path, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        for row in reader:
            x, y = row[idx["X"]], row[idx["Y"]]
            if not x or not y:
                continue
            key = (x, y)
            b = buildings[key]
            b["count"] += 1
            b["commune"] = row[idx["DEPCOM"]]
            if not b["adresse"]:
                numvoie = row[idx["NUMVOIE"]].strip()
                typvoie = row[idx["TYPVOIE"]].strip()
                nomvoie = row[idx["NOMVOIE"]].strip()
                b["adresse"] = " ".join(p for p in (numvoie, typvoie, nomvoie) if p)
            typeconst = row[idx["TYPECONST_LIBELLE"]].strip()
            if typeconst:
                b["type"][typeconst] += 1
            dpe = row[idx["DPEENERGIE"]].strip()
            if dpe in ("A", "B", "C", "D", "E", "F", "G"):
                b["dpe"][dpe] += 1
            bucket = financement_bucket(row[idx["FINAN_LIBELLE"]].strip())
            if bucket:
                b["fin"][bucket] += 1
            construct = row[idx["CONSTRUCT"]].strip()
            if construct.isdigit():
                b["annees"].append(int(construct))

    features = []
    for (x, y), b in buildings.items():
        lon, lat = transformer.transform(float(x), float(y))
        dominant_type = max(b["type"], key=b["type"].get) if b["type"] else None
        props = {
            "n": b["count"],
            "c": b["commune"],
            "cn": name_by_code.get(b["commune"], b["commune"]),
            "a": b["adresse"] or None,
            "t": dominant_type,
        }
        if b["dpe"]:
            props["dpe"] = dict(b["dpe"])
        if b["fin"]:
            props["fin"] = dict(b["fin"])
        if b["annees"]:
            props["ymin"] = min(b["annees"])
            props["ymax"] = max(b["annees"])
        features.append({
            "type": "Feature",
            "properties": props,
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        })

    out = {"type": "FeatureCollection", "features": features}
    json.dump(out, open(PROCESSED / "rpls_points.geojson", "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"{len(features)} bâtiments RPLS géolocalisés (sur {sum(b['count'] for b in buildings.values())} logements).")


if __name__ == "__main__":
    main()
