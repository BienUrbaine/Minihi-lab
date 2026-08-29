(() => {
  const BDNB_ENDPOINT =
    "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox";
  const SEARCH_RADIUS_METERS = 30;
  const BDNB_FIELDS = [
    "batiment_groupe_id",
    "geom_groupe",
    "annee_construction",
    "annee_construction_dpe",
    "classe_bilan_dpe",
    "emission_ges_5_usages_m2",
    "surface_emprise_sol",
  ];

  let requestController = null;
  let requestNumber = 0;

  function longitudeLatitudeToLambert93(longitude, latitude) {
    const longitudeRadians = (longitude * Math.PI) / 180;
    const latitudeRadians = (latitude * Math.PI) / 180;
    const n = 0.725607765053267;
    const c = 11754255.426096;
    const falseEasting = 700000;
    const falseNorthing = 12655612.049876;
    const centralMeridian = (3 * Math.PI) / 180;
    const eccentricity = 0.081819191042816;
    const latitudeIso =
      Math.atanh(Math.sin(latitudeRadians)) -
      eccentricity * Math.atanh(eccentricity * Math.sin(latitudeRadians));
    const radius = c * Math.exp(-n * latitudeIso);
    const angle = n * (longitudeRadians - centralMeridian);

    return [
      falseEasting + radius * Math.sin(angle),
      falseNorthing - radius * Math.cos(angle),
    ];
  }

  function distanceToSegment(point, start, end) {
    const [x, y] = point;
    const [x1, y1] = start;
    const [x2, y2] = end;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(x - x1, y - y1);
    const ratio = Math.max(
      0,
      Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared),
    );
    return Math.hypot(x - (x1 + ratio * dx), y - (y1 + ratio * dy));
  }

  function distanceToRing(point, ring) {
    let distance = Infinity;
    for (let index = 0; index < ring.length - 1; index += 1) {
      distance = Math.min(
        distance,
        distanceToSegment(point, ring[index], ring[index + 1]),
      );
    }
    return distance;
  }

  function distanceToPolygon(point, polygon) {
    if (!polygon?.length) return Infinity;
    if (polygonContainsPoint(polygon, point)) return 0;
    return distanceToRing(point, polygon[0]);
  }

  function distanceToGeometry(point, geometry) {
    if (geometry?.type === "Polygon") {
      return distanceToPolygon(point, geometry.coordinates);
    }
    if (geometry?.type === "MultiPolygon") {
      return Math.min(
        ...geometry.coordinates.map((polygon) =>
          distanceToPolygon(point, polygon),
        ),
      );
    }
    return Infinity;
  }

  function closestBuilding(buildings, point) {
    return buildings
      .map((building) => ({
        building,
        distance: distanceToGeometry(point, building.geom_groupe),
      }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((left, right) => left.distance - right.distance)[0]?.building;
  }

  function buildingSection() {
    let section = resultBox.querySelector(".building-info");
    if (!section) {
      section = document.createElement("section");
      section.className = "building-info";
      section.setAttribute("aria-live", "polite");
      resultBox.append(section);
    }
    return section;
  }

  function showBuildingStatus(message) {
    buildingSection().innerHTML = `
      <p class="field-label">Informations bâtiment</p>
      <p class="building-info-status">${escapeHtml(message)}</p>
    `;
  }

  function availableValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function renderBuilding(building) {
    if (!building) {
      showBuildingStatus("Aucune information BDNB disponible pour cette adresse");
      return;
    }

    const rows = [];
    const constructionYear = availableValue(building.annee_construction)
      ? building.annee_construction
      : building.annee_construction_dpe;

    if (availableValue(constructionYear)) {
      rows.push({ label: "Construction", value: String(constructionYear) });
    }
    if (availableValue(building.classe_bilan_dpe)) {
      rows.push({ label: "DPE représentatif", value: building.classe_bilan_dpe });
    }
    if (Number.isFinite(Number(building.emission_ges_5_usages_m2))) {
      rows.push({
        label: "Émissions GES",
        value: `${Number(building.emission_ges_5_usages_m2).toLocaleString("fr-FR", {
          maximumFractionDigits: 1,
        })} kgCO₂e/m²/an`,
      });
    }
    if (Number.isFinite(Number(building.surface_emprise_sol))) {
      rows.push({
        label: "Emprise au sol",
        value: `${Math.round(Number(building.surface_emprise_sol)).toLocaleString("fr-FR")} m²`,
      });
    }

    if (!rows.length) {
      showBuildingStatus("Non disponible");
      return;
    }

    const rowsMarkup = rows
      .slice(0, 4)
      .map(
        (row) => `
          <div class="commune-row">
            <span><strong>${escapeHtml(row.label)} :</strong> ${escapeHtml(row.value)}</span>
          </div>
        `,
      )
      .join("");

    buildingSection().innerHTML = `
      <p class="field-label">Informations bâtiment</p>
      ${rowsMarkup}
    `;
  }

  function endpointUrl(point) {
    const [x, y] = point;
    const parameters = new URLSearchParams({
      xmin: String(x - SEARCH_RADIUS_METERS),
      ymin: String(y - SEARCH_RADIUS_METERS),
      xmax: String(x + SEARCH_RADIUS_METERS),
      ymax: String(y + SEARCH_RADIUS_METERS),
      srid: "2154",
      select: BDNB_FIELDS.join(","),
      limit: "10",
    });
    return `${BDNB_ENDPOINT}?${parameters}`;
  }

  async function loadBuilding(longitude, latitude) {
    requestNumber += 1;
    const currentRequest = requestNumber;
    if (requestController) requestController.abort();
    requestController = new AbortController();
    showBuildingStatus("Chargement des informations BDNB…");

    const point = longitudeLatitudeToLambert93(longitude, latitude);

    try {
      const response = await fetch(endpointUrl(point), {
        signal: requestController.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`BDNB HTTP ${response.status}`);
      const buildings = await response.json();
      if (currentRequest !== requestNumber) return;
      renderBuilding(closestBuilding(buildings, point));
    } catch (error) {
      if (error.name === "AbortError" || currentRequest !== requestNumber) return;
      console.warn("Informations BDNB indisponibles", error);
      showBuildingStatus("Informations bâtiment momentanément indisponibles");
    }
  }

  window.addEventListener("minihi:result-rendered", (event) => {
    const longitude = Number(event.detail?.longitude);
    const latitude = Number(event.detail?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    loadBuilding(longitude, latitude);
  });
})();
