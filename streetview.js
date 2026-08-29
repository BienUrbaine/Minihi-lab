(() => {
  const API_KEY_PLACEHOLDER = "REMPLACER_PAR_LA_CLE_GOOGLE_MAPS";
  const EMBED_ENDPOINT = "https://www.google.com/maps/embed/v1/streetview";

  const openButton = document.querySelector("#street-view-open");
  const panel = document.querySelector("#street-view-panel");
  const closeButton = document.querySelector("#street-view-close");
  const addressLabel = document.querySelector("#street-view-address");
  const statusBox = document.querySelector("#street-view-status");
  const frame = document.querySelector("#street-view-frame");

  if (!openButton || !panel || !closeButton || !statusBox || !frame) return;

  let selectedLocation = null;

  function apiKey() {
    return String(window.MINIHI_CONFIG?.googleMapsApiKey || "").trim();
  }

  function hasConfiguredKey(key) {
    return Boolean(key && key !== API_KEY_PLACEHOLDER);
  }

  function showStatus(message) {
    frame.hidden = true;
    frame.removeAttribute("src");
    statusBox.textContent = message;
    statusBox.hidden = false;
  }

  function showFrame(url) {
    statusBox.hidden = true;
    frame.src = url;
    frame.hidden = false;
  }

  function openPanel() {
    panel.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    closeButton.focus({ preventScroll: true });
  }

  function closePanel() {
    panel.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
    frame.hidden = true;
    frame.removeAttribute("src");
    openButton.focus({ preventScroll: true });
  }

  function embedUrl(location, key) {
    const url = new URL(EMBED_ENDPOINT);
    const parameters = new URLSearchParams({
      key,
      location: `${location.latitude},${location.longitude}`,
      radius: "50",
      source: "outdoor",
      language: "fr",
      region: "FR",
      fov: "90",
      pitch: "0",
    });
    url.search = parameters.toString();
    return url.toString();
  }

  function loadStreetView() {
    if (!selectedLocation) return;

    const key = apiKey();
    openPanel();
    addressLabel.textContent = selectedLocation.label;

    if (!hasConfiguredKey(key)) {
      showStatus(
        "Street View n’est pas encore configuré. Ajoutez la clé Google Maps dans streetview-config.js.",
      );
      return;
    }

    showFrame(embedUrl(selectedLocation, key));
  }

  window.addEventListener("minihi:address-selected", (event) => {
    const longitude = Number(event.detail?.longitude);
    const latitude = Number(event.detail?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;

    selectedLocation = {
      longitude,
      latitude,
      label: String(event.detail?.label || "Adresse sélectionnée"),
    };
    openButton.hidden = !hasConfiguredKey(apiKey());

    if (!panel.hidden && !openButton.hidden) loadStreetView();
  });

  openButton.addEventListener("click", loadStreetView);
  closeButton.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
})();
