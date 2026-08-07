(function () {
  "use strict";

  const fmt = (n) => (n == null ? "n. d." : Math.round(n).toLocaleString("fr-FR"));
  const pctFmt = (n) => (n == null ? "n. d." : Math.min(100, Math.max(0, n)).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "%");
  const chartColors = ["#000091", "#00a7b5", "#e07a2f", "#e85d8e", "#18753c", "#ffd66b", "#6f4c9b"];
  const root = document.getElementById("profileRoot");
  const dialog = document.getElementById("exportDialog");
  const headerTitle = document.getElementById("headerTitle");
  const params = new URLSearchParams(location.search);
  const typeParam = params.get("type");
  const scale = typeParam === "departement" ? "departement" : typeParam === "epci" ? "epci" : "commune";
  const selectedId = scale === "departement" ? "95" : params.get("id");
  let currentProfile;

  function val(node) {
    return node ? node.value : null;
  }
  function isMissing(node) {
    return !node || node.value == null;
  }
  function flagLabel(node) {
    if (!node) return "";
    if (node.quality_flag === "secret") return " · donnée secrétisée";
    if (node.quality_flag === "not_applicable") return " · non applicable";
    if (node.quality_flag === "partial_perimeter") return " · périmètre partiel";
    return "";
  }

  function kpi(label, node, unit, note) {
    const missing = isMissing(node);
    let display;
    if (missing) display = '<span class="data-missing">Non disponible</span>';
    else if (unit === "%") display = pctFmt(node.value);
    else if (unit === "€") display = fmt(node.value) + " " + node.unit;
    else display = fmt(node.value);
    return `<div class="kpi"><small>${label}${flagLabel(node)}</small><strong>${display}</strong>${note ? `<span>${note}</span>` : ""}</div>`;
  }

  function donut(title, data, centerLabel, centerValue, tone = "") {
    const total = data.reduce((s, d) => s + (d.pct || 0), 0);
    if (!total) return `<article class="chart-card visual-card ${tone}"><h3>${title}</h3><p class="data-missing">Données non disponibles.</p></article>`;
    let cursor = 0;
    const stops = data.map((item, i) => {
      const start = cursor;
      cursor += item.pct;
      return `${chartColors[i % chartColors.length]} ${start}% ${cursor}%`;
    }).join(",");
    const description = data.map((d) => `${d.label} ${d.pct}%`).join(", ");
    return `<article class="chart-card visual-card ${tone}"><h3>${title}</h3><div class="donut-layout"><div class="donut" style="--segments:${stops}" role="img" aria-label="${description}"><div><strong>${centerValue}</strong><span>${centerLabel}</span></div></div><div class="chart-legend">${data.map((d, i) => `<div><i style="--swatch:${chartColors[i % chartColors.length]}"></i><span>${d.label}</span><b>${d.pct.toLocaleString("fr-FR")}%</b></div>`).join("")}</div></div></article>`;
  }

  function bars(title, data, tone = "") {
    if (!data.length) return `<article class="chart-card ${tone}"><h3>${title}</h3><p class="data-missing">Données non disponibles.</p></article>`;
    return `<article class="chart-card ${tone}"><h3>${title}</h3>${data.map((d) => `<div class="bar-row"><span title="${d.label}">${d.label}</span><div class="bar-track"><i style="--pct:${d.pct}%"></i></div><b>${d.pct.toLocaleString("fr-FR")}%</b></div>`).join("")}</article>`;
  }

  function lineSeries(title, series, note) {
    if (!series.length) return `<article class="chart-card visual-card wide-chart"><h3>${title}</h3><p class="data-missing">Données non disponibles.</p></article>`;
    const maxV = Math.max(...series.map((s) => Math.max(s.autorises || 0, s.commences || 0)), 1);
    return `<article class="chart-card visual-card wide-chart"><h3>${title}</h3><div class="age-bars" role="img" aria-label="série annuelle logements autorisés et commencés">${series.map((s) => `<div class="age-column"><b>${fmt(s.commences)}</b><div><i style="--height:${Math.max(4, ((s.commences || 0) / maxV) * 100)}%;--swatch:#00a7b5"></i></div><span>${s.annee}</span></div>`).join("")}</div>${note ? `<p class="method-note-small">${note}</p>` : ""}</article>`;
  }

  function section(kicker, title, content, note = "") {
    return `<section class="section"><div class="section-head"><div><small>${kicker}</small><h2>${title}</h2></div>${note ? `<p>${note}</p>` : ""}</div>${content}</section>`;
  }

  function pct(num, den) {
    if (num == null || !den) return null;
    return Math.min(100, Math.max(0, Math.round((num / den) * 1000) / 10));
  }

  function renderProfile(profile, name) {
    currentProfile = profile;
    const isDepartement = scale === "departement";
    const isEpci = scale === "epci" && !profile.special;
    const territoryTitle = isDepartement ? "Le Val-d’Oise" : isEpci ? "L’EPCI" : "La commune";
    const territoryWord = isDepartement ? "le Val-d’Oise" : isEpci ? "l’EPCI" : "la commune";
    const coverKicker = isDepartement ? "SYNTHÈSE DÉPARTEMENTALE" : isEpci ? "FICHE INTERCOMMUNALE" : "FICHE COMMUNALE";
    document.title = `${name} · Fiche logement · DDT 95`;
    headerTitle.textContent = isDepartement ? "Synthèse départementale · Logement" : isEpci ? "Fiche EPCI · Logement" : "Fiche communale · Logement";

    const total = val(profile.parc.total);
    const rp = val(profile.parc.residences_principales);
    const rs = val(profile.parc.residences_secondaires);
    const vac = val(profile.parc.logements_vacants_rp);
    const maison = val(profile.parc.maisons);
    const appart = val(profile.parc.appartements);
    const proprio = val(profile.occupation.proprietaires);
    const locPrive = val(profile.occupation.locataires_prive);
    const locSocial = val(profile.occupation.locataires_social);
    const rplsCount = val(profile.social.rpls_count);
    const rplsPart = val(profile.social.part_rpls_residences_principales);
    const dpeFg = val(profile.renovation.dpe_fg_part);
    const dpeObs = val(profile.renovation.dpe_observes);
    const anahProgrammes = profile.renovation.anah_programmes_actifs || [];
    const marche = profile.marche || {
      prix_m2_median: { value: null }, prix_m2_maison_median: { value: null }, prix_m2_appartement_median: { value: null },
      loyer_m2_appartement: { value: null }, loyer_m2_maison: { value: null }, ventes_par_an: {},
    };
    const ventesAnnees = Object.keys(marche.ventes_par_an || {}).sort();
    const maxVentes = Math.max(...ventesAnnees.map((y) => marche.ventes_par_an[y]), 1);
    const salesVolumeChart = ventesAnnees.length
      ? `<article class="chart-card visual-card wide-chart"><h3>Nombre de ventes par an (DVF)</h3><div class="age-bars" role="img" aria-label="ventes par an">${ventesAnnees.map((y) => `<div class="age-column"><b>${marche.ventes_par_an[y]}</b><div><i style="--height:${Math.max(4, (marche.ventes_par_an[y] / maxVentes) * 100)}%;--swatch:#9c27b0"></i></div><span>${y}</span></div>`).join("")}</div><p class="method-note-small">Ventes simples (maisons et appartements), tous prix confondus.</p></article>`
      : `<article class="chart-card visual-card wide-chart"><h3>Nombre de ventes par an (DVF)</h3><p class="data-missing">Données non disponibles.</p></article>`;

    const habiterDonut = maison != null && appart != null ? [
      { label: "Maison", pct: pct(maison, rp) || 0 },
      { label: "Appartement", pct: pct(appart, rp) || 0 },
    ] : [];
    const occupationDonut = [proprio, locPrive, locSocial].every((v) => v != null) ? [
      { label: "Propriétaire", pct: pct(proprio, rp) || 0 },
      { label: "Locataire parc privé", pct: pct(locPrive, rp) || 0 },
      { label: "Locataire parc social", pct: pct(locSocial, rp) || 0 },
    ] : [];

    const partialNote = isEpci && profile.perimetre_partiel
      ? `<p class="method-note-small">Indicateurs calculés sur les ${profile.members_covered.length} communes val-d’oisiennes de cet EPCI (périmètre complet : ${profile.members.length} communes).</p>`
      : "";

    root.innerHTML = `<div id="report">
      <section class="report-cover">
        <div class="cover-kicker">${coverKicker} · LOGEMENT · HABITAT</div>
        <h1>${name}</h1>
        <p>Composition du parc, poids du logement social, vacance, construction et besoin de rénovation dans ${territoryWord}.</p>
        <div class="cover-meta"><span>Insee 2023 · RPLS 2025 · LOVAC 2025 · Sitadel3 · ADEME DPE</span><span>DDT du Val-d’Oise</span></div>
      </section>
      <div class="report-body">
        ${partialNote}
        ${section("01 · REPÈRES", `${territoryTitle} en six chiffres`, `<div class="kpi-grid kpi-grid-six">
          ${kpi("Logements (parc total)", profile.parc.total, "n")}
          ${kpi("Résidences principales", profile.parc.residences_principales, "n")}
          ${kpi("Résidences secondaires", profile.parc.residences_secondaires, "n")}
          ${kpi("Logements vacants (RP)", profile.parc.logements_vacants_rp, "n", vac != null && total ? pctFmt(pct(vac, total)) + " du parc" : "")}
          ${kpi("Logements sociaux (RPLS)", profile.social.rpls_count, "n", rplsPart != null ? pctFmt(rplsPart) + " des résidences principales" : "")}
          ${kpi("Logements commencés (5 ans)", profile.construction.commences_5ans, "n", "Cumul 2021-2025")}
        </div>`)}
        ${section("02 · HABITER", "Type et statut d’occupation", `<div class="charts-grid visual-grid">${donut("Maison / appartement", habiterDonut, "du parc", habiterDonut.length ? habiterDonut[0].pct.toLocaleString("fr-FR") + "%" : "n. d.")}${donut("Statut d’occupation", occupationDonut, "propriétaires", occupationDonut.length ? occupationDonut[0].pct.toLocaleString("fr-FR") + "%" : "n. d.", "orange")}</div>`, "Résidences principales, Insee 2023.")}
        ${section("03 · PARC SOCIAL", "Le logement social sur ce territoire", `<div class="kpi-grid kpi-grid-six">
          ${kpi("Logements RPLS", profile.social.rpls_count, "n")}
          ${kpi("Part des résidences principales", profile.social.part_rpls_residences_principales, "%")}
          ${kpi("Part F/G du parc social (DPE)", profile.social.dpe_fg_part_observee, "%")}
          ${kpi("Soumise à l’article 55 SRU", profile.social.sru_soumise, "n", profile.social.sru_soumise && profile.social.sru_soumise.value === 1 ? "Oui" : profile.social.sru_soumise && profile.social.sru_soumise.value === 0 ? "Non" : "")}
          ${kpi("Taux SRU (inventaire)", profile.social.sru_taux_pct, "%")}
          ${kpi("Commune carencée SRU", profile.social.sru_carencee, "n", profile.social.sru_carencee && profile.social.sru_carencee.value === 1 ? "Oui" : profile.social.sru_carencee && profile.social.sru_carencee.value === 0 ? "Non" : "")}
        </div>
        <div class="rank-list"><h3>Répartition par financement (part du parc RPLS)</h3>
          <div class="rank-row"><span>Très social (PLAI et assimilé)</span><b>${pctFmt(val(profile.social.part_financement_tres_social))}</b></div>
          <div class="rank-row"><span>Social (PLUS/HLM-O et assimilé)</span><b>${pctFmt(val(profile.social.part_financement_social))}</b></div>
          <div class="rank-row"><span>Intermédiaire (PLS/PLI et assimilé)</span><b>${pctFmt(val(profile.social.part_financement_intermediaire))}</b></div>
        </div>
        <p class="method-note-small">RPLS distingue des dizaines de dispositifs historiques (HLM/O, ILN, HBM...) sans correspondance exacte avec la grille usuelle PLAI/PLUS/PLS/PLI ; ils sont rattachés à la famille la plus proche. Le solde non classé correspond aux financements anciens ou atypiques.</p>`, "RPLS SDES 2025 ; inventaire SRU 2025. Deux périmètres distincts, ne pas confondre.")}
        ${section("04 · VACANCE", "Où la vacance est-elle durable ?", `<div class="kpi-grid kpi-grid-six">
          ${kpi("Vacance au recensement", profile.parc.logements_vacants_rp, "n")}
          ${kpi("Taux de vacance RP", profile.vacance.taux_vacance_rp, "%")}
          ${kpi("Vacance privée (LOVAC 2025)", profile.vacance.vacance_privee_2025, "n")}
          ${kpi("Vacance privée +2 ans (2025)", profile.vacance.vacance_privee_longue_2025, "n")}
          ${kpi("Vacance privée (LOVAC 2020)", profile.vacance.vacance_privee_2020, "n")}
        </div><p class="method-note-small">${profile.vacance.rupture_serie}</p>`)}
        ${section("05 · CONSTRUIRE", "Logements autorisés et commencés", lineSeries("Logements commencés, série annuelle", profile.construction.serie_annuelle, "Sitadel3, données en date réelle, incomplètes sur les mouvements les plus récents (documents non encore reçus)."), `Autorisés (5 ans) : ${fmt(val(profile.construction.autorises_5ans))} · Commencés (5 ans) : ${fmt(val(profile.construction.commences_5ans))}.`)}
        ${section("06 · RÉNOVER", "Performance énergétique et dispositifs", `<div class="kpi-grid kpi-grid-six">
          ${kpi("DPE observés", profile.renovation.dpe_observes, "n")}
          ${kpi("Part F/G parmi les DPE observés", profile.renovation.dpe_fg_part, "%")}
          ${kpi("Part de résidences principales avant 1971", profile.parc.part_avant_1971, "%")}
        </div>
        <div class="rank-list"><h3>Opérations programmées Anah actives</h3>${anahProgrammes.length ? anahProgrammes.map((a) => `<div class="rank-row"><span>${a.libelle} (${a.type})</span><b>${a.fin ? "jusqu’au " + a.fin : "en cours"}</b></div>`).join("") : '<p class="data-missing">Aucune opération programmée active recensée.</p>'}</div>
        <p class="method-note-small">Les DPE sont des observations, pas un recensement exhaustif du parc : le nombre de diagnostics est le dénominateur de référence. Une opération programmée signale un dispositif actif, pas le nombre de rénovations réalisées.</p>`)}
        ${section("07 · MARCHÉ IMMOBILIER", "Prix, loyers et dynamique des transactions", `<div class="kpi-grid kpi-grid-six">
          ${kpi("Prix médian au m² (tous biens)", marche.prix_m2_median, "€", marche.prix_m2_median.denominator ? marche.prix_m2_median.denominator + " ventes 2023-2025" : "")}
          ${kpi("Prix médian au m² — maisons", marche.prix_m2_maison_median, "€")}
          ${kpi("Prix médian au m² — appartements", marche.prix_m2_appartement_median, "€")}
          ${kpi("Loyer moyen au m² — appartement", marche.loyer_m2_appartement, "€")}
          ${kpi("Loyer moyen au m² — maison", marche.loyer_m2_maison, "€")}
        </div>
        ${salesVolumeChart}
        <p class="method-note-small">Prix : médiane sur les ventes simples (un seul bien par mutation) enregistrées dans DVF, 2023-2025 regroupées ; aucune valeur affichée en dessous de 5 ventes exploitables. Loyers : indicateurs prédits (modèle DHUP) sur annonces 2025, donnée secrétisée si moins de 30 observations communales. Les deux mesures ne se compensent pas et ne définissent pas un taux d'effort ou une capacité d'achat.</p>`)}
        ${section("08 · SOURCES ET MÉTHODE", "Bien lire cette fiche", `<div class="method-note">
          <strong>Sources :</strong> Insee, Recensement de la population 2023, Logement (géographie au 1ᵉʳ janvier 2026) · SDES, RPLS, état au 1ᵉʳ janvier 2025 · Ministère chargé du Logement, inventaire SRU 2025 · DGALN/Cerema, LOVAC open data 2020-2026 · SDES, Sitadel3, séries annuelles 2013-2025 (données non estimées, date réelle) · ADEME, DPE v2 logements existants (diagnostics depuis juillet 2021) · Anah, opérations programmées · DGFiP, Demandes de valeurs foncières (DVF) 2021-2025 · DHUP, carte des loyers d'annonce 2025.<br><br>
          <strong>Limites :</strong> les effectifs Insee sont pondérés par sondage ; les comparaisons entre petits territoires sont déconseillées sous 200 logements. RPLS et inventaire SRU ne couvrent pas exactement le même périmètre de logement social. LOVAC a connu une rupture méthodologique en 2023 (bascule GMBI) puis une rupture de production en 2025 : aucune tendance continue n’est présentée sans cette réserve. Sitadel3 mesure des autorisations et mises en chantier, pas des logements livrés. Les valeurs secrétisées (moins de 11 logements en LOVAC, moins de 30 observations en carte des loyers) ne sont jamais affichées comme des zéros. DVF ne couvre pas l'Alsace-Moselle ni les ventes non déclarées ; les prix sont des médianes de ventes simples, pas une valorisation exhaustive du parc. Les loyers DHUP sont des prédictions statistiques sur annonces, pas des loyers réellement pratiqués.<br><br>
          <strong>Licence :</strong> Licence Ouverte / Etalab pour l’ensemble des sources mobilisées.
        </div>`)}
      </div>
    </div>`;
  }

  Promise.all([
    fetch("data/processed/commune_profiles.json").then((r) => r.json()),
    fetch("data/processed/epci_profiles.json").then((r) => r.json()),
    fetch("data/processed/communes95.json").then((r) => r.json()),
    fetch("data/processed/departement_profile.json").then((r) => r.json()),
    fetch("data/processed/market_profiles.json").then((r) => r.json()),
    fetch("data/processed/market_epci_profiles.json").then((r) => r.json()),
    fetch("data/processed/market_departement_profile.json").then((r) => r.json()),
  ])
    .then(([communeProfiles, epciProfiles, communes, departementProfile, marketCommune, marketEpci, marketDept]) => {
      const communeNames = Object.fromEntries(communes.map((c) => [c.code, c.name]));
      departementProfile.marche = marketDept;
      if (scale === "departement") {
        renderProfile(departementProfile, departementProfile.name);
      } else if (scale === "epci") {
        const profile = epciProfiles[selectedId];
        if (!profile) throw new Error("EPCI introuvable");
        profile.marche = marketEpci[selectedId];
        renderProfile(profile, profile.name);
      } else {
        const profile = communeProfiles[selectedId];
        if (!profile) throw new Error("Commune introuvable");
        profile.marche = marketCommune[selectedId];
        renderProfile(profile, communeNames[selectedId] || profile.name);
      }
    })
    .catch(() => {
      root.innerHTML = '<div class="loading">Territoire introuvable. Retournez à la carte et sélectionnez une commune ou un EPCI.</div>';
    });

  document.getElementById("openExport").onclick = () => dialog.showModal();
  document.getElementById("closeExport").onclick = () => dialog.close();
  dialog.onclick = (e) => { if (e.target === dialog) dialog.close(); };
  document.getElementById("printProfile").onclick = () => { dialog.close(); window.print(); };
  document.getElementById("makePdf").onclick = async () => {
    dialog.close();
    document.body.classList.add("exporting");
    const name = (currentProfile.name || "territoire").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    try {
      await html2pdf().set({
        margin: 0,
        filename: `fiche-logement-${name}.pdf`,
        image: { type: "jpeg", quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".section", ".chart-card"] },
      }).from(document.getElementById("report")).save();
    } finally {
      document.body.classList.remove("exporting");
    }
  };
})();
