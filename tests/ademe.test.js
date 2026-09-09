const assert = require("node:assert/strict");
const test = require("node:test");

global.window = { addEventListener() {} };
global.document = { querySelector() { return null; } };

const { loadAdeme, selectAuditRows, selectDpe, summarizeAudit } = require("../ademe.js");

const BAN_ID = "29019_1045_00046";
const TODAY = new Date("2026-09-09T00:00:00Z");

test("la fiche sépare les champs BDNB des diagnostics et conserve tous les inconnus", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const listeners = {};
  const section = { innerHTML: "" };
  vm.runInNewContext(fs.readFileSync(require.resolve("../bdnb.js"), "utf8"), {
    window: { addEventListener(name, fn) { listeners[name] = fn; } },
    resultBox: { querySelector() { return section; } },
    escapeHtml: String,
    AbortController,
    URLSearchParams,
    fetch: () => new Promise(() => {}),
  });
  listeners["minihi:result-rendered"]({ detail: { longitude: -4.1, latitude: 48 } });
  const [building, diagnostics] = section.innerHTML.split('building-block building-renovation');
  assert.match(building, /data-field="bdnb-dpe"/);
  assert.match(building, /data-field="bdnb-ges"/);
  assert.doesNotMatch(building, /data-field="dpe"/);
  for (const field of ["dpe-scope", "dpe", "ges", "dpe-date", "dpe-surface", "audit", "audit-savings"]) {
    assert.ok(diagnostics.includes('data-field="' + field + '"'));
  }
  assert.match(diagnostics, /Diagnostics et potentiel de rénovation/);
  assert.doesNotMatch(diagnostics, /Inconnues/);
});

function dpe(overrides = {}) {
  return {
    numero_dpe: "2529E0000001A",
    identifiant_ban: BAN_ID,
    etiquette_dpe: "F",
    etiquette_ges: "C",
    type_batiment: "maison",
    date_etablissement_dpe: "2025-01-02",
    date_fin_validite_dpe: "2035-01-01",
    ...overrides,
  };
}

test("une maison numérotée conserve le DPE valide le plus récent", () => {
  const records = [
    dpe({ numero_dpe: "OLD", date_etablissement_dpe: "2023-01-01" }),
    dpe({ numero_dpe: "NEW", numero_dpe_remplace: "OLD", date_etablissement_dpe: "2025-01-01" }),
  ];
  const result = selectDpe(records, { banId: BAN_ID, today: TODAY });
  assert.equal(result.kind, "individual");
  assert.equal(result.record.numero_dpe, "NEW");
});

test("une maison sans DPE exact reste inconnue", () => {
  const result = selectDpe([dpe({ identifiant_ban: "autre" })], { banId: BAN_ID, today: TODAY });
  assert.equal(result.kind, "none");
});

test("les diagnostics expirés ou incomplets sont écartés", () => {
  const result = selectDpe([
    dpe({ numero_dpe: "EXPIRED", date_fin_validite_dpe: "2025-01-01" }),
    dpe({ numero_dpe: "PARTIAL", etiquette_dpe: "" }),
  ], { banId: BAN_ID, today: TODAY });
  assert.equal(result.kind, "none");
});

test("plusieurs DPE d'appartements produisent uniquement une synthèse collective", () => {
  const records = [
    dpe({ numero_dpe: "APT1", type_batiment: "appartement", etiquette_dpe: "C" }),
    dpe({ numero_dpe: "APT2", type_batiment: "appartement", etiquette_dpe: "F" }),
  ];
  const result = selectDpe(records, { banId: BAN_ID, today: TODAY });
  assert.equal(result.kind, "collective");
  assert.equal(result.records.length, 2);
});

test("un seul appartement n'est pas présenté comme le logement recherché", () => {
  const result = selectDpe([dpe({ type_batiment: "appartement" })], { banId: BAN_ID, today: TODAY });
  assert.equal(result.kind, "collective");
});

test("un audit rattaché au DPE restitue le scénario principal final", () => {
  const rows = [
    {
      n_audit: "AUDIT1", numero_dpe: "DPE1", categorie_scenario: "état initial",
      classe_bilan_dpe: "F", date_fin_validite_audit: "2030-01-01", date_etablissement_audit: "2025-01-01",
    },
    {
      n_audit: "AUDIT1", numero_dpe: "DPE1", categorie_scenario: 'scénario en une étape "principal"',
      etape_travaux: "étape finale", classe_bilan_dpe: "B", couts_cumules_travaux: 45000,
      gains_relatifs_cumules_conso_5_usages_m2_ep: -0.62,
      travaux_realises: "Isolation des murs, Remplacement du chauffage",
      date_fin_validite_audit: "2030-01-01", date_etablissement_audit: "2025-01-01",
    },
  ];
  const summary = summarizeAudit(selectAuditRows(rows, "DPE1", TODAY));
  assert.equal(summary.initialClass, "F");
  assert.equal(summary.finalClass, "B");
  assert.equal(summary.classGain, 4);
  assert.equal(summary.cost, 45000);
  assert.equal(summary.savingsPercent, 62);
});

test("un audit absent ou rattaché à un autre DPE est ignoré", () => {
  assert.equal(selectAuditRows([], "DPE1", TODAY), null);
  assert.equal(selectAuditRows([
    { n_audit: "AUDIT1", numero_dpe: "AUTRE", date_fin_validite_audit: "2030-01-01" },
  ], "DPE1", TODAY), null);
});

test("une panne ADEME laisse intactes les valeurs BDNB", async () => {
  const untouched = { textContent: "E · BDNB", className: "field-value", classList: { add() {} } };
  global.document = {
    querySelector(selector) {
      return selector === '[data-field="dpe"]' ? { querySelector() { return untouched; } } : null;
    },
  };
  global.fetch = async () => { throw new Error("réseau indisponible"); };
  const previousWarn = console.warn;
  console.warn = () => {};
  await loadAdeme({ banId: BAN_ID });
  console.warn = previousWarn;
  assert.equal(untouched.textContent, "E · BDNB");
});

test("une erreur HTTP ADEME laisse également les valeurs BDNB intactes", async () => {
  const untouched = { textContent: "D · BDNB", className: "field-value", classList: { add() {} } };
  global.document = {
    querySelector(selector) {
      return selector === '[data-field="dpe"]' ? { querySelector() { return untouched; } } : null;
    },
  };
  global.fetch = async () => ({ ok: false, status: 503 });
  const previousWarn = console.warn;
  console.warn = () => {};
  await loadAdeme({ banId: BAN_ID });
  console.warn = previousWarn;
  assert.equal(untouched.textContent, "D · BDNB");
});

test("un DPE ADEME individuel fiable est affiché explicitement malgré une divergence BDNB", async () => {
  const values = { dpe: "E · BDNB" };
  global.document = {
    querySelector(selector) {
      const match = selector.match(/data-field="([^"]+)/);
      if (!match) return null;
      const field = match[1];
      return {
        querySelector() {
          return {
            set textContent(value) { values[field] = value; },
            set className(value) {},
            classList: { add() {} },
          };
        },
      };
    },
  };
  let call = 0;
  global.fetch = async () => ({
    ok: true,
    async json() {
      call += 1;
      return call === 1 ? { results: [dpe({ etiquette_dpe: "D" })] } : { results: [] };
    },
  });
  await loadAdeme({ banId: BAN_ID, building: { usage_principal_bdnb_open: "Résidentiel individuel" } });
  assert.equal(values.dpe, "D · ADEME 2025");
});
