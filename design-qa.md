# Design QA — modale « Données & évolutions »

- Source visuelle : `/var/folders/3h/px_6bwl96w50x8y34bkz_k_80000gn/T/TemporaryItems/NSIRD_screencaptureui_j8jlBw/Capture d’écran 2026-08-11 à 11.58.54.png`
- Implémentation : `.qa/synthesis-modal-implementation.png`
- Révision circulaire : `.qa/synthesis-modal-round.png`
- Source : 4346 × 2214 px, capture Retina avec chrome du navigateur.
- Implémentation : 2147 × 973 px, viewport de navigateur à densité 1.
- Normalisation : comparaison du contenu applicatif à proportions équivalentes ; le chrome et la densité Retina de la source ont été exclus du jugement.
- État comparé : page cartographique assombrie, tableau de bord départemental ouvert.

## Comparaison visuelle

La source et l’implémentation ont été ouvertes ensemble à leur résolution d’origine. L’implémentation reprend la même composition : grande modale centrée et scrollable, arrière-plan sombre et flouté, bouton de fermeture cerclé, en-tête, rangée de KPI, grande datavisualisation et cartes secondaires.

Le contrôle ciblé de l’en-tête, des KPI, du bouton de fermeture et des cartes confirme la cohérence de la typographie Marianne, du bleu institutionnel, des bordures turquoise, des espacements, des rayons et de la hiérarchie. Aucun actif illustré n’est présent dans la référence ; les datavisualisations sont rendues à partir des données du site.

## Vérifications fonctionnelles

- Les deux boutons « Données & évolutions » ouvrent la même modale.
- L’URL ne change pas.
- Le bouton de fermeture fonctionne ; Échap et le clic sur l’arrière-plan utilisent le comportement natif du dialogue.
- Le contenu reste lisible et scrollable sur un viewport mobile 390 × 844 px.
- Vérification syntaxique JavaScript et contrôle des espaces Git réussis.

## Comparaison et corrections

- P1 initial : le contenu s’ouvrait dans un panneau latéral, contrairement à la grande modale de référence.
- Correction : création d’un dialogue modal dédié, centré, large, avec fond assombri et grille de tableau de bord.
- Preuve après correction : `.qa/synthesis-modal-implementation.png` montre la modale dans le même état que la référence.
- P1 signalé ensuite : le graphique annuel en barres était trop anguleux, trop étiré et laissait un vide important.
- Correction : remplacement par quatre graphiques radiaux à double anneau, valeurs visibles par année, cumuls présentés dans des capsules arrondies et carte de repères davantage arrondie.
- Preuve après correction : `.qa/synthesis-modal-round.png`. La zone est plus compacte, le rapprochement entre les deux séries reste immédiat et toutes les valeurs sont conservées.

## Surfaces de fidélité

- Typographie : Marianne, poids et hiérarchie conformes.
- Espacement : marges de modale, grille de KPI et rythme des cartes conformes.
- Couleurs : fond clair, bleu institutionnel, turquoise et voile sombre conformes.
- Images : aucune image applicative à reproduire ; graphiques issus des données réelles.
- Contenu : adapté au logement tout en conservant la structure éditoriale de la référence.

## Résultat

final result: passed
