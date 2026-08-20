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
    departementProfile: null,
    synthesisRequested: false,
  };

  const LAYERS = {
    part_appartements: { label: "Part d’appartements", unit: "%", ramp: ["#eef7f8", "#00a7b5", "#004a52"], get: (p) => pct(p.parc.appartements.value, p.parc.residences_principales.value) },
    part_maisons: { label: "Part de maisons individuelles", unit: "%", ramp: ["#fdf3e7", "#c76524", "#5c2a0a"], get: (p) => pct(p.parc.maisons.value, p.parc.residences_principales.value) },
    part_avant_1971: { label: "Part de logements anciens (avant 1971)", unit: "%", ramp: ["#f5f0e6", "#b88a16", "#5c4200"], get: (p) => p.parc.part_avant_1971 ? p.parc.part_avant_1971.value : null },
    part_locataires: { label: "Part de locataires", unit: "%", ramp: ["#eef2f9", "#3978b8", "#0b2f57"], get: (p) => pct((p.occupation.locataires_prive.value || 0) + (p.occupation.locataires_social.value || 0), p.parc.residences_principales.value) },
    part_proprietaires: { label: "Part de propriétaires", unit: "%", ramp: ["#eef7ee", "#477a3c", "#173a13"], get: (p) => pct(p.occupation.proprietaires.value, p.parc.residences_principales.value) },
    rpls_count: { label: "Nombre de logements RPLS", unit: "logements", ramp: ["#f3eef9", "#6f4c9b", "#2e1a4d"], get: (p) => p.social.rpls_count.value },
    part_rpls: { label: "Part RPLS des résidences principales", unit: "%", ramp: ["#f3eef9", "#6f4c9b", "#2e1a4d"], get: (p) => p.social.part_rpls_residences_principales.value },
    financement_tres_social: { label: "Part très social (PLAI et assimilé) du parc RPLS", unit: "%", ramp: ["#fdeef2", "#c2185b", "#5c0a28"], get: (p) => p.social.part_financement_tres_social ? p.social.part_financement_tres_social.value : null },
    financement_social: { label: "Part social (PLUS/HLM-O et assimilé) du parc RPLS", unit: "%", ramp: ["#f3eef9", "#6f4c9b", "#2e1a4d"], get: (p) => p.social.part_financement_social ? p.social.part_financement_social.value : null },
    financement_intermediaire: { label: "Part intermédiaire (PLS/PLI et assimilé) du parc RPLS", unit: "%", ramp: ["#eef2f9", "#3978b8", "#0b2f57"], get: (p) => p.social.part_financement_intermediaire ? p.social.part_financement_intermediaire.value : null },
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

  let communesLayer, epciLayer, deptLayer, permisLouerLayer, rplsPointsLayer, dvfPointsLayer;
  const pointsRenderer = L.canvas({ padding: 0.5 });
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
    d3.json("data/processed/departement_profile.json"),
    d3.json("data/processed/market_departement_profile.json"),
    d3.json("data/processed/permis_louer.geojson"),
    d3.json("data/processed/rpls_points.geojson"),
    d3.json("data/processed/dvf_points.geojson"),
  ]).then(([dept95, communes95Geo, epcis95Geo, communes95, communeProfiles, epciProfiles, marketProfiles, marketEpciProfiles, departementProfile, marketDepartementProfile, permisLouerGeo, rplsPointsGeo, dvfPointsGeo]) => {
    deptLayer = L.geoJSON(dept95, { style: { color: "#000091", weight: 2, fill: false, opacity: 0.55 } }).addTo(map);

    permisLouerLayer = L.geoJSON(permisLouerGeo, {
      style: { color: "#ce0500", weight: 2, dashArray: "6 4", fillColor: "#ce0500", fillOpacity: 0.12 },
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(`Permis de louer — ${feature.properties.nom_commune}`, { sticky: true });
      },
    });

    rplsPointsLayer = L.geoJSON(rplsPointsGeo, {
      pointToLayer: (feature, latlng) => {
        const marker = L.circleMarker(latlng, {
          renderer: pointsRenderer, radius: 3.2, weight: 1, color: "#7a0300", fillColor: "#ce0500", fillOpacity: 0.85,
        });
        marker.bindTooltip(`${feature.properties.n} logement${feature.properties.n > 1 ? "s" : ""} social${feature.properties.n > 1 ? "aux" : ""}`, { sticky: true });
        marker.on("click", (e) => { L.DomEvent.stopPropagation(e); renderRplsPointDetail(feature.properties); });
        return marker;
      },
    });

    dvfPointsLayer = L.geoJSON(dvfPointsGeo, {
      pointToLayer: (feature, latlng) => {
        const marker = L.circleMarker(latlng, {
          renderer: pointsRenderer, radius: 2.6, weight: 0.8, color: "#5c0a70", fillColor: "#9c27b0", fillOpacity: 0.6,
        });
        marker.bindTooltip(`${feature.properties.t === "M" ? "Maison" : "Appartement"} · ${feature.properties.p.toLocaleString("fr-FR")} €/m² · ${feature.properties.y}`, { sticky: true });
        marker.on("click", (e) => { L.DomEvent.stopPropagation(e); renderDvfPointDetail(feature.properties); });
        return marker;
      },
    });

    Object.entries(marketProfiles).forEach(([code, m]) => { if (communeProfiles[code]) communeProfiles[code].marche = m; });
    Object.entries(marketEpciProfiles).forEach(([code, m]) => { if (epciProfiles[code]) epciProfiles[code].marche = m; });
    departementProfile.marche = marketDepartementProfile;

    state.communes = communes95.map((c) => ({ ...c, profile: communeProfiles[c.code] }));
    state.communesByCode = new Map(state.communes.map((c) => [c.code, c]));
    state.epcis = Object.values(epciProfiles);
    state.epcisByCode = new Map(state.epcis.map((e) => [e.code, e]));
    state.departementProfile = departementProfile;
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
    if (state.synthesisRequested) openSynthesisPanel();
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

  document.querySelectorAll(".layer-card:not(.overlay-card)").forEach((btn) => {
    btn.addEventListener("click", () => {
      const turningOff = btn.classList.contains("active");
      document.querySelectorAll(".layer-card:not(.overlay-card)").forEach((b) => b.classList.toggle("active", !turningOff && b === btn));
      state.activeLayer = turningOff ? null : btn.dataset.layer;
      state.selected = null;
      searchInput.value = "";
      document.getElementById("detailPanel").classList.remove("open");
      applyChoropleth();
      renderEmptyState();
    });
  });

  // Overlays de contexte (cumulables, indépendants de la couche choroplèthe active)
  const OVERLAY_LAYERS = { permis_louer: () => permisLouerLayer, rpls_points: () => rplsPointsLayer, dvf_points: () => dvfPointsLayer };
  document.querySelectorAll(".overlay-card[data-overlay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const active = btn.classList.toggle("active");
      const layer = OVERLAY_LAYERS[btn.dataset.overlay]?.();
      if (!layer) return;
      if (active) layer.addTo(map);
      else map.removeLayer(layer);
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
  const DPE_LABELS = { A: "A", B: "B", C: "C", D: "D", E: "E", F: "F", G: "G" };
  const FIN_LABELS = { ts: "Très social (PLAI et assimilé)", s: "Social (PLUS/HLM-O et assimilé)", i: "Intermédiaire (PLS/PLI et assimilé)", a: "Autre financement" };

  function barListHtml(counts, labels, total) {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => `<div class="bar-row"><span>${labels[key] || key}</span><div class="track"><div class="fill" style="width:${Math.max(6, (n / total) * 100)}%"></div></div><span>${n}</span></div>`)
      .join("");
  }

  function renderRplsPointDetail(p) {
    const detailPanel = document.getElementById("detailPanel");
    const detailContent = document.getElementById("detailContent");
    const dpeTotal = p.dpe ? Object.values(p.dpe).reduce((a, b) => a + b, 0) : 0;
    const finTotal = p.fin ? Object.values(p.fin).reduce((a, b) => a + b, 0) : 0;
    const periode = p.ymin ? (p.ymin === p.ymax ? `${p.ymin}` : `${p.ymin}–${p.ymax}`) : "Non disponible";
    detailContent.innerHTML = `
      <span class="detail-tag">BÂTIMENT · LOGEMENT SOCIAL</span>
      <h2>${p.a || "Adresse non renseignée"}</h2>
      <p class="subtitle">${p.cn} · RPLS, 1ᵉʳ janvier 2025</p>
      <div class="kpi-grid">
        <div class="kpi-tile"><small>Logements sociaux</small><strong>${p.n}</strong></div>
        <div class="kpi-tile"><small>Type dominant</small><strong>${p.t || "Non disponible"}</strong></div>
        <div class="kpi-tile"><small>Période de construction</small><strong>${periode}</strong></div>
        <div class="kpi-tile"><small>Bailleur</small><strong style="font-size:12px">Non disponible</strong><em>RPLS ne diffuse pas l'identité du propriétaire</em></div>
      </div>
      ${dpeTotal ? `<div class="section-block"><strong>DPE (${dpeTotal} logement${dpeTotal > 1 ? "s" : ""})</strong><div class="bar-list">${barListHtml(p.dpe, DPE_LABELS, dpeTotal)}</div></div>` : ""}
      ${finTotal ? `<div class="section-block"><strong>Financement (${finTotal} logement${finTotal > 1 ? "s" : ""})</strong><div class="bar-list">${barListHtml(p.fin, FIN_LABELS, finTotal)}</div></div>` : ""}
      <p class="detail-method">Source : SDES, RPLS 2025. Bâtiment dédoublonné par coordonnées ; le nom du bailleur n'est pas diffusé dans le fichier public.</p>
    `;
    detailPanel.classList.add("open");
  }

  function renderDvfPointDetail(p) {
    const detailPanel = document.getElementById("detailPanel");
    const detailContent = document.getElementById("detailContent");
    const typeLabel = p.t === "M" ? "Maison" : "Appartement";
    detailContent.innerHTML = `
      <span class="detail-tag">VENTE IMMOBILIÈRE · DVF</span>
      <h2>${p.a || "Adresse non renseignée"}</h2>
      <p class="subtitle">${p.cn} · vendu le ${p.d ? new Date(p.d).toLocaleDateString("fr-FR") : "date inconnue"}</p>
      <div class="kpi-grid">
        <div class="kpi-tile"><small>Prix au m²</small><strong>${p.p.toLocaleString("fr-FR")} €/m²</strong></div>
        <div class="kpi-tile"><small>Prix de vente</small><strong>${p.v.toLocaleString("fr-FR")} €</strong></div>
        <div class="kpi-tile"><small>Surface</small><strong>${p.s} m²</strong></div>
        <div class="kpi-tile"><small>Type</small><strong>${typeLabel}${p.pc ? ` · ${p.pc} pièce${p.pc > 1 ? "s" : ""}` : ""}</strong></div>
      </div>
      <p class="detail-method">Source : DGFiP, Demandes de valeurs foncières (DVF). Vente simple (un seul bien par mutation).</p>
    `;
    detailPanel.classList.add("open");
  }

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

  function nodeValue(node) {
    return node && node.value != null ? Number(node.value) : null;
  }

  function share(value, total) {
    return value == null || !total ? null : Math.max(0, (value / total) * 100);
  }

  function pctLabel(value) {
    return value == null ? "n. d." : value.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";
  }

  function percentageBar(label, value, color) {
    const width = value == null ? 0 : Math.max(2, Math.min(100, value));
    return `<div class="percentage-row"><div><span>${label}</span><b>${pctLabel(value)}</b></div><div class="percentage-track"><i style="--bar-width:${width}%;--bar-color:${color}"></i></div></div>`;
  }

  function annualConstructionChart(series) {
    if (!Array.isArray(series) || !series.length) return "";
    const max = Math.max(...series.flatMap((item) => [item.autorises || 0, item.commences || 0]), 1);
    const description = series.map((item) => `${item.annee} : ${fmt(item.autorises, "logements")} autorisés et ${fmt(item.commences, "logements")} commencés`).join(" ; ");
    const outer = 270;
    const inner = 207;
    return `<div class="construction-rounds" role="img" aria-label="${description}">${series.map((item) => {
      const authorizedShare = Math.max(0, (item.autorises || 0) / max);
      const startedShare = Math.max(0, (item.commences || 0) / max);
      return `<div class="construction-orbit">
        <div class="orbit-chart">
          <svg viewBox="0 0 112 112" aria-hidden="true">
            <circle class="orbit-track outer" cx="56" cy="56" r="43"></circle>
            <circle class="orbit-value authorized" cx="56" cy="56" r="43" stroke-dasharray="${outer * authorizedShare} ${outer}"></circle>
            <circle class="orbit-track inner" cx="56" cy="56" r="33"></circle>
            <circle class="orbit-value started" cx="56" cy="56" r="33" stroke-dasharray="${inner * startedShare} ${inner}"></circle>
          </svg>
          <b>${item.annee}</b>
        </div>
        <div class="orbit-values"><span class="authorized"><i></i><b>${Math.round(item.autorises || 0).toLocaleString("fr-FR")}</b><small>autorisés</small></span><span class="started"><i></i><b>${Math.round(item.commences || 0).toLocaleString("fr-FR")}</b><small>commencés</small></span></div>
      </div>`;
    }).join("")}</div>`;
  }

  function openSynthesisPanel() {
    state.synthesisRequested = true;
    const synthesisDialog = document.getElementById("synthesisDialog");
    const detailContent = document.getElementById("synthesisContent");
    let profile = state.departementProfile;
    let name = "Val-d’Oise";
    let territoryType = "Synthèse départementale";
    let profileUrl = "fiche.html?type=departement";

    if (state.selected && state.scale === "epci") {
      profile = state.epcisByCode.get(state.selected);
      name = profile?.name || name;
      territoryType = profile?.special ? "Synthèse communale" : "Synthèse EPCI";
      profileUrl = `fiche.html?type=epci&id=${encodeURIComponent(state.selected)}`;
    } else if (state.selected) {
      const commune = state.communesByCode.get(state.selected);
      profile = commune?.profile;
      name = commune?.name || name;
      territoryType = "Synthèse communale";
      profileUrl = `fiche.html?type=commune&id=${encodeURIComponent(state.selected)}`;
    }

    if (!profile) {
      detailContent.innerHTML = `<div class="synthesis-dashboard-head"><span class="detail-tag">DONNÉES & ÉVOLUTIONS</span><h2 id="synthesisTitle">Préparation de la synthèse…</h2><p>Les indicateurs territoriaux sont en cours de chargement.</p></div>`;
      if (!synthesisDialog.open) synthesisDialog.showModal();
      return;
    }

    state.synthesisRequested = false;
    const total = nodeValue(profile.parc.total);
    const rp = nodeValue(profile.parc.residences_principales);
    const vacant = nodeValue(profile.parc.logements_vacants_rp);
    const other = total == null || rp == null || vacant == null ? null : Math.max(0, total - rp - vacant);
    const owners = nodeValue(profile.occupation.proprietaires);
    const privateTenants = nodeValue(profile.occupation.locataires_prive);
    const socialTenants = nodeValue(profile.occupation.locataires_social);
    const otherOccupancy = rp == null ? null : Math.max(0, rp - (owners || 0) - (privateTenants || 0) - (socialTenants || 0));
    const authorized = nodeValue(profile.construction.autorises_5ans);
    const started = nodeValue(profile.construction.commences_5ans);
    const rplsShare = nodeValue(profile.social.part_rpls_residences_principales);
    const vacancyRate = nodeValue(profile.vacance.taux_vacance_rp);
    const longVacancy = nodeValue(profile.vacance.vacance_privee_longue_2025);
    const oldShare = nodeValue(profile.parc.part_avant_1971);
    const fgShare = nodeValue(profile.renovation.dpe_fg_part);
    const dpeObserved = nodeValue(profile.renovation.dpe_observes);
    const market = profile.marche || {};
    const salePrice = nodeValue(market.prix_m2_median);
    const flatRent = nodeValue(market.loyer_m2_appartement);
    const houseRent = nodeValue(market.loyer_m2_maison);
    const rpShare = share(rp, total);
    const vacantShare = share(vacant, total);
    const otherShare = share(other, total);
    const partialNote = profile.perimetre_partiel ? `<div class="flag-note">Indicateurs calculés uniquement sur les communes val-d’oisiennes couvertes par ce territoire.</div>` : "";

    detailContent.innerHTML = `
      <div class="synthesis-dashboard-head">
        <span class="detail-tag">DONNÉES & ÉVOLUTIONS · ${territoryType}</span>
        <h2 id="synthesisTitle">Le logement en chiffres · ${name}</h2>
        <p>Un tableau de bord pour lire le parc, le marché, la vacance, la construction et les besoins de rénovation.</p>
      </div>
      ${partialNote}
      <div class="synthesis-dashboard-kpis">
        <div class="kpi-tile"><small>Parc de logements</small><strong>${fmt(total, "logements")}</strong><em>${fmt(rp, "logements")} résidences principales</em></div>
        <div class="kpi-tile"><small>Logements sociaux RPLS</small><strong>${fmt(nodeValue(profile.social.rpls_count), "logements")}</strong><em>${pctLabel(rplsShare)} des résidences principales</em></div>
        <div class="kpi-tile${vacancyRate != null && vacancyRate > 8 ? " warn" : ""}"><small>Vacance au recensement</small><strong>${pctLabel(vacancyRate)}</strong><em>${fmt(vacant, "logements")}</em></div>
        <div class="kpi-tile"><small>Vacance privée +2 ans</small><strong>${fmt(longVacancy, "logements")}</strong><em>LOVAC 2025</em></div>
        <div class="kpi-tile${fgShare != null && fgShare > 25 ? " warn" : ""}"><small>DPE classés F ou G</small><strong>${pctLabel(fgShare)}</strong><em>sur ${fmt(dpeObserved, "diagnostics")}</em></div>
      </div>
      ${salePrice != null || flatRent != null ? `<section class="synthesis-viz" aria-labelledby="marketTitle">
        <div class="synthesis-section-head"><strong id="marketTitle">Marché du logement</strong><span>Dernières données disponibles</span></div>
        <div class="market-summary-grid">
          <div><small>Prix médian des ventes</small><strong>${salePrice == null ? "n. d." : Math.round(salePrice).toLocaleString("fr-FR") + " €/m²"}</strong><span>DVF · 2023-2025 · ${fmt(market.prix_m2_median?.denominator, "ventes")}</span></div>
          <div><small>Loyer appartement</small><strong>${flatRent == null ? "n. d." : flatRent.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " €/m²/mois"}</strong><span>Carte des loyers · 2025</span></div>
          ${houseRent == null ? "" : `<div><small>Loyer maison</small><strong>${houseRent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} €/m²/mois</strong><span>Carte des loyers · 2025</span></div>`}
        </div>
      </section>` : ""}
      <section class="synthesis-viz" aria-labelledby="parkStructureTitle">
        <div class="synthesis-section-head"><strong id="parkStructureTitle">Composition du parc</strong><span>Insee 2023</span></div>
        <div class="stacked-housing" role="img" aria-label="Résidences principales ${pctLabel(rpShare)}, logements vacants ${pctLabel(vacantShare)}, autres logements ${pctLabel(otherShare)}"><i class="main" style="--segment:${rpShare || 0}%"></i><i class="vacant" style="--segment:${vacantShare || 0}%"></i><i class="other" style="--segment:${otherShare || 0}%"></i></div>
        <div class="stacked-legend"><span><i class="main"></i>Résidences principales <b>${pctLabel(rpShare)}</b></span><span><i class="vacant"></i>Logements vacants <b>${pctLabel(vacantShare)}</b></span><span><i class="other"></i>Secondaires et occasionnels <b>${pctLabel(otherShare)}</b></span></div>
      </section>
      <section class="synthesis-viz" aria-labelledby="occupancyTitle">
        <div class="synthesis-section-head"><strong id="occupancyTitle">Statut d’occupation</strong><span>Résidences principales · Insee 2023</span></div>
        ${percentageBar("Propriétaires", share(owners, rp), "#000091")}
        ${percentageBar("Locataires du parc social", share(socialTenants, rp), "#00a7b5")}
        ${percentageBar("Locataires du parc privé", share(privateTenants, rp), "#e07a2f")}
        ${otherOccupancy > 0 ? percentageBar("Autres statuts", share(otherOccupancy, rp), "#a7b1ba") : ""}
      </section>
      <section class="synthesis-viz" aria-labelledby="constructionTitle">
        <div class="synthesis-section-head"><strong id="constructionTitle">Construction : volumes et évolution</strong><span>Sitadel3 · 2022-2025</span></div>
        <div class="construction-total-pills"><span class="authorized"><i></i>Autorisés sur 5 ans <b>${fmt(authorized, "logements")}</b></span><span class="started"><i></i>Commencés sur 5 ans <b>${fmt(started, "logements")}</b></span></div>
        ${annualConstructionChart(profile.construction.serie_annuelle)}
        <p class="viz-note">Cumul affiché : 2021-2025. Comparaison annuelle disponible : 2022-2025. Les données récentes sont incomplètes lorsque des documents ne sont pas encore reçus, notamment pour les mises en chantier 2025. Il s’agit d’autorisations et de chantiers, pas de logements livrés.</p>
      </section>
      <div class="synthesis-insights"><strong>Points de repère</strong><p><b>${pctLabel(oldShare)}</b> des résidences principales ont été construites avant 1971.</p><p><b>${pctLabel(rplsShare)}</b> des résidences principales correspondent au parc RPLS 2025.</p><p>Les DPE sont des observations : la part F/G repose sur <b>${fmt(dpeObserved, "diagnostics")}</b>.</p></div>
      <a class="profile-link" href="${profileUrl}">Ouvrir la fiche détaillée et les options PDF <span>→</span></a>
      <p class="detail-method">Sources : Insee RP 2023, SDES RPLS 2025, LOVAC 2025, Sitadel3 2021-2025 et ADEME DPE (extraction 2026). Les millésimes diffèrent selon les sources ; les comparaisons doivent respecter les définitions et ruptures méthodologiques indiquées.</p>
    `;
    document.getElementById("detailPanel").classList.remove("open");
    if (!synthesisDialog.open) synthesisDialog.showModal();
  }

  document.getElementById("openData").addEventListener("click", openSynthesisPanel);
  document.getElementById("openDataTop").addEventListener("click", openSynthesisPanel);

  const synthesisDialog = document.getElementById("synthesisDialog");
  synthesisDialog.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => synthesisDialog.close()));
  synthesisDialog.addEventListener("click", (event) => { if (event.target === synthesisDialog) synthesisDialog.close(); });

  function renderEmptyState() {
    document.getElementById("detailPanel").classList.remove("open");
    document.getElementById("mapStatus").textContent = `Val-d’Oise · sélectionnez ${state.scale === "epci" ? "un EPCI" : "une commune"} pour voir son profil logement`;
  }

  document.getElementById("closeDetail").addEventListener("click", () => document.getElementById("detailPanel").classList.remove("open"));

  function printTerritories() {
    const source = state.scale === "epci" ? epciLayer : communesLayer;
    if (!source) return { type: "FeatureCollection", features: [] };
    const features = [];
    source.eachLayer((layer) => {
      if (!layer.feature) return;
      const feature = layer.toGeoJSON();
      const code = layer.feature.properties.code;
      const profile = state.scale === "epci" ? state.epcisByCode.get(code) : state.communesByCode.get(code)?.profile;
      const printValue = state.activeLayer && profile ? layerValue(LAYERS[state.activeLayer], profile) : null;
      feature.properties = { ...feature.properties, _printValue: printValue, _printStyle: {
        color: layer.options.color,
        weight: layer.options.weight,
        opacity: layer.options.opacity,
        fillColor: layer.options.fillColor,
        fillOpacity: layer.options.fillOpacity,
      } };
      features.push(feature);
    });
    return { type: "FeatureCollection", features };
  }

  function printOverlays() {
    return [
      ["permis_louer", "Zones permis de louer", permisLouerLayer, { color: "#ce0500", weight: 2, dashArray: "6 4", fillColor: "#ce0500", fillOpacity: 0.12 }],
      ["rpls_points", "Bâtiments de logements sociaux", rplsPointsLayer, { color: "#7a0300", fillColor: "#ce0500", radius: 3.2 }],
      ["dvf_points", "Ventes immobilières 2023-2025", dvfPointsLayer, { color: "#5c0a70", fillColor: "#9c27b0", radius: 2.6 }],
    ].filter(([, , layer]) => layer && map.hasLayer(layer)).map(([id, label, layer, style]) => ({ id, label, data: layer.toGeoJSON(), style }));
  }

  window.logementApp = {
    state,
    map,
    layers: LAYERS,
    department: () => deptLayer?.toGeoJSON(),
    territories: printTerritories,
    overlays: printOverlays,
  };
  document.getElementById("printMap").addEventListener("click", () => {
    const preview = new URLSearchParams(location.search).has("printPreview");
    window.open(`print.html${preview ? "?preview=1" : ""}`, "_blank");
  });
})();
