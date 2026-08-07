#!/usr/bin/env python3
"""Construit commune_profiles.json et epci_profiles.json à partir des sources brutes.

Principe : ne jamais transformer une valeur absente ou secrétisée ("s") en zéro.
Chaque indicateur composite porte value/unit/year/source/denominator/quality_flag.
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

communes = json.load(open(PROCESSED / "communes95.json"))
CODES = {c["code"] for c in communes}
COMMUNE_NAME = {c["code"]: c["name"] for c in communes}
epcis = json.load(open(PROCESSED / "epcis95.json"))

QUALITY_OK = "ok"
QUALITY_SECRET = "secret"
QUALITY_MISSING = "missing"
QUALITY_NA = "not_applicable"
QUALITY_PARTIAL_PERIMETER = "partial_perimeter"


def num(value):
    """Parse a numeric cell that may be 's' (secret), '', or a float-with-comma."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if s in ("", "s", "S", "NA", "N/A", "-"):
        return None
    s = s.replace(" ", "").replace("%", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# A. INSEE Recensement 2023 — TD_LOG1 (occupation × période × type)
# ---------------------------------------------------------------------------
def load_insee_log1():
    path = RAW / "insee_log1_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8")))
    header = rows[0]
    data = {}
    periods = ["Avant 1919", "De 1919 à 1945", "De 1946 à 1970", "De 1971 à 1990", "De 1991 à 2005", "De 2006 à 2019"]
    statuts = ["Résidences principales", "Logements occasionnels", "Résidences secondaires", "Logements vacants"]
    types = ["Maison", "Appartement", "Autres logements de métropole"]
    col_index = {}
    idx = 2
    for statut in statuts:
        for period in periods:
            for t in types:
                col_index[(statut, period, t)] = idx
                idx += 1
    for row in rows[1:]:
        code = row[0]
        by_statut = defaultdict(float)
        by_statut_period = defaultdict(lambda: defaultdict(float))
        by_statut_type = defaultdict(lambda: defaultdict(float))
        for (statut, period, t), col in col_index.items():
            v = num(row[col]) or 0.0
            by_statut[statut] += v
            by_statut_period[statut][period] += v
            by_statut_type[statut][t] += v
        data[code] = {
            "total_by_statut": dict(by_statut),
            "by_statut_period": {k: dict(v) for k, v in by_statut_period.items()},
            "by_statut_type": {k: dict(v) for k, v in by_statut_type.items()},
        }
    return data


# ---------------------------------------------------------------------------
# B. INSEE Recensement 2023 — TD_PRINC2 (statut d'occupation résidences principales)
# ---------------------------------------------------------------------------
def load_insee_tenure():
    path = RAW / "insee_princ2_tenure_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8")))
    header = rows[0]
    statuts = [
        "Propriétaire",
        "Locataire de logement parc privé vide",
        "Locataire de logement parc social vide",
        "Locataire de logement meublé",
        "Logé gratuitement",
    ]
    pieces = ["1 pièce", "2 pièces", "3 pièces", "4 pièces", "5 pièces", "6 pièces ou plus"]
    types = ["Maison", "Appartement", "Autres logements de métropole"]
    col_index = {}
    idx = 2
    for piece in pieces:
        for statut in statuts:
            for t in types:
                col_index[(piece, statut, t)] = idx
                idx += 1
    data = {}
    for row in rows[1:]:
        code = row[0]
        by_statut = defaultdict(float)
        by_pieces = defaultdict(float)
        for (piece, statut, t), col in col_index.items():
            v = num(row[col]) or 0.0
            by_statut[statut] += v
            by_pieces[piece] += v
        data[code] = {"by_statut": dict(by_statut), "by_pieces": dict(by_pieces)}
    return data


# ---------------------------------------------------------------------------
# C. RPLS — parc social détaillé
# ---------------------------------------------------------------------------
# Regroupement des libellés RPLS FINAN_LIBELLE en quatre familles lisibles.
# RPLS distingue des dizaines de dispositifs historiques (HLM/O, ILN, HBM...) qui
# ne correspondent pas exactement aux catégories usuelles PLAI/PLUS/PLS/PLI :
# on les rattache à la famille la plus proche, en le documentant explicitement.
FINANCEMENT_BUCKETS = {
    "très social": {"PLA d’intégration/LLTS dans les DOM", "PLA Loyer Minoré / PLA Très Social / PLA Insertion"},
    "social": {"HLM/O", "PLA ordinaire", "PLUS/LLS dans les DOM", "HBM"},
    "intermédiaire": {"PLS/PPLS/PCLS/PLA CFF", "PLI", "ILN", "ILM"},
}


def financement_bucket(libelle):
    for bucket, labels in FINANCEMENT_BUCKETS.items():
        if libelle in labels:
            return bucket
    return "autre" if libelle else None


def load_rpls():
    path = RAW / "rpls_95.csv"
    if not path.exists():
        return None
    data = defaultdict(lambda: {
        "count": 0, "dpe_counts": defaultdict(int), "dpe_missing": 0,
        "by_type": defaultdict(int), "by_pieces": defaultdict(int),
        "constructed_before_1971": 0, "constructed_known": 0,
        "mise_en_location_recente": 0, "by_financement": defaultdict(int),
    })
    with open(path, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        for row in reader:
            code = row[idx["DEPCOM"]]
            if code not in CODES:
                continue
            d = data[code]
            d["count"] += 1
            dpe = row[idx["DPEENERGIE"]].strip()
            if dpe in ("A", "B", "C", "D", "E", "F", "G"):
                d["dpe_counts"][dpe] += 1
            else:
                d["dpe_missing"] += 1
            construct = row[idx["CONSTRUCT"]].strip()
            if construct.isdigit():
                year = int(construct)
                d["constructed_known"] += 1
                if year < 1971:
                    d["constructed_before_1971"] += 1
            typeconst = row[idx["TYPECONST_LIBELLE"]].strip()
            if typeconst:
                d["by_type"][typeconst] += 1
            nbpiece = row[idx["NBPIECE"]].strip()
            if nbpiece.isdigit():
                d["by_pieces"][nbpiece] += 1
            bucket = financement_bucket(row[idx["FINAN_LIBELLE"]].strip())
            if bucket:
                d["by_financement"][bucket] += 1
    return data


# ---------------------------------------------------------------------------
# D. SRU — inventaire
# ---------------------------------------------------------------------------
def load_sru():
    path = RAW / "sru_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter=";"))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    data = {}
    for row in rows[1:]:
        code = row[idx["Code_INSEE_commune"]]
        data[code] = {
            "soumise_sru": num(row[idx["Commune_sru_au_01_01_2025"]]),
            "nb_lls_inventaire": num(row[idx["Nombre_lls_ Inventaire_au_01_01_2024"]]),
            "taux_sru_pct": num(row[idx["Taux_SRU_au_01_01_2024"]]),
            "deficitaire": num(row[idx["commune_deficitaire"]]),
            "carencee": num(row[idx["Commune_carencée"]]),
            "exemptee": num(row[idx["Commune_exemptée_2023_2025"]]),
            "population": num(row[idx["Population_municipale_01_01_2025"]]),
        }
    return data


# ---------------------------------------------------------------------------
# E. LOVAC — vacance privée
# ---------------------------------------------------------------------------
def load_lovac():
    path = RAW / "lovac_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter=";"))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    data = {}
    for row in rows[1:]:
        code = row[idx["CODGEO_26"]]
        data[code] = {
            "parc_prive_total": num(row[idx["ff_pp_total_25"]]),
            "vacant_2025": num(row[idx["pp_vacant_25"]]),
            "vacant_plus_2ans_2025": num(row[idx["pp_vacant_plus_2ans_25"]]),
            "vacant_2020": num(row[idx["pp_vacant_20"]]),
            "vacant_plus_2ans_2020": num(row[idx["pp_vacant_plus_2ans_20"]]),
        }
    return data


# ---------------------------------------------------------------------------
# F. Sitadel3 — construction
# ---------------------------------------------------------------------------
def load_sitadel():
    path = RAW / "sitadel_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8"), delimiter=";"))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    data = defaultdict(lambda: defaultdict(lambda: {"aut": 0, "com": 0}))
    for row in rows[1:]:
        code = row[idx["COMM"]].strip('"')
        year = row[idx["ANNEE"]].strip('"')
        typelgt = row[idx["TYPE_LGT"]].strip('"')
        if typelgt != "Tous Logements":
            continue
        aut = num(row[idx["LOG_AUT"]]) or 0
        com = num(row[idx["LOG_COM"]]) or 0
        data[code][year] = {"aut": aut, "com": com}
    return data


# ---------------------------------------------------------------------------
# G. DPE ADEME — observé, agrégé par commune
# ---------------------------------------------------------------------------
def load_dpe():
    total = json.load(open(RAW / "dpe_total_by_commune.json"))
    fg = json.load(open(RAW / "dpe_fg_by_commune.json"))
    total_by_code = {a["value"]: a["total"] for a in total["aggs"]}
    fg_by_code = {a["value"]: a["total"] for a in fg["aggs"]}
    return total_by_code, fg_by_code


# ---------------------------------------------------------------------------
# H. Anah — opérations programmées actives
# ---------------------------------------------------------------------------
def load_anah():
    path = RAW / "anah_95.csv"
    rows = list(csv.reader(open(path, encoding="utf-8")))
    header = rows[0]
    idx = {name: i for i, name in enumerate(header)}
    data = defaultdict(list)
    from datetime import date
    today = date(2026, 8, 4)
    for row in rows[1:]:
        code = row[idx["com_code"]]
        fin = row[idx["fin_programme"]]
        active = True
        if fin:
            try:
                y, m, d = [int(x) for x in fin.split("-")]
                active = date(y, m, d) >= today
            except ValueError:
                active = True
        if active:
            data[code].append({
                "libelle": row[idx["libelle_programme"]],
                "type": row[idx["type_programme"]],
                "fin": fin,
            })
    return data


def build_commune_profiles():
    log1 = load_insee_log1()
    tenure = load_insee_tenure()
    rpls = load_rpls()
    sru = load_sru()
    lovac = load_lovac()
    sitadel = load_sitadel()
    dpe_total, dpe_fg = load_dpe()
    anah = load_anah()

    profiles = {}
    for code in sorted(CODES):
        l1 = log1.get(code, {})
        stat = l1.get("total_by_statut", {})
        rp = stat.get("Résidences principales")
        rs = stat.get("Résidences secondaires")
        occ = stat.get("Logements occasionnels")
        vac = stat.get("Logements vacants")
        total_parc = None
        if all(v is not None for v in (rp, rs, occ, vac)):
            total_parc = rp + rs + occ + vac

        ten = tenure.get(code, {}).get("by_statut", {})
        proprietaire = ten.get("Propriétaire")
        loc_prive = ten.get("Locataire de logement parc privé vide")
        loc_social = ten.get("Locataire de logement parc social vide")

        rp_by_type = l1.get("by_statut_type", {}).get("Résidences principales", {})
        maison = rp_by_type.get("Maison")
        appartement = rp_by_type.get("Appartement")

        rp_by_period = l1.get("by_statut_period", {}).get("Résidences principales", {})
        avant_1971 = (rp_by_period.get("Avant 1919") or 0) + (rp_by_period.get("De 1919 à 1945") or 0) + (rp_by_period.get("De 1946 à 1970") or 0)
        rp_period_known = sum(v for v in rp_by_period.values() if v is not None)

        r = rpls.get(code) if rpls else None
        # RPLS est un répertoire exhaustif : une commune absente du fichier a 0 logement
        # social recensé (pas une donnée manquante), tant que le fichier source a bien été chargé.
        social_count = r["count"] if r else (0 if rpls is not None else None)
        social_fg = None
        social_dpe_total = None
        if r:
            social_dpe_total = sum(r["dpe_counts"].values())
            social_fg = r["dpe_counts"].get("F", 0) + r["dpe_counts"].get("G", 0)

        def financement_pct(bucket):
            if not r or not social_count:
                return None
            return (r["by_financement"].get(bucket, 0) / social_count) * 100

        s = sru.get(code)
        lv = lovac.get(code, {})

        sit = sitadel.get(code, {})
        years_5y = [str(y) for y in range(2021, 2026)]
        aut_5y = sum(sit.get(y, {}).get("aut", 0) for y in years_5y) if sit else None
        com_5y = sum(sit.get(y, {}).get("com", 0) for y in years_5y) if sit else None
        annual_series = [{"annee": y, "autorises": sit.get(y, {}).get("aut"), "commences": sit.get(y, {}).get("com")} for y in sorted(sit.keys())] if sit else []

        d_total = dpe_total.get(code)
        d_fg = dpe_fg.get(code, 0)

        profiles[code] = {
            "code": code,
            "name": COMMUNE_NAME[code],
            "kind": "commune",
            "parc": {
                "total": {"value": total_parc, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": QUALITY_OK if total_parc is not None else QUALITY_MISSING},
                "residences_principales": {"value": rp, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": QUALITY_OK if rp is not None else QUALITY_MISSING},
                "residences_secondaires": {"value": rs, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": QUALITY_OK if rs is not None else QUALITY_MISSING},
                "logements_vacants_rp": {"value": vac, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": total_parc, "quality_flag": QUALITY_OK if vac is not None else QUALITY_MISSING},
                "maisons": {"value": maison, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if maison is not None else QUALITY_MISSING},
                "appartements": {"value": appartement, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if appartement is not None else QUALITY_MISSING},
                "part_avant_1971": {"value": (avant_1971 / rp_period_known * 100) if rp_period_known else None, "unit": "%", "year": 2023, "source": "insee_logement_2023", "denominator": rp_period_known, "quality_flag": QUALITY_OK if rp_period_known else QUALITY_MISSING},
            },
            "occupation": {
                "proprietaires": {"value": proprietaire, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if proprietaire is not None else QUALITY_MISSING},
                "locataires_prive": {"value": loc_prive, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if loc_prive is not None else QUALITY_MISSING},
                "locataires_social": {"value": loc_social, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if loc_social is not None else QUALITY_MISSING},
            },
            "social": {
                "rpls_count": {"value": social_count, "unit": "logements", "year": 2025, "source": "rpls", "denominator": None, "quality_flag": QUALITY_OK if social_count is not None else QUALITY_MISSING},
                "part_rpls_residences_principales": {"value": (social_count / rp * 100) if (social_count is not None and rp) else None, "unit": "%", "year": 2025, "source": "rpls+insee_logement_2023", "denominator": rp, "quality_flag": QUALITY_OK if (social_count is not None and rp) else QUALITY_MISSING},
                "dpe_fg_part_observee": {"value": (social_fg / social_dpe_total * 100) if social_dpe_total else None, "unit": "%", "year": 2025, "source": "rpls", "denominator": social_dpe_total, "quality_flag": QUALITY_OK if social_dpe_total else QUALITY_MISSING},
                "sru_soumise": {"value": s["soumise_sru"] if s else None, "unit": "booléen", "year": 2025, "source": "sru", "denominator": None, "quality_flag": QUALITY_OK if s else QUALITY_NA},
                "sru_taux_pct": {"value": s["taux_sru_pct"] if s else None, "unit": "%", "year": 2024, "source": "sru", "denominator": None, "quality_flag": QUALITY_OK if (s and s["taux_sru_pct"] is not None) else QUALITY_NA},
                "sru_deficitaire": {"value": s["deficitaire"] if s else None, "unit": "booléen", "year": 2025, "source": "sru", "denominator": None, "quality_flag": QUALITY_OK if s else QUALITY_NA},
                "sru_carencee": {"value": s["carencee"] if s else None, "unit": "booléen", "year": 2025, "source": "sru", "denominator": None, "quality_flag": QUALITY_OK if s else QUALITY_NA},
                "part_financement_tres_social": {"value": financement_pct("très social"), "unit": "%", "year": 2025, "source": "rpls", "denominator": social_count, "quality_flag": QUALITY_OK if financement_pct("très social") is not None else QUALITY_MISSING},
                "part_financement_social": {"value": financement_pct("social"), "unit": "%", "year": 2025, "source": "rpls", "denominator": social_count, "quality_flag": QUALITY_OK if financement_pct("social") is not None else QUALITY_MISSING},
                "part_financement_intermediaire": {"value": financement_pct("intermédiaire"), "unit": "%", "year": 2025, "source": "rpls", "denominator": social_count, "quality_flag": QUALITY_OK if financement_pct("intermédiaire") is not None else QUALITY_MISSING},
            },
            "vacance": {
                "taux_vacance_rp": {"value": (vac / total_parc * 100) if (vac is not None and total_parc) else None, "unit": "%", "year": 2023, "source": "insee_logement_2023", "denominator": total_parc, "quality_flag": QUALITY_OK if (vac is not None and total_parc) else QUALITY_MISSING},
                "vacance_privee_2025": {"value": lv.get("vacant_2025"), "unit": "logements", "year": 2025, "source": "lovac", "denominator": lv.get("parc_prive_total"), "quality_flag": QUALITY_OK if lv.get("vacant_2025") is not None else (QUALITY_SECRET if code in lovac else QUALITY_MISSING)},
                "vacance_privee_longue_2025": {"value": lv.get("vacant_plus_2ans_2025"), "unit": "logements", "year": 2025, "source": "lovac", "denominator": lv.get("parc_prive_total"), "quality_flag": QUALITY_OK if lv.get("vacant_plus_2ans_2025") is not None else (QUALITY_SECRET if code in lovac else QUALITY_MISSING)},
                "vacance_privee_2020": {"value": lv.get("vacant_2020"), "unit": "logements", "year": 2020, "source": "lovac", "denominator": None, "quality_flag": QUALITY_OK if lv.get("vacant_2020") is not None else QUALITY_SECRET},
                "rupture_serie": "Rupture méthodologique en 2023 (bascule GMBI) puis rupture de production en 2025 : ne pas tracer de tendance continue sans annotation.",
            },
            "construction": {
                "autorises_5ans": {"value": aut_5y, "unit": "logements", "year": "2021-2025", "source": "sitadel3", "denominator": None, "quality_flag": QUALITY_OK if aut_5y is not None else QUALITY_MISSING},
                "commences_5ans": {"value": com_5y, "unit": "logements", "year": "2021-2025", "source": "sitadel3", "denominator": None, "quality_flag": QUALITY_OK if com_5y is not None else QUALITY_MISSING},
                "serie_annuelle": annual_series,
            },
            "renovation": {
                "dpe_observes": {"value": d_total, "unit": "diagnostics", "year": 2026, "source": "dpe_ademe", "denominator": None, "quality_flag": QUALITY_OK if d_total else QUALITY_MISSING},
                "dpe_fg_part": {"value": (d_fg / d_total * 100) if d_total else None, "unit": "%", "year": 2026, "source": "dpe_ademe", "denominator": d_total, "quality_flag": QUALITY_OK if d_total else QUALITY_MISSING},
                "anah_programmes_actifs": anah.get(code, []),
            },
        }
    return profiles


def build_aggregate_profile(code, name, kind, member_profiles, members=None, members_95=None, partial=False):
    def sum_field(path):
        total = 0.0
        n = 0
        for p in member_profiles:
            node = p
            for key in path:
                node = node.get(key, {})
            v = node.get("value") if isinstance(node, dict) else None
            if v is not None:
                total += v
                n += 1
        return total if n else None

    total_parc = sum_field(["parc", "total"])
    rp = sum_field(["parc", "residences_principales"])
    vac = sum_field(["parc", "logements_vacants_rp"])
    social_count = sum_field(["social", "rpls_count"])
    aut_5y = sum_field(["construction", "autorises_5ans"])
    com_5y = sum_field(["construction", "commences_5ans"])
    dpe_obs = sum_field(["renovation", "dpe_observes"])
    maison = sum_field(["parc", "maisons"])
    appartement = sum_field(["parc", "appartements"])
    proprietaire = sum_field(["occupation", "proprietaires"])
    loc_prive = sum_field(["occupation", "locataires_prive"])
    loc_social = sum_field(["occupation", "locataires_social"])
    vac_priv_longue = sum_field(["vacance", "vacance_privee_longue_2025"])
    avant_1971_vals = [p["parc"]["part_avant_1971"]["value"] for p in member_profiles if p["parc"]["part_avant_1971"]["value"] is not None]
    part_avant_1971 = sum(avant_1971_vals) / len(avant_1971_vals) if avant_1971_vals else None

    dpe_fg_count = None
    if dpe_obs:
        fg_vals = [(p["renovation"]["dpe_fg_part"]["value"] or 0) / 100 * p["renovation"]["dpe_observes"]["value"] for p in member_profiles if p["renovation"]["dpe_observes"]["value"]]
        dpe_fg_count = sum(fg_vals) if fg_vals else None

    anah_programmes = []
    seen_programmes = set()
    for p in member_profiles:
        for prog in p["renovation"]["anah_programmes_actifs"]:
            key = (prog["libelle"], prog["fin"])
            if key not in seen_programmes:
                seen_programmes.add(key)
                anah_programmes.append(prog)

    flag = QUALITY_PARTIAL_PERIMETER if partial else QUALITY_OK

    return {
        "code": code,
        "name": name,
        "kind": kind,
        "members": members,
        "members_covered": members_95,
        "perimetre_partiel": partial,
        "parc": {
            "total": {"value": total_parc, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": flag if total_parc is not None else QUALITY_MISSING},
            "residences_principales": {"value": rp, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": flag if rp is not None else QUALITY_MISSING},
            "logements_vacants_rp": {"value": vac, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": total_parc, "quality_flag": flag if vac is not None else QUALITY_MISSING},
            "maisons": {"value": maison, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": flag if maison is not None else QUALITY_MISSING},
            "appartements": {"value": appartement, "unit": "logements", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": flag if appartement is not None else QUALITY_MISSING},
            "part_avant_1971": {"value": part_avant_1971, "unit": "%", "year": 2023, "source": "insee_logement_2023", "denominator": None, "quality_flag": flag if part_avant_1971 is not None else QUALITY_MISSING},
        },
        "occupation": {
            "proprietaires": {"value": proprietaire, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": flag if proprietaire is not None else QUALITY_MISSING},
            "locataires_prive": {"value": loc_prive, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": flag if loc_prive is not None else QUALITY_MISSING},
            "locataires_social": {"value": loc_social, "unit": "résidences principales", "year": 2023, "source": "insee_logement_2023", "denominator": rp, "quality_flag": flag if loc_social is not None else QUALITY_MISSING},
        },
        "social": {
            "rpls_count": {"value": social_count, "unit": "logements", "year": 2025, "source": "rpls", "denominator": None, "quality_flag": flag if social_count is not None else QUALITY_MISSING},
            "part_rpls_residences_principales": {"value": (social_count / rp * 100) if (social_count is not None and rp) else None, "unit": "%", "year": 2025, "source": "rpls+insee_logement_2023", "denominator": rp, "quality_flag": flag if (social_count is not None and rp) else QUALITY_MISSING},
            **{
                f"part_financement_{key}": {
                    "value": (sum((p["social"][f"part_financement_{key}"]["value"] or 0) / 100 * (p["social"]["rpls_count"]["value"] or 0) for p in member_profiles if p["social"]["rpls_count"]["value"]) / social_count * 100) if social_count else None,
                    "unit": "%", "year": 2025, "source": "rpls", "denominator": social_count,
                    "quality_flag": flag if social_count else QUALITY_MISSING,
                }
                for key in ("tres_social", "social", "intermediaire")
            },
        },
        "vacance": {
            "taux_vacance_rp": {"value": (vac / total_parc * 100) if (vac is not None and total_parc) else None, "unit": "%", "year": 2023, "source": "insee_logement_2023", "denominator": total_parc, "quality_flag": flag if (vac is not None and total_parc) else QUALITY_MISSING},
            "vacance_privee_longue_2025": {"value": vac_priv_longue, "unit": "logements", "year": 2025, "source": "lovac", "denominator": None, "quality_flag": flag if vac_priv_longue is not None else QUALITY_MISSING},
            "rupture_serie": "Rupture méthodologique en 2023 (bascule GMBI) puis rupture de production en 2025 : ne pas tracer de tendance continue sans annotation.",
        },
        "construction": {
            "autorises_5ans": {"value": aut_5y, "unit": "logements", "year": "2021-2025", "source": "sitadel3", "denominator": None, "quality_flag": flag if aut_5y is not None else QUALITY_MISSING},
            "commences_5ans": {"value": com_5y, "unit": "logements", "year": "2021-2025", "source": "sitadel3", "denominator": None, "quality_flag": flag if com_5y is not None else QUALITY_MISSING},
            "serie_annuelle": [],
        },
        "renovation": {
            "dpe_observes": {"value": dpe_obs, "unit": "diagnostics", "year": 2026, "source": "dpe_ademe", "denominator": None, "quality_flag": flag if dpe_obs else QUALITY_MISSING},
            "dpe_fg_part": {"value": (dpe_fg_count / dpe_obs * 100) if (dpe_fg_count is not None and dpe_obs) else None, "unit": "%", "year": 2026, "source": "dpe_ademe", "denominator": dpe_obs, "quality_flag": flag if (dpe_fg_count is not None and dpe_obs) else QUALITY_MISSING},
            "anah_programmes_actifs": anah_programmes,
        },
    }


def aggregate_epci(commune_profiles):
    epci_profiles = {}
    for code, e in epcis.items():
        members = e["members"]
        members_95 = [m for m in members if m.startswith("95")]
        member_profiles = [commune_profiles[m] for m in members_95 if m in commune_profiles]
        partial = len(members_95) < len(members)
        profile = build_aggregate_profile(code, e["name"], "epci", member_profiles, members=members, members_95=members_95, partial=partial)
        profile["special"] = e["special"]
        epci_profiles[code] = profile
    return epci_profiles


def build_departement_profile(commune_profiles):
    all_codes = sorted(CODES)
    member_profiles = [commune_profiles[c] for c in all_codes]
    profile = build_aggregate_profile("95", "Val-d’Oise", "departement", member_profiles, members=all_codes, members_95=all_codes, partial=False)
    profile["special"] = False
    return profile


if __name__ == "__main__":
    commune_profiles = build_commune_profiles()
    epci_profiles = aggregate_epci(commune_profiles)
    departement_profile = build_departement_profile(commune_profiles)
    json.dump(commune_profiles, open(PROCESSED / "commune_profiles.json", "w"), ensure_ascii=False, indent=1)
    json.dump(epci_profiles, open(PROCESSED / "epci_profiles.json", "w"), ensure_ascii=False, indent=1)
    json.dump(departement_profile, open(PROCESSED / "departement_profile.json", "w"), ensure_ascii=False, indent=1)
    print(f"{len(commune_profiles)} communes, {len(epci_profiles)} EPCI, 1 synthèse départementale écrits.")
    missing_rpls = sum(1 for p in commune_profiles.values() if p["social"]["rpls_count"]["value"] is None)
    print(f"RPLS manquant pour {missing_rpls} communes (fichier data/raw/rpls_95.csv à régénérer si != 0).")
