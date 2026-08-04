# Comment se loge-t-on dans le Val-d'Oise ?

Carte interactive du logement dans le Val-d'Oise (95) : parc social, vacance, construction et rénovation, à l'échelle commune ou EPCI.

Construit sur le modèle fonctionnel et graphique de [Domicile ↔ Travail](https://github.com/DDT95/val-doise-domicile-travail).

## Données

Sept sources publiques croisées, jamais de valeur inventée ; le détail (URL, millésime, licence, prudence méthodologique) est dans [`data/sources.json`](data/sources.json) :

- Insee, Recensement de la population 2023 — Logement
- SDES, Répertoire des logements locatifs sociaux (RPLS), 1ᵉʳ janvier 2025
- Ministère chargé du Logement, inventaire SRU 2025
- DGALN / Cerema, LOVAC open data — vacance du parc privé 2020-2026
- SDES, Sitadel3 — logements autorisés et commencés, 2013-2025
- ADEME, DPE v2 logements existants
- Anah, opérations programmées d'amélioration de l'habitat

Les valeurs secrétisées (LOVAC : moins de 11 logements) ou absentes ne sont jamais transformées en zéro — elles portent un `quality_flag` explicite (`secret`, `missing`, `not_applicable`).

Voir l'onglet **Comprendre la carte** pour la méthodologie complète et ses limites.

## Développement local

```
python3 -m http.server 8420
```

Puis ouvrir `http://localhost:8420`.

## Régénérer les données

Les fichiers bruts filtrés sur le Val-d'Oise sont dans `data/raw/` (voir `data/sources.json` pour les URL sources complètes). Reconstruire les profils :

```
python3 -m venv .venv && source .venv/bin/activate && pip install openpyxl
python3 scripts/build_profiles.py
```

## Structure

```
index.html                page principale (carte + onglet Comprendre)
fiche.html                fiche territoriale sans sélecteur, export PDF à la demande
css/style.css
css/fiche.css
js/app.js                 carte choroplèthe, sélection, panneau de détail
js/fiche.js               rendu de la fiche commune/EPCI et export PDF
data/processed/           communes95.geojson, epcis95.json, commune_profiles.json, epci_profiles.json
data/raw/                 sources brutes filtrées sur le Val-d'Oise (gitignorées si volumineuses)
data/sources.json         traçabilité complète des sources (URL, millésime, licence, prudence)
scripts/build_profiles.py agrégation des indicateurs commune et EPCI
```

## Limites connues (V1)

- Deux EPCI débordent le Val-d'Oise (CA Roissy Pays de France, CA de Cergy-Pontoise) : leurs indicateurs agrégés ne portent que sur la partie val-d'oisienne, signalé sur leur fiche (`perimetre_partiel: true`).
- DPE ADEME : observations volontaires, pas un recensement exhaustif — le nombre de diagnostics est toujours affiché comme dénominateur.
- LOVAC : rupture méthodologique 2023 (GMBI) puis rupture de production 2025, annotée dans chaque fiche.
