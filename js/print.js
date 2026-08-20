(function () {
  "use strict";
  const openerWindow = window.opener;
  const app = openerWindow && openerWindow.logementApp;
  const statusEl = document.getElementById("pdfStatus");
  const previewMode = new URLSearchParams(location.search).get("preview") === "1";
  if (!app) {
    document.body.innerHTML = '<p style="padding:40px;font:16px Marianne,Arial,sans-serif">Cette page s’ouvre depuis le bouton « Imprimer la carte » de Logement & Habitat.</p>';
    return;
  }

  const { state, map: liveMap, layers } = app;
  const layerDef = state.activeLayer ? layers[state.activeLayer] : null;
  const territoryType = state.scale === "epci" ? "EPCI" : "communes";
  let selectedName = "";
  if (state.selected) selectedName = state.scale === "epci" ? state.epcisByCode.get(state.selected)?.name : state.communesByCode.get(state.selected)?.name;
  document.getElementById("printTitle").textContent = layerDef ? layerDef.label : "Logement & Habitat dans le Val-d’Oise";
  document.getElementById("printSubtitle").textContent = `${territoryType === "EPCI" ? "Lecture par EPCI" : "Lecture communale"}${selectedName ? ` · ${selectedName} sélectionné` : ""}`;
  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  document.getElementById("printSources").innerHTML = `<span class="src-line">Sources : Insee · SDES RPLS · Cerema LOVAC · Sitadel3 · ADEME · DGFiP · DHUP</span><span class="src-line">Auteur : DDT 95</span><span class="src-line">Date : ${today}</span>`;

  const territories = app.territories();
  const overlays = app.overlays();
  const values = territories.features.map((f) => Number(f.properties?._printValue)).filter(Number.isFinite);
  const styles = territories.features.map((f) => f.properties?._printStyle).filter(Boolean);
  const first = styles[0] || {};
  const ramp = layerDef?.ramp || [first.fillColor || "#dce8f1", first.fillColor || "#dce8f1"];
  const valueLabels = layerDef && values.length ? `<div class="legend-range"><span>${formatValue(Math.min(...values), layerDef.unit)}</span><span>${formatValue(Math.max(...values), layerDef.unit)}</span></div><small class="legend-note">Gris : donnée non disponible ou secrétisée</small>` : "";
  const overlayLegend = overlays.length ? `<div class="legend-overlays">${overlays.map((o) => `<span><i class="${o.id.includes("points") ? "point" : ""}" style="background:${o.style.fillColor};border-color:${o.style.color}"></i>${o.label}</span>`).join("")}</div>` : "";
  document.getElementById("printLegend").innerHTML = layerDef ? `<strong class="legend-title">${layerDef.label}</strong><div class="legend-ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></div>${valueLabels}${overlayLegend}` : `<strong class="legend-title">Territoires du Val-d’Oise</strong>${overlayLegend || '<div class="legend-empty">Aucune couche thématique sélectionnée</div>'}`;

  function formatValue(value, unit) {
    if (!Number.isFinite(value)) return "n. d.";
    if (unit === "%") return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
    return `${Math.round(value).toLocaleString("fr-FR")}${unit ? ` ${unit}` : ""}`;
  }

  const map = L.map("printMapCanvas", { zoomControl: false, attributionControl: false, preferCanvas: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false });
  const NeutralTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("canvas");
      const size = this.getTileSize(); tile.width = size.x; tile.height = size.y;
      const context = tile.getContext("2d"); const image = new Image(); image.crossOrigin = "anonymous";
      image.onload = () => {
        context.drawImage(image, 0, 0, size.x, size.y); const pixels = context.getImageData(0, 0, size.x, size.y); const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) { const gray = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]; data[i] = Math.min(255, gray * 1.08); data[i + 1] = Math.min(255, gray * 1.08); data[i + 2] = Math.min(255, gray * 1.08); }
        context.putImageData(pixels, 0, 0); done(null, tile);
      };
      image.onerror = (error) => done(error, tile); image.src = this.getTileUrl(coords); return tile;
    },
  });
  new NeutralTileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

  const territoryLayer = L.geoJSON(territories, { style: (feature) => ({ ...feature.properties._printStyle, interactive: false }) }).addTo(map);
  overlays.forEach((overlay) => L.geoJSON(overlay.data, {
    style: overlay.style,
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: overlay.style.radius || 3, weight: 1, color: overlay.style.color, fillColor: overlay.style.fillColor, fillOpacity: .86 }),
  }).addTo(map));
  const department = app.department();
  if (department) L.geoJSON(department, { interactive: false, style: { color: "#000091", weight: 2.2, opacity: .9, fillOpacity: 0 } }).addTo(map);
  map.invalidateSize();
  if (territoryLayer.getBounds().isValid()) map.fitBounds(territoryLayer.getBounds(), { padding: [24, 24] });
  else map.setView(liveMap.getCenter(), liveMap.getZoom());

  function niceScaleNumber(number) { const power = Math.pow(10, String(Math.floor(number)).length - 1); const digit = number / power; return power * (digit >= 10 ? 10 : digit >= 5 ? 5 : digit >= 3 ? 3 : digit >= 2 ? 2 : 1); }
  function renderScaleBar() {
    const targetPx = 160, size = map.getSize(), y = size.y / 2, maxMeters = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([targetPx, y])), meters = niceScaleNumber(maxMeters), fullPx = targetPx * meters / maxMeters, segments = 4, segmentPx = fullPx / segments, unit = meters >= 1000 ? meters / 1000 : meters, unitLabel = meters >= 1000 ? "km" : "m";
    const bars = Array.from({ length: segments }, (_, i) => `<div class="scale-seg ${i % 2 ? "off" : "on"}" style="width:${segmentPx}px"></div>`).join("");
    const ticks = Array.from({ length: segments + 1 }, (_, i) => `<span style="left:${i * segmentPx}px">${(unit / segments * i).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</span>`).join("");
    document.getElementById("printScale").innerHTML = `<div class="scale-frame" style="width:${fullPx}px"><div class="scale-bar-row">${bars}</div><div class="scale-ticks" style="width:${fullPx}px">${ticks}<span class="scale-unit" style="left:${fullPx}px">${unitLabel}</span></div></div>`;
  }
  async function buildPdf() {
    const canvas = await html2canvas(document.getElementById("printPage"), { scale: 2.2, useCORS: true, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
    pdf.addImage(canvas.toDataURL("image/jpeg", .92), "JPEG", 0, 0, 420, 297, undefined, "FAST");
    window.location.replace(URL.createObjectURL(pdf.output("blob")));
  }
  map.whenReady(() => setTimeout(() => {
    map.invalidateSize();
    if (territoryLayer.getBounds().isValid()) map.fitBounds(territoryLayer.getBounds(), { padding: [24, 24] });
    renderScaleBar();
    if (previewMode) { statusEl.classList.add("done"); return; }
    setTimeout(() => buildPdf().catch((error) => { console.error(error); statusEl.innerHTML = "La génération du PDF a échoué.<small>Ferme cette page et réessaie depuis la carte.</small>"; }), 900);
  }, 500));
})();
