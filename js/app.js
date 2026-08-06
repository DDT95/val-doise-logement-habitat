(function () {
  "use strict";

  const state = {
    communes: [],
    communesByCode: new Map(),
    epcis: [],
    epcisByCode: new Map(),
    epciColors: new Map(),
    scale: "commune",
    selected: null,
    activeLayer: null,
  };

  const LAYERS = {
    part_appartements: { label: "Part d’appartements", unit: "%", ramp: ["#eef7f8", "#00a7b5", "#004a52"], get: (p) => pct(p.parc.appartements.value, p.parc.residences_principales.value) },
    part_maisons: { label: "Part de maisons individuelles", unit: "%", ramp: ["#fdf3e7", "#c76524", "#5c2a0a"], get: (p) => pct(p.parc.maisons.value, p.parc.residences_principales.value) },
    part_avant_1971: { label: "Part de logements anciens (avant 1971)", unit: "%", ramp: ["#f5f0e6", "#b88a16", "#5c4200"], get: (p) => p.parc.part_avant_1971 ? p.parc.part_avant_1971.value : null },
    part_locataires: { label: "Part de locataires", unit: "%", ramp: ["#eef2f9", "#3978b8", "#0b2f57"], get: (p) => pct((p.occupation.locataires_prive.value || 0) + (p.occupation.locataires_social.value || 0), p.parc.residences_principales.value) },
    part_proprietaires: { label: "Part de propriétaires", unit: "%", ramp: ["#eef7ee", "#477a3c", "#173a13"], get: (p) => pct(p.occupation.proprietaires.value, p.parc.residences_principales.value) },
    rpls_count: { label: "Nombre de logements RPLS", unit: "logements", ramp: ["#f3eef9", "#6f4c9b", "#2e1a4d"], get: (p) => p.social.rpls_count.value },
    part_rpls: { label: "Part RPLS des résidences principales", unit: "%", ramp: ["#f3eef9", "#6f4c9b", "#2e1a4d"], get: (p) => p.social.part_rpls_residences_principales.value },
    vacance_rp: { label: "Taux de vacance RP", unit: "%", ramp: ["#fdf0e9", "#e07a2f", "#7a3200"], get: (p) => p.vacance.taux_vacance_rp.value },
    vacance_privee_longue: { label: "Vacance privée depuis plus de 2 ans", unit: "logements", ramp: ["#fdf0e9", "#e07a2f", "#7a3200"], get: (p) => p.vacance.vacance_privee_longue_2025 ? p.vacance.vacance_privee_longue_2025.value : null },
    commences_5ans: { label: "Logements commencés (2021-2025)", unit: "logements", ramp: ["#eef7ee", "#18753c", "#0c3a1e"], get: (p) => p.construction.commences_5ans.value },
    dpe_fg: { label: "Part F/G parmi les DPE observés", unit: "%", ramp: ["#fdeef2", "#e85d8e", "#7a1338"], get: (p) => p.renovation.dpe_fg_part.value },
    prix_m2: { label: "Prix médian au m² (ventes 2023-2025)", unit: "€/m²", ramp: ["#f3eef9", "#9c27b0", "#3d0a45"], get: (p) => p.marche ? p.marche.prix_m2_median.value : null },
    loyer_m2: { label: "Loyer moyen au m² (appartement)", unit: "€/m²/mois", ramp: ["#eef7ee", "#009099", "#003d3f"], get: (p) => p.marche ? p.marche.loyer_m2_appartement.value : null },
  };

  document.querySelectorAll(".layer-card[data-layer]").forEach((btn) => {
    const def = LAYERS[btn.dataset.layer];
    if (!def) return;
    btn.style.setProperty("--layer-color", def.ramp[1]);
    btn.style.setProperty("--layer-gradient", `linear-gradient(135deg, ${def.ramp[0]}, ${def.ramp[1]})`);
  });

  function pct(num, den) {
    if (num == null || !den) return null;
    return Math.min(100, Math.max(0, (num / den) * 100));
  }
  function fmt(v, unit) {
    if (v == null) return "Non disponible";
    if (unit === "%") return Math.min(100, Math.max(0, v)).toFixed(1).replace(".", ",") + " %";
    return Math.round(v).toLocaleString("fr-FR") + (unit ? " " + unit : "");
  }

  // ---------- Map ----------
  const VDO_CENTER = [49.05, 2.15];
  const EPCI_COLORS = ["#18753c", "#6f4c9b", "#009099", "#c76524", "#d64d70", "#477a3c", "#ce0500", "#b88a16", "#45556c", "#3978b8"];
  const map = L.map("map", { zoomControl: true, minZoom: 7, maxZoom: 15 }).setView(VDO_CENTER, 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  let communesLayer, epciLayer, deptLayer;
  const territoryTooltip = L.tooltip({ sticky: true, className: "commune-tip", direction: "top", offset: [0, -8] });

  Promise.all([
    d3.json("data/processed/departement95.geojson"),
    d3.json("data/processed/communes95.geojson"),
    d3.json("data/processed/epcis95.geojson"),
    d3.json("data/processed/communes95.json"),
    d3.json("data/processed/commune_profiles.json"),
    d3.json("data/processed/epci_profiles.json"),
    d3.json("data/processed/market_profiles.json"),
    d3.json("data/processed/market_epci_profiles.json"),
  ]).then(([dept95, communes95Geo, epcis95Geo, communes95, communeProfiles, epciProfiles, marketProfiles, marketEpciProfiles]) => {
    deptLayer = L.geoJSON(dept95, { style: { color: "#000091", weight: 2, fill: false, opacity: 0.55 } }).addTo(map);

    Object.entries(marketProfiles).forEach(([code, m]) => { if (communeProfiles[code]) communeProfiles[code].marche = m; });
    Object.entries(marketEpciProfiles).forEach(([code, m]) => { if (epciProfiles[code]) epciProfiles[code].marche = m; });

    state.communes = communes95.map((c) => ({ ...c, profile: communeProfiles[c.code] }));
    state.communesByCode = new Map(state.communes.map((c) => [c.code, c]));
    state.epcis = Object.values(epciProfiles);
    state.epcisByCode = new Map(state.epcis.map((e) => [e.code, e]));
    prepareEpciColors();

    communesLayer = L.geoJSON(communes95Geo, {
      style: () => ({ color: "#8a9bb0", weight: 0.6, fillColor: "#dce8f1", fillOpacity: 0.5 }),
      onEachFeature: (feature, layer) => {
        layer.on("click", () => selectFromMap(feature.properties.code));
        layer.on("mouseover", (event) => {
          territoryTooltip.setContent(territoryNameFromMap(feature.properties.code)).setLatLng(event.latlng).openOn(map);
        });
        layer.on("mousemove", (event) => territoryTooltip.setLatLng(event.latlng));
        layer.on("mouseout", () => map.closeTooltip(territoryTooltip));
      },
    }).addTo(map);

    epciLayer = L.geoJSON(epcis95Geo, {
      style: (feature) => ({ color: state.epciColors.get(feature.properties.code) || "#000091", weight: 2.2, fillColor: state.epciColors.get(feature.properties.code) || "#dce8f1", fillOpacity: 0.2 }),
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(feature.properties.name, { permanent: true, className: "epci-label", direction: "center" });
        layer.on("click", () => selectEpci(feature.properties.code));
      },
    });

    document.getElementById("mapStatus").textContent = `${state.communes.length} communes chargées`;
    if (deptLayer) map.fitBounds(deptLayer.getBounds(), { padding: [0, 0], animate: false });
    applyChoropleth();
    renderEmptyState();

    const initialParams = new URLSearchParams(location.search);
    if (initialParams.get("type") === "epci" && state.epcisByCode.has(initialParams.get("id"))) {
      setMapScale("epci");
      selectEpci(initialParams.get("id"));
    } else if (initialParams.get("scale") === "epci") {
      setMapScale("epci");
    } else if (initialParams.get("type") === "commune" && state.communesByCode.has(initialParams.get("id"))) {
      selectCommune(initialParams.get("id"));
    }
  });

  function prepareEpciColors() {
    const regular = state.epcis.filter((e) => !e.special).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const special = state.epcis.filter((e) => e.special).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    [...regular, ...special].forEach((e, i) => state.epciColors.set(e.code, EPCI_COLORS[i % EPCI_COLORS.length]));
  }

  function epciForCommune(code) {
    return state.epcis.find((e) => e.members.includes(code));
  }

  function territoryNameFromMap(code) {
    if (state.scale === "commune") return state.communesByCode.get(code)?.name || code;
    return epciForCommune(code)?.name || "Territoire hors EPCI affiché";
  }

  // ---------- Choropleth ----------
  function layerValue(layerDef, profile) {
    if (!profile) return null;
    const v = layerDef.get(profile);
    if (v == null) return null;
    return layerDef.unit === "%" ? Math.min(100, Math.max(0, v)) : v;
  }

  function valueForTerritoryCode(code) {
    if (!state.activeLayer) return null;
    const layerDef = LAYERS[state.activeLayer];
    if (state.scale === "commune") {
      const c = state.communesByCode.get(code);
      return c ? layerValue(layerDef, c.profile) : null;
    }
    const epci = epciForCommune(code);
    return epci ? layerValue(layerDef, epci) : null;
  }

  function applyChoropleth() {
    if (!communesLayer) return;
    const layerDef = state.activeLayer ? LAYERS[state.activeLayer] : null;
    const displayLayer = state.scale === "epci" ? epciLayer : communesLayer;

    if (state.scale === "epci") {
      if (map.hasLayer(communesLayer)) map.removeLayer(communesLayer);
      if (epciLayer && !map.hasLayer(epciLayer)) epciLayer.addTo(map);
    } else {
      if (epciLayer && map.hasLayer(epciLayer)) map.removeLayer(epciLayer);
      if (!map.hasLayer(communesLayer)) communesLayer.addTo(map);
    }

    if (!layerDef) {
      displayLayer.eachLayer((layer) => {
        const code = layer.feature.properties.code;
        const isSelected = code === state.selected;
        const epciColor = state.scale === "epci" ? state.epciColors.get(code) : null;
        layer.setStyle({
          fillColor: epciColor || "#dce8f1",
          fillOpacity: isSelected ? 0.48 : state.scale === "epci" ? 0.2 : 0.32,
          weight: isSelected ? 3.4 : state.scale === "epci" ? 2.2 : 0.6,
          color: isSelected ? "#070047" : epciColor || "#8a9bb0",
        });
        if (isSelected) layer.bringToFront();
      });
      document.getElementById("mapLegend").hidden = true;
      return;
    }

    let values;
    if (state.scale === "commune") {
      values = state.communes.map((c) => layerValue(layerDef, c.profile)).filter((v) => v != null);
    } else {
      values = state.epcis.filter((e) => !e.special).map((e) => layerValue(layerDef, e)).filter((v) => v != null);
    }
    const extent = d3.extent(values);
    const colorScale = d3.scaleLinear().range(layerDef.ramp);
    colorScale.domain(extent[0] === extent[1] ? [0, extent[1] || 1] : extent);

    displayLayer.eachLayer((layer) => {
      const code = layer.feature.properties.code;
      const isSelected = code === state.selected;
      const v = state.scale === "epci" ? layerValue(layerDef, state.epcisByCode.get(code)) : valueForTerritoryCode(code);
      const fill = v == null ? "#e4e9ec" : colorScale(v);
      layer.setStyle({
        fillColor: fill,
        fillOpacity: v == null ? 0.35 : 0.72,
        weight: isSelected ? 2.4 : 0.6,
        color: isSelected ? "#070047" : "#8a9bb0",
      });
      if (isSelected) layer.bringToFront();
    });

    const legend = document.getElementById("mapLegend");
    legend.hidden = false;
    legend.style.setProperty("--layer-color", layerDef.ramp[1]);
    legend.querySelector(".ramp").style.background = `linear-gradient(90deg, ${layerDef.ramp.join(",")})`;
    document.getElementById("legendTitle").textContent = layerDef.label;
    document.getElementById("legendMin").textContent = fmt(extent[0], layerDef.unit);
    document.getElementById("legendMax").textContent = fmt(extent[1], layerDef.unit);
    document.getElementById("legendNote").textContent = "Gris = donnée non disponible ou secrétisée.";
  }

  document.querySelectorAll(".layer-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const turningOff = btn.classList.contains("active");
      document.querySelectorAll(".layer-card").forEach((b) => b.classList.toggle("active", !turningOff && b === btn));
      state.activeLayer = turningOff ? null : btn.dataset.layer;
      state.selected = null;
      searchInput.value = "";
      document.getElementById("detailPanel").classList.remove("open");
      applyChoropleth();
      renderEmptyState();
    });
  });

  // ---------- Search ----------
  const searchInput = document.getElementById("searchInput");
  const searchButton = document.getElementById("searchButton");
  const searchResults = document.getElementById("searchResults");
  const territorySearchLabel = document.getElementById("territorySearchLabel");

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) { searchResults.hidden = true; searchResults.innerHTML = ""; return; }
    const collection = state.scale === "epci" ? state.epcis : state.communes;
    const matches = collection.filter((item) => item.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, "fr")).slice(0, 8);
    if (!matches.length) { searchResults.hidden = true; return; }
    searchResults.innerHTML = matches.map((item) => `<button type="button" data-code="${item.code}"><b>${item.name}</b><small>${state.scale === "epci" ? (item.special ? "Commune particulière" : "EPCI") : "Commune"}</small></button>`).join("");
    searchResults.hidden = false;
    searchResults.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.scale === "epci") selectEpci(btn.dataset.code); else selectCommune(btn.dataset.code);
        searchResults.hidden = true;
      });
    });
  }
  searchInput.addEventListener("input", () => renderSearchResults(searchInput.value));
  searchInput.addEventListener("focus", () => renderSearchResults(searchInput.value));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box") && !e.target.closest(".search-results")) searchResults.hidden = true;
  });
  searchButton.addEventListener("click", () => {
    const collection = state.scale === "epci" ? state.epcis : state.communes;
    const q = searchInput.value.trim().toLowerCase();
    const match = collection.find((item) => item.name.toLowerCase() === q) || collection.find((item) => item.name.toLowerCase().includes(q));
    if (match) state.scale === "epci" ? selectEpci(match.code) : selectCommune(match.code);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchButton.click();
  });

  // ---------- Mode switch ----------
  function setMapScale(scale) {
    state.scale = scale;
    state.selected = null;
    searchInput.value = "";
    territorySearchLabel.textContent = scale === "epci" ? "Rechercher un EPCI" : "Rechercher une commune";
    searchInput.placeholder = scale === "epci" ? "Ex. Cergy-Pontoise" : "Ex. Pontoise";
    document.querySelectorAll("[data-map-scale]").forEach((b) => {
      const active = b.dataset.mapScale === scale;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("detailPanel").classList.remove("open");
    applyChoropleth();
    renderEmptyState();
  }
  document.querySelectorAll("[data-map-scale]").forEach((b) => b.addEventListener("click", () => setMapScale(b.dataset.mapScale)));

  // ---------- Mobile sidebar ----------
  const sidebarEl = document.getElementById("layerSidebar");
  const mobileLayersBtn = document.getElementById("mobileLayers");
  mobileLayersBtn.addEventListener("click", () => {
    const open = sidebarEl.classList.toggle("open");
    mobileLayersBtn.setAttribute("aria-expanded", String(open));
  });

  // ---------- Reset ----------
  document.getElementById("resetView").addEventListener("click", () => {
    state.selected = null;
    searchInput.value = "";
    searchResults.hidden = true;
    sidebarEl.classList.remove("open");
    mobileLayersBtn.setAttribute("aria-expanded", "false");
    document.getElementById("detailPanel").classList.remove("open");
    if (deptLayer) map.fitBounds(deptLayer.getBounds(), { padding: [0, 0], animate: false });
    else map.setView(VDO_CENTER, 10, { animate: false });
    applyChoropleth();
    renderEmptyState();
  });

  // ---------- Comprendre dialog ----------
  const comprendreDialog = document.getElementById("comprendreDialog");
  document.getElementById("openComprendre3")?.addEventListener("click", () => comprendreDialog.showModal());
  comprendreDialog.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => comprendreDialog.close()));
  comprendreDialog.addEventListener("click", (e) => { if (e.target === comprendreDialog) comprendreDialog.close(); });

  // « Données & évolutions » ouvre toujours la synthèse Val-d'Oise, jamais le
  // territoire sélectionné — ce lien existe déjà dans le panneau de détail.

  // ---------- Selection ----------
  function selectFromMap(code) {
    if (state.scale === "commune") { selectCommune(code); return; }
    const epci = epciForCommune(code);
    if (epci) selectEpci(epci.code);
  }

  function selectCommune(code) {
    state.scale = "commune";
    state.selected = code;
    const c = state.communesByCode.get(code);
    if (c) {
      searchInput.value = c.name;
      map.setView([c.lat, c.lon], Math.max(map.getZoom(), 11), { animate: false });
      document.getElementById("mapStatus").textContent = `${c.name} · profil affiché`;
    }
    applyChoropleth();
    renderDetail(code);
  }

  function selectEpci(code) {
    const epci = state.epcisByCode.get(code);
    if (!epci) return;
    state.scale = "epci";
    state.selected = code;
    searchInput.value = epci.name;
    const visibleLayers = [];
    epciLayer.eachLayer((layer) => { if (layer.feature.properties.code === code) visibleLayers.push(layer); });
    if (visibleLayers.length) map.fitBounds(L.featureGroup(visibleLayers).getBounds(), { padding: [45, 45], animate: false, maxZoom: 11 });
    document.getElementById("mapStatus").textContent = `${epci.name} · profil affiché`;
    applyChoropleth();
    renderDetail(code);
  }

  // ---------- Detail panel ----------
  function renderDetail(code) {
    const isEpci = state.scale === "epci";
    const p = isEpci ? state.epcisByCode.get(code) : state.communesByCode.get(code)?.profile;
    const detailPanel = document.getElementById("detailPanel");
    const detailContent = document.getElementById("detailContent");
    if (!p) { detailPanel.classList.remove("open"); return; }
    const name = isEpci ? p.name : state.communesByCode.get(code).name;
    const territoryType = isEpci && !p.special ? "EPCI" : "Commune";
    const profileUrl = isEpci ? `fiche.html?type=epci&id=${encodeURIComponent(code)}` : `fiche.html?type=commune&id=${encodeURIComponent(code)}`;

    const total = p.parc.total ? p.parc.total.value : null;
    const rp = p.parc.residences_principales.value;
    const vacRate = p.vacance.taux_vacance_rp.value;
    const rplsShare = p.social.part_rpls_residences_principales.value;
    const fgShare = p.renovation.dpe_fg_part.value;
    const dpeObs = p.renovation.dpe_observes.value;

    const partialNote = isEpci && p.perimetre_partiel ? `<div class="flag-note">Indicateurs calculés sur les ${p.members_covered.length} communes val-d’oisiennes de cet EPCI (périmètre complet : ${p.members.length} communes, débordant sur un département voisin).</div>` : "";

    detailContent.innerHTML = `
      <span class="detail-tag">${territoryType.toUpperCase()} · LOGEMENT · VAL-D'OISE</span>
      <h2>${name}</h2>
      <p class="subtitle">Parc, vacance, construction, rénovation</p>
      ${partialNote}
      <div class="kpi-grid">
        <div class="kpi-tile"><small>Logements (parc total)</small><strong>${fmt(total, "logements")}</strong></div>
        <div class="kpi-tile"><small>Résidences principales</small><strong>${fmt(rp, "logements")}</strong></div>
        <div class="kpi-tile${vacRate != null && vacRate > 8 ? " warn" : ""}"><small>Taux de vacance RP</small><strong>${fmt(vacRate, "%")}</strong></div>
        <div class="kpi-tile"><small>Part RPLS des RP</small><strong>${fmt(rplsShare, "%")}</strong></div>
      </div>
      <div class="section-block">
        <strong>Rénovation</strong>
        <div class="kpi-grid">
          <div class="kpi-tile${fgShare != null && fgShare > 25 ? " warn" : ""}"><small>Part F/G (DPE observés)</small><strong>${fmt(fgShare, "%")}</strong><em>${dpeObs ? Math.round(dpeObs).toLocaleString("fr-FR") + " DPE observés" : "Aucun DPE observé"}</em></div>
          <div class="kpi-tile"><small>Logements commencés</small><strong>${fmt(p.construction.commences_5ans.value, "logements")}</strong><em>Cumul 2021-2025</em></div>
        </div>
      </div>
      <div class="section-block">
        <strong>Marché immobilier</strong>
        <div class="kpi-grid">
          <div class="kpi-tile"><small>Prix médian au m²</small><strong>${fmt(p.marche?.prix_m2_median.value, "€/m²")}</strong><em>${p.marche?.prix_m2_median.denominator ? p.marche.prix_m2_median.denominator + " ventes 2023-2025" : "Trop peu de ventes"}</em></div>
          <div class="kpi-tile"><small>Loyer moyen (appartement)</small><strong>${fmt(p.marche?.loyer_m2_appartement.value, "€/m²/mois")}</strong><em>Carte des loyers 2025</em></div>
        </div>
      </div>
      <a class="profile-link" href="${profileUrl}" target="_blank" rel="noopener">Voir la fiche ${isEpci ? "EPCI" : "communale"} complète et le PDF <span>↗</span></a>
      <p class="detail-method">Sources : Insee 2023, RPLS 2025, LOVAC 2025, Sitadel3 2021-2025, ADEME DPE, DVF, carte des loyers DHUP. Détail et limites dans « Sources, millésimes et licences ».</p>
    `;
    detailPanel.classList.add("open");
  }

  function renderEmptyState() {
    document.getElementById("detailPanel").classList.remove("open");
    document.getElementById("mapStatus").textContent = `Val-d’Oise · sélectionnez ${state.scale === "epci" ? "un EPCI" : "une commune"} pour voir son profil logement`;
  }

  document.getElementById("closeDetail").addEventListener("click", () => document.getElementById("detailPanel").classList.remove("open"));
})();
