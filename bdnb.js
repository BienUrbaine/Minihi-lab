(() => {
  const BDNB_ENDPOINT =
    "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox";
  const SEARCH_RADIUS_METERS = 30;
  const BDNB_FIELDS = [
    "batiment_groupe_id",
    "geom_groupe",
    "usage_principal_bdnb_open",
    "annee_construction",
    "annee_construction_dpe",
    "classe_bilan_dpe",
    "emission_ges_5_usages_m2",
    "type_energie_chauffage",
    "type_installation_chauffage",
    "type_generateur_chauffage_anciennete",
    "numero_immat_principal",
    "contrainte_urbanisme_ac1",
    "indicateur_distance_au_reseau",
    "batenr_favorabilite_solaire_thermique",
    "batenr_favorabilite_geothermie_nappe",
    "batenr_favorabilite_geothermie_sonde",
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

  function availableValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function numericValue(value) {
    if (!availableValue(value)) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function booleanValue(value) {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    return null;
  }

  function formatEnergy(value) {
    if (!availableValue(value)) return null;
    const normalized = String(value).trim().toLowerCase();
    const labels = {
      electricite: "Électricité",
      gaz: "Gaz",
      fioul: "Fioul",
      bois: "Bois",
      charbon: "Charbon",
      solaire: "Solaire",
      "reseau de chaleur": "Réseau de chaleur",
      "reseau de froid": "Réseau de froid",
      "gpl/butane/propane": "GPL / butane / propane",
    };
    return labels[normalized] || String(value).trim();
  }

  function formatHeating(building) {
    const energy = formatEnergy(building?.type_energie_chauffage);
    const installation = availableValue(building?.type_installation_chauffage)
      ? String(building.type_installation_chauffage).trim().toLowerCase()
      : null;
    const rawAge = availableValue(building?.type_generateur_chauffage_anciennete)
      ? String(building.type_generateur_chauffage_anciennete).trim().toLowerCase()
      : null;
    const ageLabels = {
      "récent(<15ans)": "récent",
    };
    const age = rawAge ? ageLabels[rawAge] || rawAge : null;

    if (!energy && !installation && !age) return "Inconnu";
    return [
      energy || "énergie inconnue",
      installation || "installation inconnue",
      age || "ancienneté inconnue",
    ].join(" · ");
  }

  function formatCopropriete(building) {
    return availableValue(building?.numero_immat_principal)
      ? "Oui"
      : "Inconnue";
  }

  function formatHeritage(building) {
    const constraint = booleanValue(building?.contrainte_urbanisme_ac1);
    if (constraint === true) return "Abords d’un monument historique";
    if (constraint === false) return "Aucun périmètre AC1 identifié";
    return "Inconnu";
  }

  function formatNetworkDistance(value) {
    if (!availableValue(value)) return "Inconnu";
    const normalized = String(value).trim().toLowerCase();
    const labels = {
      "supérieur à 400m": "> 400 m",
      "entre 100 et 200m": "100 à 200 m",
      "entre 200 et 400m": "200 à 400 m",
      "inferieure à 100m": "< 100 m",
      "inférieure à 100m": "< 100 m",
      "raccordé au reseau de chaleur": "Raccordé",
      "raccordé au réseau de chaleur": "Raccordé",
    };
    return labels[normalized] || String(value).trim();
  }

  function formatFavorability(value) {
    const favorability = booleanValue(value);
    if (favorability === true) return "Favorable";
    if (favorability === false) return "Défavorable";
    return "Inconnu";
  }

  function formatGeothermal(building) {
    const aquifer = booleanValue(
      building?.batenr_favorabilite_geothermie_nappe,
    );
    const borehole = booleanValue(
      building?.batenr_favorabilite_geothermie_sonde,
    );

    if (aquifer === null && borehole === null) return "Inconnue";
    if (aquifer === true && borehole === true) {
      return "Favorable sur nappe et sondes";
    }
    if (aquifer === true && borehole === false) return "Favorable sur nappe";
    if (aquifer === false && borehole === true) return "Favorable sur sondes";
    if (aquifer === false && borehole === false) return "Défavorable";
    if (aquifer === true) return "Nappe favorable · sondes inconnues";
    if (borehole === true) return "Sondes favorables · nappe inconnue";
    if (aquifer === false) return "Nappe défavorable · sondes inconnues";
    return "Sondes défavorables · nappe inconnue";
  }

  function rowsMarkup(rows) {
    return rows
      .map(
        (row) => `
          <div class="commune-row">
            <span><strong>${escapeHtml(row.label)} :</strong> ${escapeHtml(row.value)}</span>
          </div>
        `,
      )
      .join("");
  }

  function renderBuilding(building) {
    const constructionYear =
      numericValue(building?.annee_construction) ??
      numericValue(building?.annee_construction_dpe);
    const ges = numericValue(building?.emission_ges_5_usages_m2);
    const characteristics = [
      {
        label: "Usage",
        value: availableValue(building?.usage_principal_bdnb_open)
          ? String(building.usage_principal_bdnb_open).trim()
          : "Inconnu",
      },
      {
        label: "Année de construction",
        value: constructionYear === null ? "Inconnue" : String(constructionYear),
      },
      {
        label: "DPE représentatif",
        value: availableValue(building?.classe_bilan_dpe)
          ? String(building.classe_bilan_dpe).trim().toUpperCase()
          : "Inconnu",
      },
      {
        label: "GES estimé",
        value:
          ges === null
            ? "Inconnu"
            : `${ges.toLocaleString("fr-FR", {
                maximumFractionDigits: 1,
              })} kgCO₂e/m²/an`,
      },
      { label: "Chauffage", value: formatHeating(building) },
      { label: "Copropriété", value: formatCopropriete(building) },
    ];
    const renovationContext = [
      { label: "Patrimoine", value: formatHeritage(building) },
      {
        label: "Réseau de chaleur",
        value: formatNetworkDistance(building?.indicateur_distance_au_reseau),
      },
      {
        label: "Solaire thermique",
        value: formatFavorability(
          building?.batenr_favorabilite_solaire_thermique,
        ),
      },
      { label: "Géothermie", value: formatGeothermal(building) },
    ];

    buildingSection().innerHTML = `
      <div class="building-block">
        <p class="field-label">Caractéristiques du bâtiment</p>
        ${rowsMarkup(characteristics)}
      </div>
      <div class="building-block building-context">
        <p class="field-label">Contexte de rénovation</p>
        ${rowsMarkup(renovationContext)}
      </div>
    `;
  }

  function renderUnknownBuilding() {
    renderBuilding(null);
  }

  function renderSelectedBuilding(building) {
    if (!building) {
      renderUnknownBuilding();
      return;
    }
    renderBuilding(building);
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
    renderUnknownBuilding();

    const point = longitudeLatitudeToLambert93(longitude, latitude);

    try {
      const response = await fetch(endpointUrl(point), {
        signal: requestController.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`BDNB HTTP ${response.status}`);
      const buildings = await response.json();
      if (currentRequest !== requestNumber) return;
      renderSelectedBuilding(closestBuilding(buildings, point));
    } catch (error) {
      if (error.name === "AbortError" || currentRequest !== requestNumber) return;
      console.warn("Informations BDNB indisponibles", error);
      renderUnknownBuilding();
    }
  }

  window.addEventListener("minihi:result-rendered", (event) => {
    const longitude = Number(event.detail?.longitude);
    const latitude = Number(event.detail?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    loadBuilding(longitude, latitude);
  });
})();
