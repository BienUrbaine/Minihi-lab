(() => {
  const API_KEY_PLACEHOLDER = "REMPLACER_PAR_LA_CLE_GOOGLE_MAPS";
  const EMBED_ENDPOINT = "https://www.google.com/maps/embed/v1/streetview";

  const openButton = document.querySelector("#street-view-open");
  const openButtonLabel = openButton?.querySelector(".street-view-trigger-label");
  const panel = document.querySelector("#street-view-panel");
  const mapPanel = panel?.closest(".map-panel");
  const closeButton = document.querySelector("#street-view-close");
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

  function notifyMapLayout(open) {
    mapPanel?.classList.toggle("street-view-visible", open);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("minihi:map-layout-changed", { detail: { open } }),
        );
      });
    });
  }

  function openPanel() {
    const wasHidden = panel.hidden;
    panel.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    if (openButtonLabel) openButtonLabel.textContent = "Masquer Street View";
    if (wasHidden) notifyMapLayout(true);
  }

  function closePanel() {
    const wasOpen = !panel.hidden;
    panel.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
    if (openButtonLabel) openButtonLabel.textContent = "Voir dans Street View";
    frame.hidden = true;
    frame.removeAttribute("src");
    openButton.focus({ preventScroll: true });
    if (wasOpen) notifyMapLayout(false);
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

    if (!hasConfiguredKey(key)) {
      showStatus(
        "Street View n’est pas encore configuré. Ajoutez la clé Google Maps dans streetview-config.js.",
      );
      return;
    }

    showFrame(embedUrl(selectedLocation, key));
  }

  function toggleStreetView() {
    if (panel.hidden) loadStreetView();
    else closePanel();
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

  openButton.addEventListener("click", toggleStreetView);
  closeButton.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) closePanel();
  });
})();
