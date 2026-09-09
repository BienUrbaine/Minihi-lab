(() => {
  const DPE_ENDPOINT =
    "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines";
  const MAX_RESULTS = 200;
  const DPE_FIELDS = [
    "numero_dpe",
    "date_derniere_modification_dpe",
    "date_etablissement_dpe",
    "date_fin_validite_dpe",
    "numero_dpe_remplace",
    "etiquette_dpe",
    "etiquette_ges",
    "type_batiment",
    "surface_habitable_logement",
    "surface_habitable_immeuble",
    "identifiant_ban",
  ];
  const AUDIT_FIELDS = [
    "n_audit",
    "id_etape",
    "categorie_scenario",
    "etape_travaux",
    "date_derniere_modification",
    "date_etablissement_audit",
    "date_fin_validite_audit",
    "n_audit_remplace",
    "numero_dpe",
    "classe_bilan_dpe",
    "cout_travaux",
    "couts_cumules_travaux",
    "gains_relatifs_cumules_conso_5_usages_m2_ep",
    "gain_relatif_conso_5_usages_m2_ep",
    "travaux_realises",
  ];
  const CLASS_ORDER = ["A", "B", "C", "D", "E", "F", "G"];

  let requestController = null;
  let requestNumber = 0;

  function text(value) {
    return String(value ?? "").trim();
  }

  function validClass(value) {
    const normalized = text(value).toUpperCase();
    return CLASS_ORDER.includes(normalized) ? normalized : "";
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || text(value) === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function validDate(value, today = new Date()) {
    const raw = text(value);
    if (!raw) return true;
    const parsed = new Date(`${raw.slice(0, 10)}T23:59:59Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed >= today;
  }

  function latestDate(record, modificationField, establishmentField) {
    return text(record?.[modificationField] || record?.[establishmentField]);
  }

  function removeReplaced(records, idField, replacedField) {
    const replacedIds = new Set(
      records.map((record) => text(record?.[replacedField])).filter(Boolean),
    );
    return records.filter((record) => !replacedIds.has(text(record?.[idField])));
  }

  function deduplicateDpes(records) {
    const byNumber = new Map();
    records.forEach((record) => {
      const number = text(record?.numero_dpe);
      if (!number) return;
      const previous = byNumber.get(number);
      if (
        !previous ||
        latestDate(record, "date_derniere_modification_dpe", "date_etablissement_dpe") >
          latestDate(previous, "date_derniere_modification_dpe", "date_etablissement_dpe")
      ) {
        byNumber.set(number, record);
      }
    });
    return [...byNumber.values()];
  }

  function selectDpe(records, { banId = "", building = null, today } = {}) {
    const exact = records.filter(
      (record) => text(record?.identifiant_ban) === text(banId),
    );
    const current = removeReplaced(
      deduplicateDpes(exact),
      "numero_dpe",
      "numero_dpe_remplace",
    ).filter(
      (record) =>
        validDate(record?.date_fin_validite_dpe, today) &&
        validClass(record?.etiquette_dpe),
    );

    if (!current.length) return { kind: "none", records: [] };

    const numberedBanAddress = /_\d{5}$/.test(text(banId));
    const buildingUsage = text(building?.usage_principal_bdnb_open).toLowerCase();
    const allHouses = current.every(
      (record) => text(record?.type_batiment).toLowerCase() === "maison",
    );
    const buildingLooksCollective =
      buildingUsage.includes("collectif") ||
      Boolean(text(building?.rncRecord?.numero_immat_principal));

    if (numberedBanAddress && allHouses && !buildingLooksCollective) {
      const selected = [...current].sort((left, right) =>
        latestDate(right, "date_derniere_modification_dpe", "date_etablissement_dpe")
          .localeCompare(
            latestDate(left, "date_derniere_modification_dpe", "date_etablissement_dpe"),
          ),
      )[0];
      return { kind: "individual", record: selected, records: current };
    }

    return { kind: "collective", records: current };
  }

  function selectAuditRows(records, dpeNumber, today = new Date()) {
    const matching = records.filter(
      (record) =>
        text(record?.numero_dpe) === text(dpeNumber) &&
        validDate(record?.date_fin_validite_audit, today),
    );
    if (!matching.length) return null;

    const auditIds = [...new Set(matching.map((record) => text(record?.n_audit)))].filter(Boolean);
    const replacedIds = new Set(
      matching.map((record) => text(record?.n_audit_remplace)).filter(Boolean),
    );
    const currentIds = auditIds.filter((id) => !replacedIds.has(id));
    if (!currentIds.length) return null;

    const selectedId = currentIds.sort((left, right) => {
      const leftRows = matching.filter((record) => text(record?.n_audit) === left);
      const rightRows = matching.filter((record) => text(record?.n_audit) === right);
      const leftDate = Math.max(...leftRows.map((record) => Date.parse(record.date_etablissement_audit) || 0));
      const rightDate = Math.max(...rightRows.map((record) => Date.parse(record.date_etablissement_audit) || 0));
      return rightDate - leftDate || right.localeCompare(left);
    })[0];

    return matching.filter((record) => text(record?.n_audit) === selectedId);
  }

  function principalScenario(rows) {
    const normalized = (value) => text(value).toLowerCase();
    const candidates = rows.filter(
      (row) => normalized(row.categorie_scenario) !== "état initial",
    );
    return (
      candidates.find(
        (row) =>
          normalized(row.categorie_scenario).includes("une étape") &&
          normalized(row.categorie_scenario).includes("principal") &&
          normalized(row.etape_travaux).includes("finale"),
      ) ||
      candidates.find(
        (row) =>
          normalized(row.categorie_scenario).includes("principal") &&
          normalized(row.etape_travaux).includes("finale"),
      ) ||
      candidates.find((row) => normalized(row.etape_travaux).includes("finale")) ||
      candidates[0] ||
      null
    );
  }

  function summarizeAudit(rows) {
    if (!rows?.length) return null;
    const initial = rows.find(
      (row) => text(row.categorie_scenario).toLowerCase() === "état initial",
    );
    const final = principalScenario(rows);
    if (!final) return null;

    const initialClass = validClass(initial?.classe_bilan_dpe);
    const finalClass = validClass(final?.classe_bilan_dpe);
    const initialIndex = CLASS_ORDER.indexOf(initialClass);
    const finalIndex = CLASS_ORDER.indexOf(finalClass);
    const classGain =
      initialIndex >= 0 && finalIndex >= 0 ? initialIndex - finalIndex : null;
    const cumulativeCost = finiteNumber(final.couts_cumules_travaux);
    const stepCost = finiteNumber(final.cout_travaux);
    const relativeSavings = finiteNumber(
      final.gains_relatifs_cumules_conso_5_usages_m2_ep ??
        final.gain_relatif_conso_5_usages_m2_ep,
    );
    const works = [...new Set(
      text(final.travaux_realises)
        .split(",")
        .map((work) => work.trim())
        .filter(Boolean),
    )];

    return {
      date: text(final.date_etablissement_audit || initial?.date_etablissement_audit),
      initialClass,
      finalClass,
      classGain,
      cost: cumulativeCost !== null
        ? cumulativeCost
        : stepCost !== null
          ? stepCost
          : null,
      savingsPercent:
        relativeSavings !== null && Math.abs(relativeSavings) <= 1
          ? Math.abs(relativeSavings) * 100
          : null,
      works,
    };
  }

  function queryUrl(endpoint, field, value, fields) {
    const params = new URLSearchParams({
      size: String(MAX_RESULTS),
      qs: `${field}:"${text(value).replaceAll('"', '\\"')}"`,
      select: fields.join(","),
    });
    return `${endpoint}?${params}`;
  }

  async function fetchLines(endpoint, field, value, fields, signal) {
    const response = await fetch(queryUrl(endpoint, field, value, fields), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`ADEME HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  function formatDate(value) {
    const raw = text(value).slice(0, 10);
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  function year(value) {
    return text(value).slice(0, 4);
  }

  function formatNumber(value, maximumFractionDigits = 1) {
    return Number(value).toLocaleString("fr-FR", { maximumFractionDigits });
  }

  function setField(field, value, unknown = "Inconnu") {
    const row = document.querySelector(`[data-field="${field}"]`);
    const target = row?.querySelector(".field-value");
    if (!target) return;
    const displayed = text(value) || unknown;
    target.textContent = displayed;
    target.className = "field-value";
    if (displayed === "Inconnu" || displayed === "Inconnue") {
      target.classList.add("value-unknown");
    }
  }

  function setLabel(field, label) {
    const target = document.querySelector(`[data-field="${field}"] strong`);
    if (target) target.textContent = `${label} :`;
  }

  function medianNumber(values) {
    const numbers = values.filter((value) => value !== null).sort((a, b) => a - b);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2
      ? numbers[middle]
      : (numbers[middle - 1] + numbers[middle]) / 2;
  }

  function medianClass(records, field) {
    const indexes = records
      .map((record) => CLASS_ORDER.indexOf(validClass(record[field])))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    if (!indexes.length) return "";
    const middle = Math.floor(indexes.length / 2);
    const index = indexes.length % 2
      ? indexes[middle]
      : Math.ceil((indexes[middle - 1] + indexes[middle]) / 2);
    return CLASS_ORDER[index];
  }

  function latestDiagnosticDate(records) {
    return records
      .map((record) => text(record.date_etablissement_dpe))
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] || "";
  }

  function renderIndividualDpe(record) {
    setField("dpe-count", "1");
    const diagnosticYear = year(record.date_etablissement_dpe);
    const provenance = diagnosticYear ? ` · ${diagnosticYear}` : "";
    setField("dpe", `${validClass(record.etiquette_dpe)}${provenance}`);
    setField(
      "ges",
      validClass(record.etiquette_ges)
        ? `${validClass(record.etiquette_ges)}${provenance}`
        : "Inconnu",
    );
    setField("dpe-date", formatDate(record.date_etablissement_dpe), "Inconnue");
    const surface = finiteNumber(record.surface_habitable_logement);
    setField(
      "dpe-surface",
      surface !== null && surface > 0
        ? `${formatNumber(surface)} m²`
        : "Inconnue",
      "Inconnue",
    );
  }

  function renderCollectiveDpe(records) {
    const count = records.length;
    const multiple = count > 1;
    const dpe = medianClass(records, "etiquette_dpe");
    const ges = medianClass(records, "etiquette_ges");
    const surface = medianNumber(
      records
        .map((record) => finiteNumber(record.surface_habitable_logement))
        .filter((value) => value !== null && value > 0),
    );
    const latestDate = latestDiagnosticDate(records);

    setField("dpe-count", String(count));
    setLabel("dpe", multiple ? "DPE médian" : "DPE du logement diagnostiqué");
    setLabel("ges", multiple ? "GES médian" : "GES du logement diagnostiqué");
    setLabel("dpe-date", multiple ? "Diagnostic le plus récent" : "Date du diagnostic");
    setLabel(
      "dpe-surface",
      multiple
        ? "Surface médiane des logements diagnostiqués"
        : "Surface du logement diagnostiqué",
    );
    setField("dpe", dpe || "Inconnu");
    setField("ges", ges || "Inconnu");
    setField("dpe-date", formatDate(latestDate), "Inconnue");
    setField(
      "dpe-surface",
      surface === null ? "Inconnue" : `${formatNumber(surface)} m²`,
      "Inconnue",
    );
  }

  function renderAudit(summary) {
    if (!summary) return;
    const auditYear = year(summary.date);
    setField("audit", `Oui${auditYear ? ` · ${auditYear}` : ""}`);
    setField(
      "audit-initial",
      summary.initialClass ? `${summary.initialClass}` : "Inconnue",
      "Inconnue",
    );
    setField(
      "audit-gain",
      summary.classGain === null
        ? "Inconnu"
        : `${summary.classGain} classe${Math.abs(summary.classGain) > 1 ? "s" : ""}`,
    );
  }

  async function loadAdeme(detail) {
    requestNumber += 1;
    const currentRequest = requestNumber;
    if (requestController) requestController.abort();
    requestController = new AbortController();

    const banId = text(detail?.banId);
    if (!banId) return;

    try {
      const dpeRecords = await fetchLines(
        DPE_ENDPOINT,
        "identifiant_ban",
        banId,
        DPE_FIELDS,
        requestController.signal,
      );
      if (currentRequest !== requestNumber) return;
      const selection = selectDpe(dpeRecords, {
        banId,
        building: detail?.building,
      });

      if (selection.kind === "individual") {
        renderIndividualDpe(selection.record);
      } else if (selection.kind === "collective") {
        renderCollectiveDpe(selection.records);
        return;
      } else {
        setField("dpe-count", "0");
        return;
      }

    } catch (error) {
      if (error.name === "AbortError" || currentRequest !== requestNumber) return;
      console.warn("Données ADEME indisponibles", error);
    }
  }

  window.addEventListener("minihi:building-resolved", (event) => {
    loadAdeme(event.detail || {});
  });

  const api = {
    selectDpe,
    selectAuditRows,
    summarizeAudit,
    medianClass,
    medianNumber,
    removeReplaced,
    loadAdeme,
  };
  window.MinihiAdeme = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
