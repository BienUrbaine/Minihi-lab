(() => {
  const BDNB_ENDPOINT =
    "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet/bbox";
  const BDNB_RNC_ENDPOINT =
    "https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_rnc";
  const SEARCH_RADIUS_METERS = 30;
  const CANDIDATE_PAGE_SIZE = 10;
  const BDNB_FIELDS = [
    "batiment_groupe_id",
    "geom_groupe",
    "usage_principal_bdnb_open",
    "annee_construction",
    "annee_construction_dpe",
    "classe_bilan_dpe",
    "emission_ges_5_usages_m2",
    "type_isolation_mur_exterieur",
    "type_isolation_plancher_bas",
    "type_isolation_plancher_haut",
    "type_vitrage",
    "type_materiaux_menuiserie",
    "type_ventilation",
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

  function geometryContainsPoint(point, geometry) {
    if (geometry?.type === "Polygon") {
      return polygonContainsPoint(geometry.coordinates, point);
    }
    if (geometry?.type === "MultiPolygon") {
      return geometry.coordinates.some((polygon) =>
        polygonContainsPoint(polygon, point),
      );
    }
    return false;
  }

  function closestBuilding(buildings, point) {
    return buildings
      .map((building) => ({
        building,
        containsPoint: geometryContainsPoint(point, building.geom_groupe),
        distance: distanceToGeometry(point, building.geom_groupe),
      }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((left, right) => {
        if (left.containsPoint !== right.containsPoint) {
          return left.containsPoint ? -1 : 1;
        }
        if (left.distance !== right.distance) {
          return left.distance - right.distance;
        }
        const leftId = String(left.building.batiment_groupe_id || "");
        const rightId = String(right.building.batiment_groupe_id || "");
        if (leftId < rightId) return -1;
        if (leftId > rightId) return 1;
        return 0;
      })[0]?.building;
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
    if (!building) return "Inconnue";

    const registrationNumber = availableValue(
      building?.rncRecord?.numero_immat_principal,
    )
      ? building.rncRecord.numero_immat_principal
      : building.numero_immat_principal;

    if (availableValue(registrationNumber)) {
      const totalLots = numericValue(building?.rncRecord?.nb_lot_tot);
      return totalLots === null ? "Oui" : `Oui · ${totalLots} lots`;
    }

    if (building.rncLookupCompleted === true) return "Non identifiée";
    return "Inconnue";
  }

  function formatHeritage(building) {
    const constraint = booleanValue(building?.contrainte_urbanisme_ac1);
    if (constraint === true) return "Abords d’un monument historique";
    if (constraint === false) return "Hors périmètre AC1";
    return "Inconnu";
  }

  function formatNetworkDistance(value) {
    if (!availableValue(value)) return "Inconnu";
    const normalized = String(value).trim().toLowerCase();
    const labels = {
      "supérieur à 400m": "> 400 m",
      "entre 100 et 200m": "100–200 m",
      "entre 200 et 400m": "200–400 m",
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
        (row) => {
          const value = String(row.value);
          const valueClass =
            value === "Inconnu" || value === "Inconnue"
              ? "value-unknown"
              : value === "Non identifié" || value === "Non identifiée"
                ? "value-not-identified"
                : "";
          const valueMarkup = valueClass
            ? `<em class="${valueClass}">${escapeHtml(value)}</em>`
            : escapeHtml(value);

          return `
          <div class="commune-row">
            <span><strong>${escapeHtml(row.label)} :</strong> ${valueMarkup}</span>
          </div>
        `;
        },
      )
      .join("");
  }

  function envelopeValue(value, fallback) {
    if (!availableValue(value)) return fallback;
    const rawText = String(value).trim();
    if (/^inconnue?$/i.test(rawText)) return fallback;

    const accentCorrections = [
      [/\bnon isole\b/gi, "non isolé"],
      [/\bisole\b/gi, "isolé"],
      [/\bmecanique\b/gi, "mécanique"],
      [/\breglable\b/gi, "réglable"],
      [/\bapres\b/gi, "après"],
      [/\binterieur\b/gi, "intérieur"],
      [/\bexterieur\b/gi, "extérieur"],
      [/\bmetal\b/gi, "métal"],
    ];

    let text = accentCorrections.reduce(
      (current, [pattern, replacement]) => current.replace(pattern, replacement),
      rawText,
    );
    text = text.replace(/\bpvc\b/gi, "PVC");
    return text.charAt(0).toLocaleUpperCase("fr-FR") + text.slice(1);
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
    const envelope = [
      {
        label: "Murs extérieurs",
        value: envelopeValue(
          building?.type_isolation_mur_exterieur,
          "Inconnu",
        ),
      },
      {
        label: "Plancher bas",
        value: envelopeValue(building?.type_isolation_plancher_bas, "Inconnu"),
      },
      {
        label: "Plancher haut / toiture",
        value: envelopeValue(
          building?.type_isolation_plancher_haut,
          "Inconnu",
        ),
      },
      {
        label: "Vitrage",
        value: envelopeValue(building?.type_vitrage, "Inconnu"),
      },
      {
        label: "Menuiseries",
        value: envelopeValue(
          building?.type_materiaux_menuiserie,
          "Inconnue",
        ),
      },
      {
        label: "Ventilation",
        value: envelopeValue(building?.type_ventilation, "Inconnue"),
      },
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
      <div class="building-block building-envelope">
        <p class="field-label">Enveloppe du bâtiment</p>
        ${rowsMarkup(envelope)}
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

  function endpointUrl(point, offset = 0) {
    const [x, y] = point;
    const parameters = new URLSearchParams({
      xmin: String(x - SEARCH_RADIUS_METERS),
      ymin: String(y - SEARCH_RADIUS_METERS),
      xmax: String(x + SEARCH_RADIUS_METERS),
      ymax: String(y + SEARCH_RADIUS_METERS),
      srid: "2154",
      select: BDNB_FIELDS.join(","),
      limit: String(CANDIDATE_PAGE_SIZE),
      offset: String(offset),
      order: "batiment_groupe_id.asc",
    });
    return `${BDNB_ENDPOINT}?${parameters}`;
  }

  async function fetchCandidateBuildings(point, signal) {
    const buildings = [];
    const buildingIds = new Set();

    for (let offset = 0; ; offset += CANDIDATE_PAGE_SIZE) {
      const response = await fetch(endpointUrl(point, offset), {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`BDNB HTTP ${response.status}`);

      const page = await response.json();
      if (!Array.isArray(page)) break;

      let addedBuildings = 0;
      page.forEach((building) => {
        const buildingId = String(building?.batiment_groupe_id || "");
        if (!buildingId || buildingIds.has(buildingId)) return;
        buildingIds.add(buildingId);
        buildings.push(building);
        addedBuildings += 1;
      });

      if (page.length < CANDIDATE_PAGE_SIZE || addedBuildings === 0) break;
    }

    return buildings;
  }

  function rncEndpointUrl(buildingId) {
    const parameters = new URLSearchParams({
      batiment_groupe_id: `eq.${buildingId}`,
      select: "numero_immat_principal,nb_lot_tot",
      limit: "1",
    });
    return `${BDNB_RNC_ENDPOINT}?${parameters}`;
  }

  async function enrichWithRnc(building, signal) {
    if (!availableValue(building?.batiment_groupe_id)) return building;

    try {
      const response = await fetch(
        rncEndpointUrl(building.batiment_groupe_id),
        {
          signal,
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) throw new Error(`BDNB RNC HTTP ${response.status}`);
      const records = await response.json();
      return {
        ...building,
        rncLookupCompleted: true,
        rncRecord: Array.isArray(records) ? records[0] || null : null,
      };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      console.warn("Informations RNC indisponibles", error);
      return building;
    }
  }

  async function loadBuilding(longitude, latitude) {
    requestNumber += 1;
    const currentRequest = requestNumber;
    if (requestController) requestController.abort();
    requestController = new AbortController();
    renderUnknownBuilding();

    const point = longitudeLatitudeToLambert93(longitude, latitude);

    try {
      const buildings = await fetchCandidateBuildings(
        point,
        requestController.signal,
      );
      if (currentRequest !== requestNumber) return;
      const selectedBuilding = closestBuilding(buildings, point);
      if (!selectedBuilding) {
        renderUnknownBuilding();
        return;
      }
      const enrichedBuilding = await enrichWithRnc(
        selectedBuilding,
        requestController.signal,
      );
      if (currentRequest !== requestNumber) return;
      renderSelectedBuilding(enrichedBuilding);
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
